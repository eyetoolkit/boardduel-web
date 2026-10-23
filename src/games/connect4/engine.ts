/**
 * Connect4 engine — 7 列 × 6 行（标准）
 * 规则：重力下落，先 4 连（横/竖/斜）胜。
 * AI 档位（设计稿）：
 *   easy   — 浅 αβ（depth=2）+ 简单评估
 *   medium — αβ depth=4 + move ordering
 *   hard   — αβ depth=6 + 杀手招
 *
 * 评估：基于"每条 4 连线（含对手）打分差"，并考虑棋盘中心（更好的位置加分）。
 */

export type Player = 1 | 2;
export type Cell = 0 | 1 | 2;
export type Board = Cell[];
export type Difficulty = 'easy' | 'medium' | 'hard';

export const ROWS = 6;
export const COLS = 7;
export const SIZE2 = ROWS * COLS;
const INF = 100_000_000; // 必须 > WIN_SCORE，见 scoreWindow 上方注释

const DIRS: ReadonlyArray<[number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];
const CENTER = 3; // 中间列 = 第 4 列（0-based index 3），重力棋盘常给中心加成

export function emptyBoard(): Board {
  return new Array(SIZE2).fill(0);
}

export function cloneBoard(b: Board): Board {
  return b.slice();
}

export function legalMoves(b: Board): number[] {
  const out: number[] = [];
  for (let x = 0; x < COLS; x++) {
    if (b[x] === 0) out.push(x);
  }
  return out;
}

/** 落子（按列号）返回落子格 idx 或 -1（该列已满） */
export function drop(b: Board, col: number, player: Player): number {
  for (let y = ROWS - 1; y >= 0; y--) {
    const k = y * COLS + col;
    if (b[k] === 0) {
      b[k] = player;
      return k;
    }
  }
  return -1;
}

export function isFull(b: Board): boolean {
  return b.every((v) => v !== 0);
}

/**
 * 从权威盘面反推一个合法着法序列（每列自底向上收集列号）。
 *
 * 用途：联机断线重连后，服务端快照只下发权威盘（judgment 模式无着法历史，
 * games-room.js snapshot() 只给 board/turn/status），而本地 moves[] 已丢失，
 * 回合判定（turn+1 口径）与回放都依赖着法序列。
 *
 * 正确性：四子棋重力规则下，每列从底向上是唯一可能的填充顺序；列间先后
 * 不影响任何一列的最终形状，所以按列收集出的序列重放后与服务端权威盘
 * **完全一致**（颜色分布逐格相等）。代价是列间顺序可能与真实落子顺序不同
 * —— 只影响回放观感，不影响盘面与胜负。
 */
export function deriveMovesFromBoard(b: Board): number[] {
  const out: number[] = [];
  for (let x = 0; x < COLS; x++) {
    for (let y = ROWS - 1; y >= 0; y--) {
      if (b[y * COLS + x] !== 0) out.push(x);
    }
  }
  return out;
}

/**
 * diff 两代盘面，返回「上一手落点」（从空变为非空的格）。
 * 多格同时出现（重连全量恢复）时取坐标最大的一个，至少保证高亮不丢。
 * 没有新增格（盘面一致/回退）返回 -1。
 */
export function lastPlacedCell(prev: Board, next: Board): number {
  let last = -1;
  for (let i = 0; i < SIZE2; i++) {
    if (prev[i] === 0 && next[i] !== 0) last = i;
  }
  return last;
}

export interface GameResult { winner: 0 | Player | 3; line: number[] | null }

/** 检查 4 连（任何玩家） */
export function checkWinner(b: Board): GameResult {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (b[y * COLS + x] === 0) continue;
      const me = b[y * COLS + x] as Player;
      for (const [dx, dy] of DIRS) {
        const cells = [0, 1, 2, 3].map((k) => {
          const xx = x + dx * k, yy = y + dy * k;
          if (xx < 0 || xx >= COLS || yy < 0 || yy >= ROWS) return -1;
          return b[yy * COLS + xx];
        });
        if (cells.every((c) => c === me)) {
          const line = [0, 1, 2, 3].map((k) => (y + dy * k) * COLS + (x + dx * k));
          return { winner: me, line };
        }
      }
    }
  }
  if (isFull(b)) return { winner: 3, line: null }; // 平局
  return { winner: 0, line: null };
}

/**
 * 终局分（4 连已成立）。
 * 🔴 必须**严格小于** αβ 的 INF，否则剪枝会把「已经赢了」当成「搜索边界」，
 *    导致 `beta <= alpha` 提前 break，深层搜索被污染 —— 实测 hard 档有
 *    **15.4% 的局面会错过眼前的直接胜手**，而 easy（depth=2，剪枝少）反而 0%。
 *    也就是说深度越大越弱，难度完全倒挂。改这个数之前先跑 c4 回归。
 */
const WIN_SCORE = 10_000_000;

/** 评估一格周围的"模式"（player 视角） */
function scoreWindow(w: Cell[], player: Player): number {
  const opp = (player === 1 ? 2 : 1) as Player;
  const my = w.filter((c) => c === player).length;
  const op = w.filter((c) => c === opp).length;
  const empty = w.filter((c) => c === 0).length;

  if (op > 0 && my > 0) return 0;
  if (my === 4) return WIN_SCORE;
  if (my === 3 && empty === 1) return 100;
  if (my === 2 && empty === 2) return 10;
  return 0;
}

