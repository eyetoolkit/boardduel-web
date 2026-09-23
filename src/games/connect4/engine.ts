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
const INF = 1_000_000;

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

/** 评估一格周围的"模式"（player 视角） */
function scoreWindow(w: Cell[], player: Player): number {
  const opp = (player === 1 ? 2 : 1) as Player;
  const my = w.filter((c) => c === player).length;
  const op = w.filter((c) => c === opp).length;
  const empty = w.filter((c) => c === 0).length;

  if (op > 0 && my > 0) return 0;
  if (my === 4) return 1_000_000;
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
  return { ok, details };
}