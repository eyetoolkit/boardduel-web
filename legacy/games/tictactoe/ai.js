/* ═══════════════════════════════════════════════════════════════
   tictactoe 井字棋 — 前端本地核心 + 人机 AI（ESM）
   供 /games/tictactoe/index.html 直接 import，也可被 Node 单测引入。
   多档难度：easy(入门) / normal(普通) / hard(困难)。
   ═══════════════════════════════════════════════════════════════ */

export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function newGame() {
  return { board: new Array(9).fill(null), turn: 0, status: 'playing', winner: null, winLine: null, moveCount: 0 };
}

export function canMove(g, player, cell) {
  const c = Number(cell);
  if (g.status !== 'playing') return { ok: false, error: '对局已结束' };
  if (player !== g.turn) return { ok: false, error: '还没轮到你' };
  if (!Number.isInteger(c) || c < 0 || c > 8) return { ok: false, error: '非法格子' };
  if (g.board[c] !== null) return { ok: false, error: '该格已占' };
  return { ok: true, cell: c };
}

function lineWin(board, player, cell) {
  for (const l of LINES) {
    if (!l.includes(cell)) continue;
    if (l.every(i => board[i] === player)) return l;
  }
  return null;
}

export function applyMove(g, player, cell) {
  const chk = canMove(g, player, cell);
  if (!chk.ok) return { ok: false, error: chk.error };
  g.board[chk.cell] = player;
  g.moveCount++;
  const line = lineWin(g.board, player, chk.cell);
  if (line) { g.status = 'over'; g.winner = player; g.winLine = line; return { ok: true, event: 'win', winner: player }; }
  if (g.moveCount === 9) { g.status = 'over'; g.winner = null; return { ok: true, event: 'draw' }; }
  g.turn = player === 0 ? 1 : 0;
  return { ok: true, event: 'move', turn: g.turn };
}

export function snapshot(g) {
  return { board: g.board, turn: g.status === 'playing' ? g.turn : -1, status: g.status, winner: g.status === 'over' ? g.winner : null, winLine: g.winLine || null };
}

/* ───────────── 人机 AI ───────────── */
const clone = b => b.slice();
function winnerOf(b) {
  for (const l of LINES) {
    const a = [b[l[0]], b[l[1]], b[l[2]]];
    if (a[0] !== null && a[0] === a[1] && a[1] === a[2]) return a[0];
  }
  return null;
}
function emptyCells(b) { const r = []; for (let i = 0; i < 9; i++) if (b[i] === null) r.push(i); return r; }
function nextTurn(t) { return t === 0 ? 1 : 0; }

// minimax：从 board 轮到 turn、以 player 为视角返回分数（胜+10/负-10/平0）
function best(board, turn, player) {
  const w = winnerOf(board);
  if (w !== null) return w === player ? 10 : -10;
  const e = emptyCells(board);
  if (!e.length) return 0;
  if (turn === player) {
    let s = -Infinity;
    for (const i of e) { const nb = clone(board); nb[i] = player; s = Math.max(s, best(nb, nextTurn(turn), player)); }
    return s;
  }
  let s = Infinity;
  for (const i of e) { const nb = clone(board); nb[i] = turn; s = Math.min(s, best(nb, nextTurn(turn), player)); }
  return s;
}

// 返回当前最优落子（对方无回落时），及把该格给 opp 是否立即获胜（即我方需防守的格子）
function scoreBoard(board, player) {
  const opp = nextTurn(player);
  const e = emptyCells(board);
  const scores = e.map(i => { const nb = clone(board); nb[i] = player; return best(nb, nextTurn(player), player); });
  let max = -Infinity, bi = 0;
  scores.forEach((s, k) => { if (s > max) { max = s; bi = k; } });
  const blocks = e.filter(i => { const nb = clone(board); nb[i] = opp; return winnerOf(nb) === opp; });
  return { e, scores, bestCell: e[bi], blocks };
}

const pick = a => a[Math.floor(Math.random() * a.length)];

// 从可选格子里挑一个“非最差”的随机格：排除会让对手立刻获胜的空位
function safeRand(e, board, myPlayer) {
  const opp = nextTurn(myPlayer);
  const safe = e.filter(i => { const nb = clone(board); nb[i] = myPlayer; if (winnerOf(nb) === myPlayer) return false; const nb2 = clone(board); nb2[i] = opp; return winnerOf(nb2) !== opp; });
  return pick(safe.length ? safe : e);
}

// chooseMove(g, myPlayer, difficulty) → 落子格子(0..8) | null
export function chooseMove(g, myPlayer, difficulty) {
  const opp = nextTurn(myPlayer);
  const e = emptyCells(g.board);
  if (!e.length) return null;

  // 任意难度：能一步获胜必走
  const win = e.filter(i => { const nb = clone(g.board); nb[i] = myPlayer; return winnerOf(nb) === myPlayer; });
  if (win.length) return pick(win);

  const sc = scoreBoard(g.board, myPlayer);

  // 防守：对手下一步会赢的格子（各难度概率递增）
  if (sc.blocks.length) {
    const p = difficulty === 'hard' ? 1 : difficulty === 'normal' ? 0.9 : 0.5;
    if (Math.random() < p) return pick(sc.blocks);
  }

  if (difficulty === 'easy') {
    // 粗略防一眼，否则随机（但避开让对手立刻获胜）
    if (Math.random() < 0.5 && sc.blocks.length) return pick(sc.blocks);
    return safeRand(e, g.board, myPlayer);
  }
  if (difficulty === 'normal') {
    // 90% 走最优，10% 从“次优/安全偏离”里偏移（让普通档可被击败且不明显乱走）
    if (Math.random() < 0.1) {
      const others = e.filter(c => c !== sc.bestCell);
      const safe = others.filter(c => { const nb = clone(g.board); nb[c] = opp; return winnerOf(nb) !== opp; });
      return pick(safe.length ? safe : (others.length ? others : sc.bestCell));
    }
    return sc.bestCell;
  }
  // hard：最优，绝不失误
  return sc.bestCell;
}