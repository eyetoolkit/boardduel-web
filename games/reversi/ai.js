/* ═══════════════════════════════════════════════════════════════
   othello 翻转棋 — 前端本地核心 + 人机 AI（ESM）
   AI：启发式(权重矩阵+机动性) + 限深 negamax（难度决定深度）。
   多档难度：easy / normal / hard。
   ═══════════════════════════════════════════════════════════════ */

export const SIZE = 8;
export const CELLS = SIZE * SIZE;

export function newGame() {
  const board = new Array(CELLS).fill(null);
  board[27] = 1; board[36] = 1; board[28] = 0; board[35] = 0;
  return { board, turn: 0, status: 'playing', winner: null, moveCount: 0, lastMove: null, passes: 0 };
}

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const inB = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

export function outflank(board, player, r, c) {
  const flips = [];
  for (const [dr, dc] of DIRS) {
    let nr = r + dr, nc = c + dc, tmp = [];
    while (inB(nr, nc) && board[nr * SIZE + nc] !== null && board[nr * SIZE + nc] !== player) { tmp.push(nr * SIZE + nc); nr += dr; nc += dc; }
    if (inB(nr, nc) && board[nr * SIZE + nc] === player) flips.push(...tmp);
  }
  return flips;
}
export function legalCells(board, player) {
  const out = [];
  for (let i = 0; i < CELLS; i++) if (board[i] === null && outflank(board, player, Math.floor(i / SIZE), i % SIZE).length) out.push(i);
  return out;
}
export function canMove(g, player, cell) {
  const c = Number(cell);
  if (g.status !== 'playing') return { ok: false, error: '对局已结束' };
  if (player !== g.turn) return { ok: false, error: '还没轮到你' };
  if (!Number.isInteger(c) || c < 0 || c >= CELLS) return { ok: false, error: '非法位置' };
  if (g.board[c] !== null) return { ok: false, error: '该处已有棋子' };
  if (!outflank(g.board, player, Math.floor(c / SIZE), c % SIZE).length) return { ok: false, error: '该处无法翻转对手' };
  return { ok: true, cell: c };
}
export function countBoard(board) { const c = [0, 0]; for (const v of board) if (v != null) c[v]++; return c; }
export function applyMove(g, player, cell) {
  const chk = canMove(g, player, cell); if (!chk.ok) return { ok: false, error: chk.error };
  const r = Math.floor(chk.cell / SIZE), c = chk.cell % SIZE;
  const flips = outflank(g.board, player, r, c);
  g.board[chk.cell] = player; for (const f of flips) g.board[f] = player;
  g.moveCount++; g.lastMove = chk.cell; g.passes = 0;
  const next = player === 0 ? 1 : 0;
  if (legalCells(g.board, next).length) { g.turn = next; return { ok: true, event: 'move', flips: flips.length, turn: g.turn }; }
  if (legalCells(g.board, player).length) { g.passes = 1; g.turn = player; return { ok: true, event: 'pass', turn: g.turn }; }
  const cnt = countBoard(g.board); g.status = 'over';
  g.winner = cnt[0] === cnt[1] ? null : (cnt[0] > cnt[1] ? 0 : 1); g.finalCount = cnt;
  return { ok: true, event: 'over', winner: g.winner, count: cnt };
}
export function snapshot(g) { return { board: g.board, turn: g.status === 'playing' ? g.turn : -1, status: g.status, winner: g.status === 'over' ? g.winner : null, lastMove: g.lastMove, finalCount: g.finalCount || countBoard(g.board) }; }

/* ───────────── 人机 AI ───────────── */
const W = [
  [120, -20, 20, 5, 5, 20, -20, 120],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [120, -20, 20, 5, 5, 20, -20, 120],
];

function evalBoard(board, player) {
  const opp = player === 0 ? 1 : 0;
  let score = 0;
  for (let i = 0; i < CELLS; i++) {
    const v = board[i];
    if (v == null) continue;
    score += (v === player ? 1 : -1) * W[Math.floor(i / SIZE)][i % SIZE];
  }
  const mm = legalCells(board, player).length, om = legalCells(board, opp).length;
  // 机动性
  score += (mm - om) * 10;
  return score;
}

function negamax(board, cur, depth, alpha, beta) {
  const opp = cur === 0 ? 1 : 0;
  const moves = legalCells(board, cur);
  if (!moves.length) {
    if (!legalCells(board, opp).length) { const c = countBoard(board); return c[0] === c[1] ? 0 : (c[cur] > c[opp] ? 100000 : -100000); }
    return -negamax(board, opp, depth - 1, -beta, -alpha);
  }
  if (depth === 0) return evalBoard(board, cur);
  let value = -Infinity;
  for (const i of moves) {
    const r = Math.floor(i / SIZE), c = i % SIZE;
    const flips = outflank(board, cur, r, c);
    board[i] = cur; for (const f of flips) board[f] = cur;
    const s = -negamax(board, opp, depth - 1, -beta, -alpha);
    board[i] = null; for (const f of flips) board[f] = opp;
    if (s > value) value = s;
    if (value > alpha) alpha = value;
    if (alpha >= beta) break;
  }
  return value;
}

const pick = a => a[Math.floor(Math.random() * a.length)];

export function bestMove(board, player, depth) {
  const moves = legalCells(board, player);
  if (!moves.length) return null;
  let best = null, bestV = -Infinity;
  for (const i of moves) {
    const r = Math.floor(i / SIZE), c = i % SIZE;
    const flips = outflank(board, player, r, c);
    board[i] = player; for (const f of flips) board[f] = player;
    let s;
    if (!legalCells(board, player === 0 ? 1 : 0).length) { const cnt = countBoard(board); s = cnt[player] > cnt[player === 0 ? 1 : 0] ? 100000 : -100000; }
    else s = -negamax(board, player === 0 ? 1 : 0, depth - 1, -Infinity, Infinity);
    board[i] = null; for (const f of flips) board[f] = player === 0 ? 1 : 0;
    if (s > bestV) { bestV = s; best = i; }
  }
  return best;
}

// chooseMove(g, myPlayer, difficulty) → 落子格子 | null（无合法者返回 null = 跳过）
export function chooseMove(g, myPlayer, difficulty) {
  const moves = legalCells(g.board, myPlayer);
  if (!moves.length) return null;
  if (difficulty === 'easy' && Math.random() < 0.7) return pick(moves);
  const depth = difficulty === 'hard' ? 3 : difficulty === 'normal' ? 2 : 1;
  const b = bestMove(g.board, myPlayer, depth);
  if (difficulty === 'normal' && Math.random() < 0.06) return pick(moves);
  return b;
}