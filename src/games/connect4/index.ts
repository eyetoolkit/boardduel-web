/**
 * BoardDuel · Connect 4 · 完整可玩
 * 6×7 棋盘，玩家执红，AI 执黄（teal）。点击列顶下落。
 */
import {
  setupNav,
  startTimer, stopTimer, createTimer, fmtClock,
  toast, type Mode} from '../game-core';
import {
  emptyBoard, cloneBoard, drop as c4drop, bestMove, checkWinner, ROWS, COLS,
  type Board as CBoard, type Player as CPlayer, type Difficulty as CDifficulty,
} from './engine';

const SLOT_W = 420, SLOT_H = SLOT_W * ROWS / COLS;
const PAD = 16;
const R = (SLOT_W - 2 * PAD) / (COLS * 2.4);
const CELL = (SLOT_W - 2 * PAD) / COLS;

const boardEl = document.getElementById('bd-board') as HTMLDivElement;
const turnEl  = document.getElementById('bd-turn-v') as HTMLSpanElement;
const timeEl  = document.getElementById('bd-time-v') as HTMLSpanElement;
const statusEl = document.getElementById('bd-status-v') as HTMLSpanElement;
const modeEl  = document.getElementById('bd-mode-v') as HTMLSpanElement;
const newBtn  = document.getElementById('bd-new') as HTMLButtonElement;
const undoBtn = document.getElementById('bd-undo') as HTMLButtonElement;

setupNav('connect4');

const state = {
  mode: 'ai' as Mode,
  level: 'medium' as CDifficulty,
  board: emptyBoard() as CBoard,
  player: 1 as CPlayer, // 1=玩家, 2=AI
  lastMove: -1,
  over: false,
  history: [] as { board: CBoard; player: CPlayer; lastMove: number }[],
  timer: createTimer(),
};

function pieceColor(p: CPlayer): string {
  // 玩家=ember，AI=teal（设计稿铸/灰对照）
  return p === 1 ? '#FF6A3C' : '#2FC4C9';
}

function render(): void {
  // 列落子提示（顶部）+ 棋盘格子 + 棋子
  let header = '';
  for (let c = 0; c < COLS; c++) {
    const cx = PAD + c * CELL + CELL / 2;
    const hoverable = !state.over && state.board[c] === 0 && (state.mode === 'pass' || state.player === 1);
    if (hoverable) {
      header += `<g class="c4-cell" data-c="${c}" style="cursor:pointer">
        <rect class="hit" x="${PAD + c * CELL}" y="0" width="${CELL}" height="${SLOT_H}" fill="transparent"/>
        <polygon points="${cx - 9},${PAD - 3} ${cx + 9},${PAD - 3} ${cx},${PAD + 12}" fill="${pieceColor(state.player as 1) }" opacity="0.55"/>
      </g>`;
    }
  }

  let board = '';
  // 棋盘格
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cx = PAD + c * CELL + CELL / 2;
      const cy = PAD + r * CELL + CELL / 2;
      board += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="transparent" stroke="#2A3741" stroke-width="0.6"/>`;
    }
  }
  // 棋子
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      const v = state.board[idx];
      if (v === 0) continue;
      const cx = PAD + c * CELL + CELL / 2;
      const cy = PAD + r * CELL + CELL / 2;
      board += `<circle class="c4-piece${state.lastMove === idx ? ' is-last' : ''}" cx="${cx}" cy="${cy}" r="${R}" fill="${pieceColor(v as CPlayer)}"/>`;
    }
  }

  boardEl.innerHTML = `<svg viewBox="0 0 ${SLOT_W} ${SLOT_H}" aria-label="Connect 4 board">
    <rect x="0" y="0" width="${SLOT_W}" height="${SLOT_H}" fill="#151D24" rx="6"/>
    <rect x="${PAD - 6}" y="${PAD - 6}" width="${SLOT_W - 2 * (PAD - 6)}" height="${SLOT_H - 2 * (PAD - 6)}" rx="6" fill="#1C262E" stroke="#2A3741"/>
    ${header}${board}
  </svg>`;
  boardEl.querySelectorAll<SVGGElement>('.c4-cell').forEach((g) => {
    g.addEventListener('click', () => onCell(Number(g.dataset.c)));
  });

  turnEl.textContent = state.over
    ? '— game over —'
    : state.mode === 'pass'
      ? (state.player === 1 ? 'Red (P1)' : 'Teal (P2)')
      : (state.player === 1 ? 'You (Red)' : 'AI (Teal)');
  turnEl.className = 'bd-hud-v ' + (state.over ? '' : state.mode === 'ai' && state.player === 2 ? 'bd-turn-ai' : 'bd-turn-you');
  statusEl.textContent = state.over ? 'game over' : (state.player === 1 ? 'your turn' : 'AI thinking');
  modeEl.textContent = state.mode === 'ai' ? 'vs AI · ' + state.level : 'Pass & Play';
}

function onCell(col: number): void {
  if (state.over || state.board[col] !== 0) return;
  if (state.mode === 'ai' && state.player !== 1) return;
  state.history.push({ board: cloneBoard(state.board), player: state.player, lastMove: state.lastMove });
  const idx = c4drop(state.board, col, state.player);
  if (idx < 0) return;
  state.lastMove = idx;
  afterMove();
}

function afterMove(): void {
  const r = checkWinner(state.board);
  if (r.winner !== 0) {
    state.over = true;
    stopTimer(state.timer);
    render();
    const label = r.winner === 3 ? 'Draw' : (r.winner === 1 ? 'Red wins' : 'Teal wins');
    toast(label);
    return;
  }
  state.player = state.player === 1 ? 2 : 1;
  render();
  if (state.mode === 'ai' && state.player === 2) {
    setTimeout(() => {
      if (state.over) return;
      const col = bestMove(state.board, 2, state.level);
      if (col < 0) return;
      const idx = c4drop(state.board, col, 2);
      if (idx < 0) return;
      state.history.push({ board: cloneBoard(state.board), player: state.player, lastMove: state.lastMove });
      state.lastMove = idx;
      afterMove();
    }, 250);
  }
}

function newGame(): void {
  state.board = emptyBoard();
  state.player = 1;
  state.lastMove = -1;
  state.over = false;
  state.history = [];
  startTimer(state.timer, (ms) => { timeEl.textContent = fmtClock(ms); });
  render();
}

function undo(): void {
  if (state.over || state.history.length === 0) return;
  const last = state.history.pop()!;
  state.board = last.board;
  state.player = last.player;
  state.lastMove = last.lastMove;
  if (state.mode === 'ai' && state.history.length >= 1) {
    const prev = state.history.pop()!;
    state.board = prev.board;
    state.player = prev.player;
    state.lastMove = prev.lastMove;
  }
  render();
}

document.querySelectorAll<HTMLButtonElement>('.bd-mode-card').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.classList.contains('is-disabled')) return;
    document.querySelectorAll('.bd-mode-card').forEach((x) => x.classList.remove('is-cur'));
    b.classList.add('is-cur');
    state.mode = b.dataset.mode as Mode;
    newGame();
  });
});
document.querySelectorAll<HTMLButtonElement>('.bd-diff-btn').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.bd-diff-btn').forEach((x) => x.classList.remove('is-cur'));
    b.classList.add('is-cur');
    state.level = b.dataset.level as CDifficulty;
    newGame();
  });
});
newBtn.addEventListener('click', newGame);
undoBtn.addEventListener('click', undo);

newGame();