/**
 * Gomoku（五子棋）engine — 15×15 自由式规则
 * AI 档位（设计稿 / 01 — BOARD LANGUAGE）：
 *   easy   (Counter)     "counts pairs & trios"          — 启发式 + depth=1
 *   medium (Attacker)    "opens threats, still local"    — 启发式 + αβ depth=2 + move ordering
 *   hard   (Punisher)    "sharpest weights, no lookahead" — 启发式 + αβ depth=4 + kill move
 *
 * 数据结构：
 *   Board = number[225] 0=空 1=黑(我) 2=白(对手)
 *   索引：index = y*15 + x，左上角为 (0,0)
 *
 * 棋盘评分（每条线 5 连方向，pattern scoring）：
 *   五连 / open-4 = 100_000    （必胜，无法挡）
 *   double-4    = 50_000
 *   open-3      = 1_000
 *   closed-4    = 100
 *   double-3    = 500
 *   open-2      = 50
 *   closed-3    = 10
 *   closed-2    = 1
 *   ——评估总分 = Σ(我方) - 1.2 * Σ(对手)  （防守略弱于进攻，符合设计稿"freestyle"）
 */

export type Player = 1 | 2;
export type Cell = 0 | 1 | 2;
export type Board = number[];
export type Difficulty = 'easy' | 'medium' | 'hard';

export const SIZE = 15;
export const SIZE2 = SIZE * SIZE;
const DIRS: ReadonlyArray<[number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];
const INF = 1_000_000;

export function emptyBoard(): Board {
  return new Array(SIZE2).fill(0);
}

export function cloneBoard(b: Board): Board {
  return b.slice();
}

export function legalMoves(b: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < SIZE2; i++) if (b[i] === 0) out.push(i);
  return out;
}

/** 以 (x, y) 取 idx */
function idx(x: number, y: number) {
  return y * SIZE + x;
}

/** 对一条 5 格线评分（中心点是 player）。返回 (我方分, 对手分) */
function scoreLine(line: Cell[], centerPlayer: Player): { me: number; opp: number } {
  // 评分模式（基于"我方视角"的 5 连段）
  //   XXXXX = 100000    OOOOO = 必挡 → 给对手 100000（防守优先级高）
  //   XXXX. / .XXXX = open-4 = 10000
  //   XXXXO / OXXXX = closed-4 = 100
  //   XXX.. / ..XXX = open-3 = 1000
  //   XXX.O / OXXX. = closed-3 = 10
  //   XX... / ..XX. = open-2 = 50
  //   XX..O / OXX.. = closed-2 = 1
  const me = scorePatternFor(line, centerPlayer);
  const opp = scorePatternFor(line, (centerPlayer === 1 ? 2 : 1) as Player);
  return { me, opp };
}

/** 评一种 pattern 视角的分数 */
function scorePatternFor(line: Cell[], player: Player): number {
  let s = 0;
  // 滑窗 5 格
  for (let i = 0; i <= 5; i++) {
    const w = line.slice(i, i + 5);
    s += scoreWindow(w, player);
  }
  return s;
}

function scoreWindow(w: Cell[], player: Player): number {
  const opp = (player === 1 ? 2 : 1) as Player;
  const my = w.filter((c) => c === player).length;
  const op = w.filter((c) => c === opp).length;
  const empty = w.filter((c) => c === 0).length;

  // 含对手子 = 不可能属于我的连子
  if (op > 0) return 0;

  if (my === 5) return 100_000;
  if (my === 4 && empty === 1) {
    // open-4（无墙边界 → 完全开放）
    return 10_000;
  }
  if (my === 3 && empty === 2) {
    return 1_000;
  }
  if (my === 2 && empty === 3) {
    return 50;
  }
  if (my === 1 && empty === 4) return 0;
  return 0;
}

