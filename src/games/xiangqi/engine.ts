// src/games/xiangqi/engine.ts
// Self-researched Chinese Chess (Xiangqi) rules + lightweight alpha-beta AI.
// Zero external dependencies, MIT-clean (no GPL engines: Pikafish/Fairy-Stockfish/ElephantEye).
//
// Design note: `evaluate()` is a standalone, swappable module. The default is a
// classical material + piece-square (formula) evaluation. A future "KataGo-flavored"
// lightweight value/policy head (small TF.js net, reusing the Go KataGo TF.js infra)
// can replace `evaluate()` without touching the search — that is the optional Phase 2.

export type Side = 1 | -1; // red = 1, black = -1

export const EMPTY = 0;
// piece code = side * typeRank
export const T = { P: 1, C: 2, R: 3, H: 4, E: 5, A: 6, K: 7 } as const;

export type Move = { from: number; to: number; cap: number };

export interface GameState {
  board: Int8Array; // length 90, index = r*9 + c
  side: Side;       // side to move
}

export const COLS = 9;
export const ROWS = 10;
export const N = ROWS * COLS;

export function idx(r: number, c: number): number { return r * COLS + c; }
export function rowOf(i: number): number { return (i / COLS) | 0; }
export function colOf(i: number): number { return i % COLS; }
export function inBoard(r: number, c: number): boolean { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
export function sideOf(code: number): Side { return code > 0 ? 1 : -1; }
export function typeOf(code: number): number { return Math.abs(code); }

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export function startBoard(): Int8Array {
  const b = new Int8Array(N);
  const back = [T.R, T.H, T.E, T.A, T.K, T.A, T.E, T.H, T.R];
  for (let c = 0; c < 9; c++) b[idx(0, c)] = -back[c];      // black back rank (top)
  b[idx(2, 1)] = -T.C; b[idx(2, 7)] = -T.C;                 // black cannons
  for (const c of [0, 2, 4, 6, 8]) b[idx(3, c)] = -T.P;     // black soldiers (row 3, mirrored to red row 6)
  for (let c = 0; c < 9; c++) b[idx(9, c)] = back[c];       // red back rank (bottom)
  b[idx(7, 1)] = T.C; b[idx(7, 7)] = T.C;                   // red cannons
  for (const c of [0, 2, 4, 6, 8]) b[idx(6, c)] = T.P;      // red soldiers
  return b;
}

export function createGame(): GameState { return { board: startBoard(), side: 1 }; }
export function cloneState(s: GameState): GameState { return { board: s.board.slice(), side: s.side }; }

export function applyMove(s: GameState, m: Move): GameState {
  const nb = s.board.slice();
  nb[m.to] = nb[m.from];
  nb[m.from] = EMPTY;
  return { board: nb, side: (-s.side) as Side };
}

// ── Move generation (pseudo-legal) ──────────────────────────────────────────────
export function genPseudo(board: Int8Array, side: Side): Move[] {
  const moves: Move[] = [];
  const enemy = (-side) as Side;
  const inPalace = (rr: number, cc: number) =>
    side === 1 ? (rr >= 7 && rr <= 9 && cc >= 3 && cc <= 5) : (rr >= 0 && rr <= 2 && cc >= 3 && cc <= 5);
  const ownSideElephant = (rr: number) => (side === 1 ? rr >= 5 : rr <= 4);

  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (p === EMPTY || sideOf(p) !== side) continue;
    const t = typeOf(p);
    const r = rowOf(i), c = colOf(i);

    if (t === T.R) {
      for (const [dr, dc] of DIRS4) {
        let rr = r + dr, cc = c + dc;
        while (inBoard(rr, cc)) {
          const q = board[idx(rr, cc)];
          if (q === EMPTY) moves.push({ from: i, to: idx(rr, cc), cap: 0 });
          else { if (sideOf(q) === enemy) moves.push({ from: i, to: idx(rr, cc), cap: q }); break; }
          rr += dr; cc += dc;
        }
      }
    } else if (t === T.C) {
      for (const [dr, dc] of DIRS4) {
        let rr = r + dr, cc = c + dc, screen = false;
        while (inBoard(rr, cc)) {
          const q = board[idx(rr, cc)];
          if (!screen) {
            if (q === EMPTY) moves.push({ from: i, to: idx(rr, cc), cap: 0 });
            else screen = true;
          } else {
            if (q !== EMPTY) { if (sideOf(q) === enemy) moves.push({ from: i, to: idx(rr, cc), cap: q }); break; }
          }
          rr += dr; cc += dc;
        }
      }
    } else if (t === T.H) {
      const cand = [
        [r + 2, c + 1, r + 1, c], [r + 2, c - 1, r + 1, c],
        [r - 2, c + 1, r - 1, c], [r - 2, c - 1, r - 1, c],
        [r + 1, c + 2, r, c + 1], [r + 1, c - 2, r, c - 1],
        [r - 1, c + 2, r, c + 1], [r - 1, c - 2, r, c - 1],
      ];
      for (const [tr, tc, lr, lc] of cand) {
        if (!inBoard(tr, tc) || board[idx(lr, lc)] !== EMPTY) continue; // leg blocked
        const q = board[idx(tr, tc)];
        if (q === EMPTY || sideOf(q) === enemy) moves.push({ from: i, to: idx(tr, tc), cap: q });
      }
    } else if (t === T.E) {
      const cand = [
        [r + 2, c + 2, r + 1, c + 1], [r + 2, c - 2, r + 1, c - 1],
        [r - 2, c + 2, r - 1, c + 1], [r - 2, c - 2, r - 1, c - 1],
      ];
      for (const [tr, tc, mr, mc] of cand) {
        if (!inBoard(tr, tc) || !ownSideElephant(tr)) continue; // cannot cross river
        if (board[idx(mr, mc)] !== EMPTY) continue;              // eye blocked
        const q = board[idx(tr, tc)];
        if (q === EMPTY || sideOf(q) === enemy) moves.push({ from: i, to: idx(tr, tc), cap: q });
      }
    } else if (t === T.A || t === T.K) {
      const cand = t === T.K
        ? [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]]
        : [[r + 1, c + 1], [r + 1, c - 1], [r - 1, c + 1], [r - 1, c - 1]];
      for (const [tr, tc] of cand) {
        if (!inPalace(tr, tc)) continue;
        const q = board[idx(tr, tc)];
        if (q === EMPTY || sideOf(q) === enemy) moves.push({ from: i, to: idx(tr, tc), cap: q });
      }
    } else if (t === T.P) {
      const fwd = side === 1 ? -1 : 1;
      const crossed = side === 1 ? r <= 4 : r >= 5;
      const cand: [number, number][] = [[r + fwd, c]];
      if (crossed) { cand.push([r, c - 1]); cand.push([r, c + 1]); }
      for (const [tr, tc] of cand) {
        if (!inBoard(tr, tc)) continue;
        const q = board[idx(tr, tc)];
        if (q === EMPTY || sideOf(q) === enemy) moves.push({ from: i, to: idx(tr, tc), cap: q });
      }
    }
  }
  return moves;
}

