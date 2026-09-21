/* ═══════════════════════════════════════════════════════════════
   connect4 四子棋 — 前端本地核心 + 人机 AI（ESM）
   7×6 垂直下落，先四连(横/竖/斜)者胜。
   AI：一步必胜/封堵 + 窗口启发式 + 限深 negamax（难度决定深度）。
   多档难度：easy / normal / hard。
   ═══════════════════════════════════════════════════════════════ */

export const COLS = 7;
export const ROWS = 6;
export const CELLS = COLS * ROWS;

export function newGame() {
  return { board: new Array(CELLS).fill(null), turn: 0, status: 'playing', winner: null, winLine: null, lastMove: null, moveCount: 0 };
}
const inB = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

export function dropCell(board, col) { for (let r = ROWS - 1; r >= 0; r--) { const i = r * COLS + col; if (board[i] === null) return { r, i }; } return null; }
export function columnFull(board, col) { return board[col] !== null; }

export function canMove(g, player, col) {
  const c = Number(col);
  if (g.status !== 'playing') return { ok: false, error: '对局已结束' };
  if (player !== g.turn) return { ok: false, error: '还没轮到你' };
  if (!Number.isInteger(c) || c < 0 || c >= COLS) return { ok: false, error: '非法列' };
  if (columnFull(g.board, c)) return { ok: false, error: '该列已满' };
  return { ok: true, col: c };
}
export const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export function lineOf(board, r, c) {
  const p = board[r * COLS + c]; if (p == null) return null;
  for (const [dr, dc] of DIRS) {
    const cells = [r * COLS + c];
    let fr = r + dr, fc = c + dc;
    for (; inB(fr, fc) && board[fr * COLS + fc] === p; fr += dr, fc += dc) cells.push(fr * COLS + fc);
    let br = r - dr, bc = c - dc;
    for (; inB(br, bc) && board[br * COLS + bc] === p; br -= dr, bc -= dc) cells.push(br * COLS + bc);
    if (cells.length >= 4) return cells;
  }
  return null;
}

export function applyMove(g, player, col) {
  const chk = canMove(g, player, col); if (!chk.ok) return { ok: false, error: chk.error };
  const cell = dropCell(g.board, chk.col);
  g.board[cell.i] = player; g.moveCount++; g.lastMove = cell.i;
  const line = lineOf(g.board, cell.r, chk.col);
  if (line) { g.status = 'over'; g.winner = player; g.winLine = line; return { ok: true, event: 'win', winner: player }; }
  if (g.moveCount === CELLS) { g.status = 'over'; g.winner = null; return { ok: true, event: 'draw' }; }
  g.turn = player === 0 ? 1 : 0;
  return { ok: true, event: 'move', turn: g.turn };
}
export function snapshot(g) { return { board: g.board, turn: g.status === 'playing' ? g.turn : -1, status: g.status, winner: g.status === 'over' ? g.winner : null, winLine: g.winLine || null, lastMove: g.lastMove }; }

/* ───────────── 人机 AI ───────────── */
// 所有 4 连窗（索引组合）用于评估
const WINDOWS = (() => {
  const w = [];
  for (let r = 0; r < ROWS; r++) for (let cIdx = 0; cIdx < COLS; cIdx++) {
    for (const [dr, dc] of DIRS) {
      const cells = [];
      for (let k = 0; k < 4; k++) { const nr = r + dr * k, nc = cIdx + dc * k; if (!inB(nr, nc)) break; cells.push(nr * COLS + nc); }
      if (cells.length === 4) w.push(cells);
    }
  }
  return w;
})();

function evalBoard(board, player) {
  const opp = player === 0 ? 1 : 0;
  let score = 0;
  for (const w of WINDOWS) {
    let mine = 0, yours = 0;
    for (const i of w) { if (board[i] === player) mine++; else if (board[i] === opp) yours++; }
    if (mine && yours) continue; // 混合窗忽略
    if (mine) score += [0, 1, 10, 100, 100000][mine];
    if (yours) score -= [0, 1, 10, 100, 100000][yours];
  }
  // 中心列偏好
  for (let r = 0; r < ROWS; r++) if (board[r * COLS + 3] === player) score += 3;
  return score;
}

// negamax + alpha-beta，返回该局面（轮到 cur）相对 cur 的分值
function negamaxReal(board, cur, depth, alpha, beta) {
  const opp = cur === 0 ? 1 : 0;
  // 已满
  if (board.every(x => x !== null)) return 0;
  if (depth === 0) return evalBoard(board, cur);
  let value = -Infinity;
  const order = [3, 2, 4, 1, 5, 0, 6];
  for (const c of order) {
    if (columnFull(board, c)) continue;
    const cell = dropCell(board, c);
    board[cell.i] = cur;
    let s;
    if (lineOf(board, cell.r, c)) s = 100000 + depth;
    else s = -negamaxReal(board, opp, depth - 1, -beta, -alpha);
    board[cell.i] = null;
    if (s > value) value = s;
    if (value > alpha) alpha = value;
    if (alpha >= beta) break;
  }
  return value === -Infinity ? 0 : value;
}

const pick = a => a[Math.floor(Math.random() * a.length)];
const ORDER = [3, 2, 4, 1, 5, 0, 6];

// chooseMove(g, myPlayer, difficulty) → 列索引(0..6) | null
export function chooseMove(g, myPlayer, difficulty) {
  const opp = myPlayer === 0 ? 1 : 0;
  const legal = ORDER.filter(c => !columnFull(g.board, c));
  if (!legal.length) return null;
  // 一步必胜
  const wins = legal.filter(c => { const cell = dropCell(g.board, c); g.board[cell.i] = myPlayer; const w = lineOf(g.board, cell.r, c); g.board[cell.i] = null; return !!w; });
  if (wins.length) return pick(wins);
  // 封堵对方必胜
  const blocks = legal.filter(c => { const cell = dropCell(g.board, c); g.board[cell.i] = opp; const w = lineOf(g.board, cell.r, c); g.board[cell.i] = null; return !!w; });
  if (blocks.length) {
    const p = difficulty === 'hard' ? 1 : difficulty === 'normal' ? 0.8 : 0.5;
    if (Math.random() < p) return pick(blocks);
  }
  if (difficulty === 'easy' && Math.random() < 0.7) return pick(legal);
  const depth = difficulty === 'hard' ? 5 : difficulty === 'normal' ? 3 : 1;
  let best = null, bestV = -Infinity;
  for (const c of legal) {
    const cell = dropCell(g.board, c);
    g.board[cell.i] = myPlayer;
    let s;
    if (lineOf(g.board, cell.r, c)) s = 100000 + depth;
    else s = -negamaxReal(g.board, opp, depth - 1, -Infinity, Infinity);
    g.board[cell.i] = null;
    if (s > bestV) { bestV = s; best = c; }
  }
  // normal 低概率偏离最优（取合法列打乱次序挑，避免千篇一律）
  if (difficulty === 'normal' && Math.random() < 0.08) return pick(legal);
  return best;
}