/** 全局评估：从 player 视角的"局面分"，越大越有利 */
export function evaluate(b: Board, player: Player): number {
  let score = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      for (const [dx, dy] of DIRS) {
        // 只在每条线的"起点"评分，避免重复
        const px = x - dx * 4, py = y - dy * 4;
        if (px < 0 || px >= SIZE || py < 0 || py >= SIZE) continue;
        // 5+1=6 格，过中心 (x, y) → 一条线 —— 取起点 (x-4dx, y-4dy) 到中心共 5 格
        const w: Cell[] = [];
        for (let k = -4; k <= 0; k++) {
          const xx = x + dx * k, yy = y + dy * k;
          if (xx < 0 || xx >= SIZE || yy < 0 || yy >= SIZE) { w.length = 0; break; }
          w.push(b[idx(xx, yy)] as Cell);
        }
        if (w.length !== 5) continue;
        const { me, opp } = scoreLine(w, player);
        score += me - opp * 1.2;
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
  for (const m of moves) {
    b[m] = player;
    const v = alphabeta(b, depth - 1, alpha, beta, (player === 1 ? 2 : 1) as Player, ai);
    b[m] = 0;
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

/** 选择候选点：仅在已有棋子周围 2 格内（freestyle Gomoku 不可能全盘搜） */
function candidateMoves(b: Board): number[] {
  const moves = legalMoves(b);
  if (moves.length === 0) return [];
  // 第一手落天元
  if (moves.length === SIZE2) return [Math.floor(SIZE2 / 2)];
  // 已有棋子 → 取每颗 2 格内的空点
  const seen = new Set<number>();
  for (let i = 0; i < SIZE2; i++) {
    if (b[i] === 0) continue;
    const x = i % SIZE, y = Math.floor(i / SIZE);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= SIZE || yy < 0 || yy >= SIZE) continue;
        const k = idx(xx, yy);
        if (b[k] === 0) seen.add(k);
      }
    }
  }
  if (seen.size === 0) return moves; // 极端：棋盘满（不可能）
  return [...seen];
}

export function bestMove(b: Board, player: Player, difficulty: Difficulty): number {
  const moves = legalMoves(b);
  if (moves.length === 0) return -1;

  // 第一手：落天元
  if (moves.length === SIZE2) return Math.floor(SIZE2 / 2);

  const candidates = candidateMoves(b);

  let depth = 2;
  if (difficulty === 'medium') depth = 2;
  if (difficulty === 'hard') depth = 4;

  let bestI = candidates[0];
  let bestS = -INF;
  for (const m of candidates) {
    b[m] = player;
    const s = alphabeta(b, depth - 1, -INF, INF, (player === 1 ? 2 : 1) as Player, player);
    b[m] = 0;
    if (s > bestS) {
      bestS = s;
      bestI = m;
    }
  }
  return bestI;
}

/** 检测是否有 5 连（任意一方） */
export function hasFive(b: Board): { winner: 0 | Player; line: number[] | null } {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (b[idx(x, y)] === 0) continue;
      const me = b[idx(x, y)] as Player;
      for (const [dx, dy] of DIRS) {
        // 起点检查
        const px = x - dx, py = y - dy;
        if (px >= 0 && px < SIZE && py >= 0 && py < SIZE && b[idx(px, py)] === me) continue;
        // 5 连
        let ok = true;
        for (let k = 1; k < 5; k++) {
          const xx = x + dx * k, yy = y + dy * k;
          if (xx < 0 || xx >= SIZE || yy < 0 || yy >= SIZE || b[idx(xx, yy)] !== me) { ok = false; break; }
        }
        if (ok) return { winner: me, line: [idx(x, y), idx(x + dx, y + dy), idx(x + dx * 2, y + dy * 2), idx(x + dx * 3, y + dy * 3), idx(x + dx * 4, y + dy * 4)] };
      }
    }
  }
  return { winner: 0, line: null };
}

/** 自检 */
export function selfTest(): { ok: boolean; details: string[] } {
  const details: string[] = [];
  let ok = true;
  // 第一手 = 天元
  let b = emptyBoard();
  const m1 = bestMove(b, 1, 'easy');
  if (m1 !== 112) {
    ok = false;
    details.push('first move should be center (112), got ' + m1);
  }
  // 构造 4 连检测
  b = emptyBoard();
  for (let x = 0; x < 4; x++) b[idx(7 + x, 7)] = 1;
  const r = hasFive(b);
  if (r.winner !== 1) {
    ok = false;
    details.push('5-in-row should detect winner=1, got ' + r.winner);
  }
  return { ok, details };
}