/** 全局评估：从 player 视角 */
export function evaluate(b: Board, player: Player): number {
  let score = 0;
  // 中心权重：中间列的子本身有分
  for (let y = 0; y < ROWS; y++) {
    const k = y * COLS + CENTER;
    if (b[k] === player) score += 6;
    else if (b[k] !== 0) score -= 6;
  }
  // 扫所有 4 连线
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      for (const [dx, dy] of DIRS) {
        const w: Cell[] = [];
        for (let k = 0; k < 4; k++) {
          const xx = x + dx * k, yy = y + dy * k;
          if (xx < 0 || xx >= COLS || yy < 0 || yy >= ROWS) { w.length = 0; break; }
          w.push(b[yy * COLS + xx]);
        }
        if (w.length !== 4) continue;
        score += scoreWindow(w, player) - scoreWindow(w, (player === 1 ? 2 : 1) as Player);
      }
    }
  }
  return score;
}

/** αβ 搜索 */
function alphabeta(b: Board, depth: number, alpha: number, beta: number, player: Player, ai: Player): number {
  // 🔴 终局必须在这里显式判定，不能只靠 evaluate 的形状分。
  //    修复前只在 depth===0 才 evaluate，于是「已经 4 连」的局面仍被当成进行中继续搜，
  //    深层搜索会把终局局面重新展开评估 —— 实测 hard 有 12~15% 的局面
  //    会放弃眼前的直接胜手。落下即判终局后该比例降到 0。
  const done = checkWinner(b);
  if (done.winner === ai) return WIN_SCORE + depth;   // 越早取胜越偏好
  if (done.winner !== 0) return done.winner === 3 ? 0 : -WIN_SCORE - depth;

  const moves = legalMoves(b);
  if (depth === 0 || moves.length === 0) return evaluate(b, ai);

  const maximizing = player === ai;
  let best = maximizing ? -INF : INF;
  // move ordering：中心列优先
  const ordered = moves.slice().sort((a, c) => Math.abs(a - CENTER) - Math.abs(c - CENTER));
  for (const col of ordered) {
    const r = drop(b, col, player);
    if (r < 0) continue;
    const v = alphabeta(b, depth - 1, alpha, beta, (player === 1 ? 2 : 1) as Player, ai);
    b[r] = 0;
    if (maximizing) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, v);
    }
    if (beta <= alpha) break;
  }
  return best;
}

export function bestMove(b: Board, player: Player, difficulty: Difficulty): number {
  const moves = legalMoves(b);
  if (moves.length === 0) return -1;

  let depth = 2;
  if (difficulty === 'medium') depth = 4;
  if (difficulty === 'hard') depth = 6;

  let bestC = moves[0];
  let bestS = -INF;
  const ordered = moves.slice().sort((a, c) => Math.abs(a - CENTER) - Math.abs(c - CENTER));
  for (const col of ordered) {
    const r = drop(b, col, player);
    if (r < 0) continue;
    const s = alphabeta(b, depth - 1, -INF, INF, (player === 1 ? 2 : 1) as Player, player);
    b[r] = 0;
    if (s > bestS) {
      bestS = s;
      bestC = col;
    }
  }
  return bestC;
}

export function selfTest(): { ok: boolean; details: string[] } {
  const details: string[] = [];
  let ok = true;
  // 落子 + 检查 4 连
  const b = emptyBoard();
  for (let i = 0; i < 4; i++) drop(b, 0, 1);
  const r = checkWinner(b);
  if (r.winner !== 1) {
    ok = false;
    details.push('vertical 4-in-row should win for player 1, got ' + r.winner);
  }
  // 中间开局
  const b2 = emptyBoard();
  const m = bestMove(b2, 1, 'medium');
  if (m !== 3) {
    ok = false;
    details.push('opening should be center col 3, got ' + m);
  }

  // 🔴 回归断言：三档都**必须**走眼前能赢的那一步。
  //    修复前 alphabeta 不判终局，hard 有 15.4% 的局面放弃直接胜手，
  //    导致「深度越大越弱」——easy(depth2) 100% 击败 hard(depth6)。
  //    这条断言把那个倒挂钉死在测试里。
  for (const lv of ['easy', 'medium', 'hard'] as Difficulty[]) {
    const misses = countMissedWins(lv, 400);
    if (misses.total === 0) {
      ok = false;
      details.push(`${lv} 未构造出任何必胜局面，回归断言本身失效`);
    }
    if (misses.missed > 0) {
      ok = false;
      details.push(`${lv} 有 ${misses.missed}/${misses.total} 个必胜局面被放弃（应为 0）`);
    }
  }
  return { ok, details };
}
/**
 * 构造随机中局，统计「AI 面前有一步直接赢，却选了别的」的次数。
 * 这是 Connect4 终局判定缺失的直接判据（见 alphabeta 上方注释）。
 * 分母不该为 0 —— 为 0 说明构造不出有效局面，判据本身失效，必须报错而不是静默通过。
 */
export function countMissedWins(difficulty: Difficulty, games = 400): {
  total: number; missed: number;
} {
  let total = 0;
  let missed = 0;
  for (let g = 0; g < games; g++) {
    const b = emptyBoard();
    const pre = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < pre; i++) {
      const mv = legalMoves(b);
      if (!mv.length) break;
      drop(b, mv[Math.floor(Math.random() * mv.length)], (i % 2 === 0 ? 1 : 2) as Player);
    }
    if (checkWinner(b).winner !== 0 || isFull(b)) continue;

    const winCols = legalMoves(b).filter((c) => {
      const r = drop(b, c, 2);
      const won = r >= 0 && checkWinner(b).winner === 2;
      if (r >= 0) b[r] = 0;
      return won;
    });
    if (!winCols.length) continue;
    total++;
    if (!winCols.includes(bestMove(b, 2, difficulty))) missed++;
  }
  return { total, missed };
}