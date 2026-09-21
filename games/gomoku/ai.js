/* ═══════════════════════════════════════════════════════════════
   gomoku 五子棋 — 前端本地核心 + 人机 AI（ESM）
   供 /games/gomoku/index.html 直接 import，也可被 Node 单测引入。
   15×15 棋盘，黑先白后，简单规则（无禁手），先五连者胜。
   多档难度：easy(入门) / normal(普通) / hard(困难)。
   ═══════════════════════════════════════════════════════════════ */

export const SIZE = 15;
export const CELLS = SIZE * SIZE;

export function newGame() {
  return { board: new Array(CELLS).fill(null), turn: 0, status: 'playing', winner: null, winLine: null, lastMove: null, moveCount: 0 };
}

export function canMove(g, player, cell) {
  const c = Number(cell);
  if (g.status !== 'playing') return { ok: false, error: '对局已结束' };
  if (player !== g.turn) return { ok: false, error: '还没轮到你' };
  if (!Number.isInteger(c) || c < 0 || c >= CELLS) return { ok: false, error: '非法位置' };
  if (g.board[c] !== null) return { ok: false, error: '该点已占' };
  return { ok: true, cell: c };
}

export const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const inB = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

export function lineOf(board, r, c) {
  const p = board[r * SIZE + c];
  if (p == null) return null;
  for (const [dr, dc] of DIRS) {
    const cells = [r * SIZE + c];
    let fr = r + dr, fc = c + dc;
    for (; inB(fr, fc) && board[fr * SIZE + fc] === p; fr += dr, fc += dc) cells.push(fr * SIZE + fc);
    let br = r - dr, bc = c - dc;
    for (; inB(br, bc) && board[br * SIZE + bc] === p; br -= dr, bc -= dc) cells.push(br * SIZE + bc);
    if (cells.length >= 5) return cells;
  }
  return null;
}

export function applyMove(g, player, cell) {
  const chk = canMove(g, player, cell);
  if (!chk.ok) return { ok: false, error: chk.error };
  const c = chk.cell;
  g.board[c] = player;
  g.moveCount++;
  g.lastMove = c;
  const line = lineOf(g.board, Math.floor(c / SIZE), c % SIZE);
  if (line) { g.status = 'over'; g.winner = player; g.winLine = line; return { ok: true, event: 'win', winner: player }; }
  if (g.moveCount === CELLS) { g.status = 'over'; g.winner = null; return { ok: true, event: 'draw' }; }
  g.turn = player === 0 ? 1 : 0;
  return { ok: true, event: 'move', turn: g.turn };
}

export function snapshot(g) {
  return { board: g.board, turn: g.status === 'playing' ? g.turn : -1, status: g.status, winner: g.status === 'over' ? g.winner : null, winLine: g.winLine || null, lastMove: g.lastMove };
}

/* ───────────── 人机 AI ───────────── */
// 在空位落 player 后，沿四方向计连通段（含空格分隔外的紧邻连续），按活/眠给分。
function segScore(nb, r, c, player) {
  let total = 0;
  for (const [dr, dc] of DIRS) {
    let len = 1;
    let fr = r + dr, fc = c + dc;
    for (; inB(fr, fc) && nb[fr * SIZE + fc] === player; fr += dr, fc += dc) len++;
    let br = r - dr, bc = c - dc;
    for (; inB(br, bc) && nb[br * SIZE + bc] === player; br -= dr, bc -= dc) len++;
    const openLeft = inB(br, bc) && nb[br * SIZE + bc] === null;
    const openRight = inB(fr, fc) && nb[fr * SIZE + fc] === null;
    let v = 0;
    if (len >= 5) v = 1000000;
    else if (len === 4) v = (openLeft && openRight) ? 100000 : (openLeft || openRight ? 10000 : 0);
    else if (len === 3) v = (openLeft && openRight) ? 10000 : (openLeft || openRight ? 1000 : 0);
    else if (len === 2) v = (openLeft && openRight) ? 1000 : (openLeft || openRight ? 100 : 0);
    else if (len === 1) v = (openLeft && openRight) ? 100 : (openLeft || openRight ? 10 : 0);
    total += v;
  }
  return total;
}

function evaluateCell(nb, r, c, myPlayer) {
  const opp = myPlayer === 0 ? 1 : 0;
  const off = segScore(nb, r, c, myPlayer);
  const def = segScore(nb, r, c, opp);
  return { off, def, total: off + Math.round(def * 0.95) };
}

const pick = a => a[Math.floor(Math.random() * a.length)];

// chooseMove(g, myPlayer, difficulty) → 落子格子(0..224) | null
// 每格开辟中心优先（让 AI 开局不至于乱飞），再叠加启发式。
export function chooseMove(g, myPlayer, difficulty) {
  const nb = g.board;
  let best = null, bestV = -Infinity, winCells = [], blockCells = [];
  let any = false;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (nb[r * SIZE + c] !== null) continue;
      any = true;
      // 中心邻域微权，让开局更集中
      const center = (Math.abs(r - 7) + Math.abs(c - 7));
      const ev = evaluateCell(nb, r, c, myPlayer);
      if (ev.off >= 1000000) winCells.push(r * SIZE + c);
      if (ev.def >= 100000) blockCells.push(r * SIZE + c); // 成五/活四均须封堵
      const v = ev.total + (center * 3);
      if (v > bestV) { bestV = v; best = r * SIZE + c; }
    }
  }
  if (!any) return null;
  if (winCells.length) return pick(winCells); // 必胜必走
  if (blockCells.length) {
    const p = difficulty === 'hard' ? 1 : difficulty === 'normal' ? 0.8 : 0.5;
    if (Math.random() < p) return pick(blockCells);
  }
  if (difficulty === 'easy') {
    if (Math.random() < 0.7) { const e = []; for (let i = 0; i < CELLS; i++) if (nb[i] === null) e.push(i); return pick(e); }
    return best;
  }
  if (difficulty === 'normal') {
    if (Math.random() < 0.06) { const e = []; for (let i = 0; i < CELLS; i++) if (nb[i] === null) e.push(i); return pick(e); }
    return best;
  }
  return best; // hard：最优启发式
}