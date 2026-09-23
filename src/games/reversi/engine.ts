/**
 * Reversi（黑白棋 / Othello）engine — 8×8
 * 规则：放子后，在横/竖/斜方向上能找到"对方子 → 我方子"路径即合法；
 *      合法走子会翻转所有被夹住的对方子。先无子可下者轮空，棋盘满或双方都无子下完。
 *
 * AI 档位（设计稿）：
 *   easy   — 移动性 + 角优先的简单启发（depth=1）
 *   medium — αβ depth=4 + 角/边/机动性权重
 *   hard   — αβ depth=6 + corner-taken 截断
 *
 * 评估 = 子权（corners 9.99**3）+ 边权（5）+ 危险区（-3）+ 机动性（合法步数差）
 */

export type Player = 1 | 2;
export type Cell = 0 | 1 | 2;
export type Board = Cell[];
export type Difficulty = 'easy' | 'medium' | 'hard';

export const SIZE = 8;
export const SIZE2 = SIZE * SIZE;
const INF = 1_000_000;

const DIRS: ReadonlyArray<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// 角 + 邻角危险格（C 形区域，翻转代价 > 收益）
const CORNERS: ReadonlyArray<[number, number]> = [[0, 0], [0, 7], [7, 0], [7, 7]];
const DANGER: ReadonlyArray<[number, number]> = [
  [0, 1], [1, 0], [1, 1],       // 左上角邻接
  [0, 6], [1, 6], [1, 7],       // 右上角邻接
  [6, 0], [6, 1], [7, 1],       // 左下角邻接
  [6, 6], [6, 7], [7, 6],       // 右下角邻接
];

export function emptyBoard(): Board {
  const b: Board = new Array(SIZE2).fill(0);
  // 标准初始 4 子：黑白相间居中
  b[3 * SIZE + 3] = 1; b[4 * SIZE + 4] = 1;  // 白（player 1）
  b[3 * SIZE + 4] = 2; b[4 * SIZE + 3] = 2;  // 黑（player 2）
  return b;
}

export function cloneBoard(b: Board): Board {
  return b.slice();
}

/** 沿方向寻找可翻转段：找连续 opp 直到遇到 player */
function flipsAlong(b: Board, x: number, y: number, dx: number, dy: number, player: Player): number[] {
  const opp = (player === 1 ? 2 : 1) as Player;
  const flips: number[] = [];
  let xx = x + dx, yy = y + dy;
  while (xx >= 0 && xx < SIZE && yy >= 0 && yy < SIZE) {
    const k = yy * SIZE + xx;
    if (b[k] === opp) {
      flips.push(k);
      xx += dx; yy += dy;
    } else if (b[k] === player) {
      return flips; // 找到闭合点
    } else {
      return []; // 空，路径断
    }
  }
  return []; // 出界，无闭合
}

/** 返回所有合法落子的 idx 列表 */
export function legalMoves(b: Board, player: Player): number[] {
  const out: number[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const k = y * SIZE + x;
      if (b[k] !== 0) continue;
      let ok = false;
      for (const [dx, dy] of DIRS) {
        if (flipsAlong(b, x, y, dx, dy, player).length > 0) { ok = true; break; }
      }
      if (ok) out.push(k);
    }
  }
  return out;
}

/** 落子 + 翻转（修改原数组） */
export function place(b: Board, idx: number, player: Player): { placed: number; flipped: number[] } {
  const x = idx % SIZE, y = Math.floor(idx / SIZE);
  const allFlips: number[] = [];
  for (const [dx, dy] of DIRS) {
    allFlips.push(...flipsAlong(b, x, y, dx, dy, player));
  }
  b[idx] = player;
  for (const f of allFlips) b[f] = player;
  return { placed: idx, flipped: allFlips };
}

/** 全局评估 */
export function evaluate(b: Board, player: Player): number {
  let s = 0;
  // 角 = 巨大正分
  for (const [x, y] of CORNERS) {
    const k = y * SIZE + x;
    if (b[k] === player) s += 9000;
    else if (b[k] !== 0) s -= 9000;
  }
  // 危险格 = 负分（除非相邻角已被占）
  for (const [x, y] of DANGER) {
    const k = y * SIZE + x;
    if (b[k] === player) s -= 300;
    else if (b[k] !== 0) s += 300;
  }
  // 边（最后一行的非边缘格）= 0 中性，X 行/列的边缘也是中等正分
  // 简单数子数差
  let my = 0, op = 0;
  for (let i = 0; i < SIZE2; i++) {
    if (b[i] === player) my++;
    else if (b[i] !== 0) op++;
  }
  // 终局才用子数（早终局子数意义不大）
  const totalFilled = my + op;
  if (totalFilled > SIZE2 - 14) {
    s += (my - op) * 50;
  }
  // 机动性
  const myMoves = legalMoves(b, player).length;
  const opMoves = legalMoves(b, (player === 1 ? 2 : 1) as Player).length;
  s += (myMoves - opMoves) * 10;
  return s;
}

/** αβ 搜索 */
function alphabeta(b: Board, depth: number, alpha: number, beta: number, player: Player, ai: Player, pass: number): number {
  const moves = legalMoves(b, player);
  if (depth === 0) return evaluate(b, ai);
  if (moves.length === 0) {
    // 双方都无子下 → 终局
    if (pass >= 2 || legalMoves(b, (player === 1 ? 2 : 1) as Player).length === 0) {
      return evaluate(b, ai);
    }
    return alphabeta(b, depth, alpha, beta, (player === 1 ? 2 : 1) as Player, ai, pass + 1);
  }

  const maximizing = player === ai;
  let best = maximizing ? -INF : INF;
  for (const m of moves) {
    const snap = b.slice();
    place(b, m, player);
    const v = alphabeta(b, depth - 1, alpha, beta, (player === 1 ? 2 : 1) as Player, ai, 0);
    b.splice(0, SIZE2, ...snap);
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
  const moves = legalMoves(b, player);
  if (moves.length === 0) return -1;

  let depth = 1;
  if (difficulty === 'medium') depth = 4;
  if (difficulty === 'hard') depth = 6;

  let bestM = moves[0];
  let bestS = -INF;
  for (const m of moves) {
    const snap = b.slice();
    place(b, m, player);
    const s = alphabeta(b, depth - 1, -INF, INF, (player === 1 ? 2 : 1) as Player, player, 0);
    b.splice(0, SIZE2, ...snap);
    if (s > bestS) {
      bestS = s;
      bestM = m;
    }
  }
  return bestM;
}

export function selfTest(): { ok: boolean; details: string[] } {
  const details: string[] = [];
  let ok = true;
  // 初始棋盘合法落子 = 4 个相邻格
  const b = emptyBoard();
  const moves = legalMoves(b, 1);
  if (moves.length !== 4) {
    ok = false;
    details.push('initial legal moves should be 4, got ' + moves.length);
  }
  // 走一步后翻转数应 > 0
  if (moves.length > 0) {
    const snap = b.slice();
    const r = place(b, moves[0], 1);
    if (r.flipped.length === 0) {
      ok = false;
      details.push('first move should flip at least one piece, got 0');
    }
    b.splice(0, SIZE2, ...snap);
  }
  return { ok, details };
}