// ── Attack / check detection ────────────────────────────────────────────────────
export function findGeneral(board: Int8Array, side: Side): number {
  const code = side * T.K;
  for (let i = 0; i < N; i++) if (board[i] === code) return i;
  return -1;
}

export function generalsFacing(board: Int8Array): boolean {
  let gr = -1, gc = -1, br = -1, bc = -1;
  for (let i = 0; i < N; i++) {
    if (board[i] === T.K) { gr = rowOf(i); gc = colOf(i); }
    else if (board[i] === -T.K) { br = rowOf(i); bc = colOf(i); }
  }
  if (gc !== bc) return false;
  if (gr < 0 || br < 0) return false;
  const lo = Math.min(gr, br), hi = Math.max(gr, br);
  for (let r = lo + 1; r < hi; r++) if (board[idx(r, gc)] !== EMPTY) return false;
  return true;
}

export function squareAttacked(board: Int8Array, sq: number, by: Side): boolean {
  const r = rowOf(sq), c = colOf(sq);

  // general: orthogonal adjacency, or facing along an open file
  for (const [dr, dc] of DIRS4) {
    const rr = r + dr, cc = c + dc;
    if (inBoard(rr, cc) && board[idx(rr, cc)] === by * T.K) return true;
  }
  for (const dir of [-1, 1]) {
    let rr = r + dir;
    while (inBoard(rr, c)) {
      const q = board[idx(rr, c)];
      if (q !== EMPTY) { if (q === by * T.K) return true; break; }
      rr += dir;
    }
  }

  // chariot
  for (const [dr, dc] of DIRS4) {
    let rr = r + dr, cc = c + dc;
    while (inBoard(rr, cc)) {
      const q = board[idx(rr, cc)];
      if (q !== EMPTY) { if (q === by * T.R) return true; break; }
      rr += dr; cc += dc;
    }
  }

  // cannon: exactly one screen, then enemy cannon
  for (const [dr, dc] of DIRS4) {
    let rr = r + dr, cc = c + dc, screen = false;
    while (inBoard(rr, cc)) {
      const q = board[idx(rr, cc)];
      if (!screen) { if (q !== EMPTY) screen = true; }
      else { if (q !== EMPTY) { if (q === by * T.C) return true; break; } }
      rr += dr; cc += dc;
    }
  }

  // horse
  const hc = [
    [r - 2, c - 1, r - 1, c], [r - 2, c + 1, r - 1, c],
    [r + 2, c - 1, r + 1, c], [r + 2, c + 1, r + 1, c],
    [r - 1, c - 2, r, c - 1], [r - 1, c + 2, r, c + 1],
    [r + 1, c - 2, r, c - 1], [r + 1, c + 2, r, c + 1],
  ];
  for (const [sr, sc, lr, lc] of hc) {
    if (!inBoard(sr, sc) || board[idx(lr, lc)] !== EMPTY) continue;
    if (board[idx(sr, sc)] === by * T.H) return true;
  }

  // soldier
  if (by === 1) {
    if (inBoard(r + 1, c) && board[idx(r + 1, c)] === T.P) return true;       // forward
    if (r <= 4) {                                                              // crossed river -> sideways
      if (inBoard(r, c - 1) && board[idx(r, c - 1)] === T.P) return true;
      if (inBoard(r, c + 1) && board[idx(r, c + 1)] === T.P) return true;
    }
  } else {
    if (inBoard(r - 1, c) && board[idx(r - 1, c)] === -T.P) return true;
    if (r >= 5) {
      if (inBoard(r, c - 1) && board[idx(r, c - 1)] === -T.P) return true;
      if (inBoard(r, c + 1) && board[idx(r, c + 1)] === -T.P) return true;
    }
  }
  return false;
}

