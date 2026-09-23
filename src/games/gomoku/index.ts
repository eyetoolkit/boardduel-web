/**
 * BoardDuel · Gomoku (15×15) · 完整可玩
 * 玩家执黑（你），AI 执白
 * - 黑色 / 白色棋子放置在交叉点上
 * - 5 子连珠即胜
 */
import {
  setupNav,
  startTimer, stopTimer, createTimer, fmtClock,
  toast, type Mode} from '../game-core';
import {
  emptyBoard, cloneBoard, SIZE, SIZE2, bestMove, hasFive,
  type Board as GBoard, type Player as GPlayer, type Difficulty as GDifficulty,
} from './engine';

const SLOT = 600;        // SVG viewBox
const PAD = 24;
const CELL = (SLOT - 2 * PAD) / SIZE;

const boardEl = document.getElementById('bd-board') as HTMLDivElement;
const turnEl  = document.getElementById('bd-turn-v') as HTMLSpanElement;
const timeEl  = document.getElementById('bd-time-v') as HTMLSpanElement;
const statusEl = document.getElementById('bd-status-v') as HTMLSpanElement;
const modeEl  = document.getElementById('bd-mode-v') as HTMLSpanElement;
const newBtn  = document.getElementById('bd-new') as HTMLButtonElement;
const undoBtn = document.getElementById('bd-undo') as HTMLButtonElement;

setupNav('gomoku');

const state = {
  mode: 'ai' as Mode,
  level: 'medium' as GDifficulty,
  board: emptyBoard() as GBoard,
  player: 1 as GPlayer,           // 1=黑(玩家), 2=白(AI)
  lastMove: -1,
  over: false,
  history: [] as { board: GBoard; player: GPlayer; lastMove: number }[],
  timer: createTimer(),
};

function boardToXY(i: number): [number, number] {
  return [i % SIZE, Math.floor(i / SIZE)];
}

function stoneColor(p: GPlayer): string {
  return p === 1 ? '#0E1419' : '#F4F6F2';
}

function render(): void {
  let lines = '';
  for (let r = 0; r < SIZE; r++) {
    const y = PAD + r * CELL;
    lines += `<line x1="${PAD}" y1="${y}" x2="${SLOT - PAD}" y2="${y}" stroke="#5C6B74" stroke-width="${r % 5 === 0 ? 1.2 : 0.5}"/>`;
  }
  for (let c = 0; c < SIZE; c++) {
    const x = PAD + c * CELL;
    lines += `<line x1="${x}" y1="${PAD}" x2="${x}" y2="${SLOT - PAD}" stroke="#5C6B74" stroke-width="${c % 5 === 0 ? 1.2 : 0.5}"/>`;
  }

  // 星位（4 个角 + 天元 H8）
  const stars = [[3,3],[3,11],[11,3],[11,11],[7,7]];
  let starMarks = '';
  for (const [x, y] of stars) {
    const px = PAD + x * CELL, py = PAD + y * CELL;
    starMarks += `<circle cx="${px}" cy="${py}" r="2.2" fill="#5C6B74"/>`;
  }

  // 棋子 + 命中区
  let stones = '';
  for (let i = 0; i < SIZE2; i++) {
    const [gx, gy] = boardToXY(i);
    const px = PAD + gx * CELL;
    const py = PAD + gy * CELL;
    const p = state.board[i];
    if (p !== 0) {
      const r = CELL * 0.42;
      stones += `<circle class="go-stone${state.lastMove === i ? ' is-last' : ''}" cx="${px}" cy="${py}" r="${r}" fill="${stoneColor(p as GPlayer)}" stroke="#5C6B74" stroke-width="0.6"/>`;
    }
    // 命中区
    const hoverable = !state.over && state.board[i] === 0 && (state.mode === 'pass' || state.player === 1);
    if (hoverable) {
      stones += `<g class="go-cell" data-i="${i}" style="cursor:pointer">
        <rect class="hit" x="${px - CELL / 2}" y="${py - CELL / 2}" width="${CELL}" height="${CELL}" fill="transparent"/>
      </g>`;
    }
  }

  boardEl.innerHTML = `<svg viewBox="0 0 ${SLOT} ${SLOT}" aria-label="Gomoku board">
    <rect x="0" y="0" width="${SLOT}" height="${SLOT}" fill="#151D24" rx="6"/>
    ${lines}${starMarks}${stones}
  </svg>`;
  boardEl.querySelectorAll<SVGGElement>('.go-cell').forEach((g) => {
    g.addEventListener('click', () => onCell(Number(g.dataset.i)));
  });

  turnEl.textContent = state.over
    ? '— game over —'
    : state.mode === 'pass'
      ? (state.player === 1 ? 'Black (P1)' : 'White (P2)')
      : (state.player === 1 ? 'You (Black)' : 'AI (White)');
  turnEl.className = 'bd-hud-v ' + (state.over ? '' : state.mode === 'ai' && state.player === 2 ? 'bd-turn-ai' : 'bd-turn-you');
  statusEl.textContent = state.over ? 'game over' : state.mode === 'pass' ? `${state.player === 1 ? 'Black' : 'White'} turn` : (state.player === 1 ? 'your turn' : 'AI thinking');
  modeEl.textContent = state.mode === 'ai' ? 'vs AI · ' + state.level : 'Pass & Play';
}

function onCell(i: number): void {
  if (state.over || state.board[i] !== 0) return;
  if (state.mode === 'ai' && state.player !== 1) return;
  state.history.push({ board: cloneBoard(state.board), player: state.player, lastMove: state.lastMove });
  state.board[i] = state.player;
  state.lastMove = i;
  afterMove();
}

function afterMove(): void {
  const r = hasFive(state.board);
  if (r.winner !== 0) {
    state.over = true;
    stopTimer(state.timer);
    render();
    const winnerLabel = r.winner === 1 ? 'Black wins' : 'White wins';
    toast(winnerLabel);
    return;
  }
  state.player = state.player === 1 ? 2 : 1;
  render();
  if (state.mode === 'ai' && state.player === 2) {
    setTimeout(() => {
      if (state.over) return;
      const m = bestMove(state.board, 2, state.level);
      if (m < 0) return;
      state.history.push({ board: cloneBoard(state.board), player: state.player, lastMove: state.lastMove });
      state.board[m] = 2;
      state.lastMove = m;
      afterMove();
    }, 200);
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
    state.level = b.dataset.level as GDifficulty;
    newGame();
  });
});
newBtn.addEventListener('click', newGame);
undoBtn.addEventListener('click', undo);

newGame();