export function isKingSafe(board: Int8Array, side: Side): boolean {
  const g = findGeneral(board, side);
  if (g < 0) return false;
  if (generalsFacing(board)) return false;
  return !squareAttacked(board, g, (-side) as Side);
}

export function makeMove(board: Int8Array, m: Move): number {
  const cap = board[m.to];
  board[m.to] = board[m.from];
  board[m.from] = EMPTY;
  return cap;
}
export function unmakeMove(board: Int8Array, m: Move, cap: number): void {
  board[m.from] = board[m.to];
  board[m.to] = cap;
}

export function legalMoves(board: Int8Array, side: Side): Move[] {
  const pseudo = genPseudo(board, side);
  const out: Move[] = [];
  for (const m of pseudo) {
    const cap = makeMove(board, m);
    const ok = isKingSafe(board, side);
    unmakeMove(board, m, cap);
    if (ok) out.push(m);
  }
  return out;
}

export function isOver(board: Int8Array, side: Side): { over: boolean; winner: Side | 0 } {
  if (findGeneral(board, side) < 0) return { over: true, winner: (-side) as Side };
  if (findGeneral(board, (-side) as Side) < 0) return { over: true, winner: side };
  if (legalMoves(board, side).length === 0) return { over: true, winner: (-side) as Side }; // checkmate or 困毙
  return { over: false, winner: 0 };
}

// ── 和棋 / 长将 仲裁 ────────────────────────────────────────────────────────────
export interface Arbiter {
  /** 每次落子后的局面记录：哈希 + 该时刻"行棋方是否被将军" + 将军方 */
  pos: { h: number; inChk: boolean; by: Side | 0 }[];
  noCap: number;      // 连续无吃子的 plies
}

export function newArbiter(): Arbiter {
  return { pos: [], noCap: 0 };
}

/** 每步落子之后调用：sideToMove = 走完这一步后的行棋方，m = 刚走的着法。 */
export function arbiterPush(a: Arbiter, board: Int8Array, sideToMove: Side, m: Move): void {
  const inChk = !isKingSafe(board, sideToMove);
  a.pos.push({ h: boardHash(board, sideToMove), inChk, by: inChk ? ((-sideToMove) as Side) : 0 });
  a.noCap = m.cap !== 0 ? 0 : a.noCap + 1;
}

export interface DrawVerdict { draw: boolean; loser: Side | 0; reason: string }

/**
 * 判定和棋 / 长将（以"局面重复"为唯一依据，避免误杀正当连将进攻）：
 *  - 三次重复局面：若每次重复时都是**同一方在将军**（即同一方被将军），判该将军方负（长将）
 *  - 三次重复局面但将军方不一致 → 判和
 *  - 自然限着：连续 120 plies（60 回合）无吃子判和
 *
 * ⚠️ 早期实现用"同一方连续将军 3 次"判负，会把**不同子力轮番将军的正当进攻**误判为长将
 *    （实测 6 局有 3 局被误杀，触发时局面重复次数仅 1）。长将的本质是**局面循环**。
 */
export function arbiterVerdict(a: Arbiter): DrawVerdict {
  const last = a.pos[a.pos.length - 1];
  if (last !== undefined) {
    const same = a.pos.filter((p) => p.h === last.h);
    if (same.length >= 3) {
      // 重复局面里是否始终由同一方将军（=同一方一直被将军）
      const bys = new Set(same.map((p) => p.by));
      if (bys.size === 1 && last.by !== 0) {
        return { draw: false, loser: last.by as Side, reason: 'perpetual_check' };
      }
      return { draw: true, loser: 0, reason: 'repetition' };
    }
  }
  if (a.noCap >= 120) return { draw: true, loser: 0, reason: 'no_capture' };
  return { draw: false, loser: 0, reason: '' };
}

// ── Evaluation (swappable) ──────────────────────────────────────────────────────
const VAL: Record<number, number> = {
  [T.K]: 6000, [T.R]: 600, [T.C]: 285, [T.H]: 300, [T.E]: 130, [T.A]: 130, [T.P]: 30,
};

// Lightweight positional bonus (from the piece's own perspective).
function posBonus(code: number, r: number, c: number): number {
  const t = typeOf(code), s = sideOf(code);
  // 🔴 注意方向：红方(s=1)底线在 row 9，黑方(s=-1)底线在 row 0。
  // rr 必须归一化成「0 = 己方底线，9 = 敌方底线」，否则过河奖励会给到没过河的子。
  const rr = s === 1 ? 9 - r : r;
  const center = 4 - Math.abs(c - 4);   // 0..4
  let b = 0;
  switch (t) {
    case T.P: b += rr * 2; if (rr >= 5) b += 20; b += center * 2; break; // crossing river bonus
    case T.H: b += center * 3 + rr; break;
    case T.C: b += center * 2 + rr; break;
    case T.R: b += center + rr * 2; break;
    case T.E: b += center * 2; break;
    case T.A: b += center * 2; break;
    case T.K: b += center; break;
  }
  return b;
}

// Default classical evaluation. Replaceable by a TF.js value head (Phase 2).
export function evaluate(board: Int8Array, side: Side): number {
  let s = 0;
  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (p === EMPTY) continue;
    const v = VAL[typeOf(p)] + posBonus(p, rowOf(i), colOf(i));
    s += sideOf(p) === side ? v : -v;
  }
  return s;
}

// ── Search (negamax + alpha-beta + quiescence + iterative deepening) ─────────────
const MATE = 100000;
const INF = 1e9;
const TIMEOUT = Symbol('timeout');

interface Ctx {
  nodes: number;
  deadline: number;
  tt: Map<number, { d: number; f: number; s: number; m: Move | null }>;
  path: Set<number>; // 当前搜索路径上的局面哈希（用于识别循环）
}

function orderMoves(moves: Move[]): void {
  moves.sort((a, b) => mvvLva(b) - mvvLva(a));
}
function mvvLva(m: Move): number {
  if (m.cap === 0) return 0;
  return VAL[typeOf(m.cap)] * 10 - typeOf(m.cap);
}

// simple zobrist
const ZOB: Int32Array = (() => {
  const a = new Int32Array(N * 14 + 2);
  let seed = 0x9e3779b9;
  for (let i = 0; i < a.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    a[i] = seed | 0;
  }
  return a;
})();
function boardHash(board: Int8Array, side: Side): number {
  let h = side === 1 ? ZOB[N * 14] : ZOB[N * 14 + 1];
  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (p !== EMPTY) h = (h ^ ZOB[i * 14 + (p + 7)]) | 0;
  }
  return h;
}

function qsearch(board: Int8Array, side: Side, alpha: number, beta: number, ply: number, ctx: Ctx): number {
  if ((ctx.nodes++ & 2047) === 0 && perfNow() > ctx.deadline) throw TIMEOUT;
  // 被将军时不能用静态评估兜底（会把杀棋误判成普通局面），必须枚举所有应将手段
  const inChk = !isKingSafe(board, side);
  if (!inChk) {
    const stand = evaluate(board, side);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
  }
  const moves = inChk ? legalMoves(board, side) : genPseudo(board, side).filter((m) => m.cap !== 0);
  if (inChk && moves.length === 0) return -MATE + ply; // 将死
  orderMoves(moves);
  for (const m of moves) {
    const cap = makeMove(board, m);
    if (!inChk && !isKingSafe(board, side)) { unmakeMove(board, m, cap); continue; }
    const score = -qsearch(board, (-side) as Side, -beta, -alpha, ply + 1, ctx);
    unmakeMove(board, m, cap);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(board: Int8Array, side: Side, depth: number, alpha: number, beta: number, ply: number, ctx: Ctx): number {
  if ((ctx.nodes++ & 2047) === 0 && perfNow() > ctx.deadline) throw TIMEOUT;
  if (depth <= 0) return qsearch(board, side, alpha, beta, ply, ctx);

  const key = boardHash(board, side);
  // 搜索路径内出现重复局面 → 按和棋处理，避免 AI 把"兜圈子"算成有利
  if (ctx.path.has(key)) return 0;
  ctx.path.add(key);
  try {
    return negamaxBody(board, side, depth, alpha, beta, ply, ctx, key);
  } finally {
    ctx.path.delete(key);
  }
}

function negamaxBody(board: Int8Array, side: Side, depth: number, alpha: number, beta: number, ply: number, ctx: Ctx, key: number): number {
  const tt = ctx.tt.get(key);
  if (tt && tt.d >= depth) {
    // 置换表里存的是「相对根节点的杀棋距离」，取用时需按当前 ply 还原
    let s = tt.s;
    if (s > MATE - 1000) s -= ply; else if (s < -MATE + 1000) s += ply;
    if (tt.f === 0) return s;
    if (tt.f === 1 && s > alpha) alpha = s;   // lower bound
    if (tt.f === -1 && s < beta) beta = s;    // upper bound
    if (alpha >= beta) return s;
  }

  const pseudo = genPseudo(board, side);
  orderMoves(pseudo);
  // 🔴 必须保存原始 alpha：下面的循环会不断抬高 alpha，
  // 若用抬高后的 alpha 判断 flag，会把「精确值」误标成上界，污染置换表。
  const alphaOrig = alpha;
  let best = -INF;
  let bestMove: Move | null = null;
  let anyLegal = false;
  for (const m of pseudo) {
    const cap = makeMove(board, m);
    if (!isKingSafe(board, side)) { unmakeMove(board, m, cap); continue; }
    anyLegal = true;
    const score = -negamax(board, (-side) as Side, depth - 1, -beta, -alpha, ply + 1, ctx);
    unmakeMove(board, m, cap);
    if (score > best) { best = score; bestMove = m; }
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  if (!anyLegal) return -MATE + ply; // checkmate or 困毙 = loss for side to move

  const flag = best <= alphaOrig ? -1 : best >= beta ? 1 : 0;
  // 存表时把杀棋距离换算回「相对根节点」
  let st = best;
  if (st > MATE - 1000) st += ply; else if (st < -MATE + 1000) st -= ply;
  ctx.tt.set(key, { d: depth, f: flag, s: st, m: bestMove });
  return best;
}

function searchRoot(board: Int8Array, side: Side, depth: number, alpha: number, beta: number, ctx: Ctx): { move: Move | null; score: number } {
  const pseudo = genPseudo(board, side);
  orderMoves(pseudo);
  let best = -INF, bestMove: Move | null = null, anyLegal = false;
  for (const m of pseudo) {
    const cap = makeMove(board, m);
    if (!isKingSafe(board, side)) { unmakeMove(board, m, cap); continue; }
    anyLegal = true;
    const score = -negamax(board, (-side) as Side, depth - 1, -beta, -alpha, 1, ctx);
    unmakeMove(board, m, cap);
    if (score > best) { best = score; bestMove = m; }
    if (score > alpha) alpha = score;
  }
  if (!anyLegal) return { move: null, score: -MATE };
  return { move: bestMove, score: best };
}

export type Level = 'easy' | 'medium' | 'hard';
const LIMITS: Record<Level, { maxDepth: number; time: number; rand: boolean }> = {
  easy: { maxDepth: 2, time: 350, rand: true },
  medium: { maxDepth: 4, time: 800, rand: false },
  hard: { maxDepth: 6, time: 1600, rand: false },
};

export interface SearchResult { move: Move | null; score: number; nodes: number; depth: number; }

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function search(state: GameState, level: Level, timeMs?: number): SearchResult {
  const board = state.board;
  const side = state.side;
  const lim = LIMITS[level];
  const ctx: Ctx = { nodes: 0, deadline: perfNow() + (timeMs ?? lim.time), tt: new Map(), path: new Set() };

  let bestMove: Move | null = null, bestScore = 0, reached = 0;
  for (let d = 1; d <= lim.maxDepth; d++) {
    try {
      const r = searchRoot(board, side, d, -INF, INF, ctx);
      if (r.move) { bestMove = r.move; bestScore = r.score; reached = d; }
    } catch (e) {
      if (e === TIMEOUT) break;
      throw e;
    }
    if (Math.abs(bestScore) > MATE - 1000) break;
    if (perfNow() > ctx.deadline) break;
  }

  if (lim.rand && bestMove) {
    // easy: pick randomly among root moves not blundering (within 100cp of best)
    const pool: Move[] = [];
    const pseudo = genPseudo(board, side);
    for (const m of pseudo) {
      const cap = makeMove(board, m);
      if (!isKingSafe(board, side)) { unmakeMove(board, m, cap); continue; }
      const sc = -negamax(board, (-side) as Side, 1, -INF, INF, 1, ctx);
      unmakeMove(board, m, cap);
      if (sc > bestScore - 100) pool.push(m);
    }
    if (pool.length) bestMove = pool[(Math.random() * pool.length) | 0];
  }

  if (!bestMove) {
    const lm = legalMoves(board, side);
    if (lm.length) bestMove = lm[(Math.random() * lm.length) | 0];
  }
  return { move: bestMove, score: bestScore, nodes: ctx.nodes, depth: reached };
}

// ── Self test ───────────────────────────────────────────────────────────────────
export function selfTest(): { pass: boolean; msg: string }[] {
  const out: { pass: boolean; msg: string }[] = [];

  const g = createGame();
  const lm = legalMoves(g.board, g.side);
  out.push({ pass: lm.length === 44, msg: `opening legal moves = ${lm.length} (expect 44)` });

  // flying general: two generals face on open file => illegal to leave them facing,
  // and squareAttacked must detect general-facing check.
  {
    const b = new Int8Array(N);
    b[idx(0, 4)] = -T.K;      // black general top, col 4
    b[idx(9, 4)] = T.K;       // red general bottom, col 4, nothing between
    out.push({ pass: generalsFacing(b) === true, msg: 'generalsFacing detects open-file facing' });
    out.push({ pass: squareAttacked(b, idx(0, 4), 1) === true, msg: 'general-facing counts as attack' });
  }

  // cannon must jump exactly one screen to capture
  {
    const b = new Int8Array(N);
    b[idx(5, 0)] = T.C;       // red cannon (only red piece on the board)
    b[idx(5, 3)] = -T.P;      // black pawn as screen (enemy, cannot also capture)
    b[idx(5, 6)] = -T.R;      // black rook target
    // cannon at (5,0), screen at (5,3), target at (5,6) -> exactly one capture
    const caps = genPseudo(b, 1).filter((m) => m.to === idx(5, 6));
    out.push({ pass: caps.length === 1 && caps[0].cap === -T.R, msg: 'cannon captures across one screen' });
    // if no screen, cannon cannot capture rook at (5,6)
    b[idx(5, 3)] = EMPTY;
    const caps2 = genPseudo(b, 1).filter((m) => m.to === idx(5, 6));
    out.push({ pass: caps2.length === 0, msg: 'cannon cannot capture without screen' });
  }

  // horse leg block
  {
    const b = new Int8Array(N);
    b[idx(5, 4)] = T.H;       // red horse
    b[idx(4, 4)] = T.R;       // own piece blocking the leg upward
    const moves = genPseudo(b, 1).filter((m) => m.from === idx(5, 4));
    // horse at (5,4) with leg (4,4) blocked cannot jump to (3,3)/(3,5)
    const blocked = moves.some((m) => m.to === idx(3, 3) || m.to === idx(3, 5));
    out.push({ pass: !blocked, msg: 'horse leg block prevents jump' });
  }

  // elephant cannot cross river
  {
    const b = new Int8Array(N);
    b[idx(9, 2)] = T.E;       // red elephant home
    const moves = genPseudo(b, 1).filter((m) => m.from === idx(9, 2));
    const crosses = moves.some((m) => rowOf(m.to) <= 4);
    out.push({ pass: !crosses, msg: 'elephant cannot cross river' });
  }

  return out;
}

// board <-> FEN-ish string (for debugging / tests)
export function toAscii(board: Int8Array): string {
  const glyph: Record<number, string> = {
    [T.K]: 'K', [T.A]: 'A', [T.E]: 'E', [T.H]: 'H', [T.R]: 'R', [T.C]: 'C', [T.P]: 'P',
  };
  let s = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[idx(r, c)];
      s += p === EMPTY ? '.' : (p > 0 ? glyph[typeOf(p)] : glyph[typeOf(p)].toLowerCase());
    }
    s += '\n';
  }
  return s;
}
