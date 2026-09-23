/**
 * BoardDuel · Tic-Tac-Toe · 完整可玩
 * - 玩家执 X，AI 执 O
 * - 点格子 → 落子 → AI minimax → 切回玩家
 * - 胜负 → toast + 终止交互
 * - New game 重置，Undo 回退一步
 */
import {
  setupNav,
  startTimer, stopTimer, createTimer, fmtClock,
  toast, readBest, writeBest,
  type Mode, type Difficulty,
} from '../game-core';
import {
  emptyBoard, cloneBoard, bestMove, checkWinner,
  type Board as TBoard, type Player as TPlayer,
} from './engine';

const SLOT = 540;       // SVG 棋盘 viewBox 边长（与 chess/gomoku 统一）
const PAD = 24;
const UNIT = (SLOT - 2 * PAD) / 3;

const boardEl = document.getElementById('bd-board') as HTMLDivElement;
const turnEl  = document.getElementById('bd-turn-v') as HTMLSpanElement;
const timeEl  = document.getElementById('bd-time-v') as HTMLSpanElement;
const statusEl = document.getElementById('bd-status-v') as HTMLSpanElement;
const modeEl  = document.getElementById('bd-mode-v') as HTMLSpanElement;
const newBtn  = document.getElementById('bd-new') as HTMLButtonElement;
const undoBtn = document.getElementById('bd-undo') as HTMLButtonElement;

setupNav('tictactoe');

const state = {
  mode: 'ai' as Mode,
  level: 'medium' as Difficulty,
  board: emptyBoard() as TBoard,
  player: 1 as TPlayer,
  over: false,
  history: [] as TBoard[],  // for undo
  timer: createTimer(),
};

function statusLabel(): string {
  if (state.over) {
    const { winner } = checkWinner(state.board);
    if (winner === 3) return 'draw';
    return winner === 1 ? 'you win' : 'AI wins';
  }
  return state.mode === 'pass' ? (state.player === 1 ? 'X turn' : 'O turn')
                               : (state.player === 1 ? 'your turn' : 'AI thinking');
}

function render(): void {
  // SVG 棋盘 —— 直接在棋盘坐标系里画 marks（不用嵌套 SVG，避免尺寸塌陷）
  const stroke = Math.max(6, UNIT * 0.13);
  const inset = UNIT * 0.24;
  let grid = '';
  for (let i = 0; i < 9; i++) {
    const x = PAD + (i % 3) * UNIT;
    const y = PAD + Math.floor(i / 3) * UNIT;
    const c = state.board[i];
    let mark = '';
    if (c === 1) {
      const a = inset, b = UNIT - inset;
      mark = `<path d="M${x + a} ${y + a} L${x + b} ${y + b} M${x + b} ${y + a} L${x + a} ${y + b}" stroke="#F4F6F2" stroke-width="${stroke}" stroke-linecap="round" fill="none" pointer-events="none"/>`;
    } else if (c === 2) {
      const cx = x + UNIT / 2, cy = y + UNIT / 2, r = UNIT / 2 - inset;
      mark = `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="#FF6A3C" stroke-width="${stroke}" fill="none" pointer-events="none"/>`;
    }
    grid += `<g class="ttt-cell" data-i="${i}" style="cursor:${state.over || c !== 0 ? 'default' : 'pointer'}">
      <rect class="hit" x="${x}" y="${y}" width="${UNIT}" height="${UNIT}" fill="transparent"/>
      ${mark}
    </g>`;
  }
  boardEl.innerHTML = `<svg viewBox="0 0 ${SLOT} ${SLOT}" class="ttt-grid" aria-label="Tic-Tac-Toe board">
    <rect x="0" y="0" width="${SLOT}" height="${SLOT}" fill="#1C262E" rx="10"/>
    ${[1,2].map((r) => `<line x1="${PAD}" y1="${PAD + r * UNIT}" x2="${SLOT - PAD}" y2="${PAD + r * UNIT}" stroke="#5C6B74" stroke-width="3" stroke-linecap="round"/>`).join('')}
    ${[1,2].map((c) => `<line x1="${PAD + c * UNIT}" y1="${PAD}" x2="${PAD + c * UNIT}" y2="${SLOT - PAD}" stroke="#5C6B74" stroke-width="3" stroke-linecap="round"/>`).join('')}
    ${grid}
  </svg>`;
  // hook click
  boardEl.querySelectorAll<SVGGElement>('.ttt-cell').forEach((g) => {
    g.addEventListener('click', () => onCell(Number(g.dataset.i)));
  });

  // HUD
  if (state.over) {
    const draw = state.board.every((v) => v !== 0);
    const xc = state.board.reduce((s: number, v) => s + (v === 1 ? 1 : 0), 0);
    const oc = state.board.reduce((s: number, v) => s + (v === 2 ? 1 : 0), 0);
    turnEl.textContent = draw ? '— draw —' : (xc > oc ? 'X wins' : 'O wins');
  } else {
    turnEl.textContent = state.mode === 'pass'
      ? (state.player === 1 ? 'X' : 'O')
      : (state.player === 1 ? 'You (X)' : 'AI (O)');
  }
  turnEl.className = 'bd-hud-v ' + (state.over ? '' : state.mode === 'ai' && state.player === 2 ? 'bd-turn-ai' : 'bd-turn-you');
  statusEl.textContent = statusLabel();
  modeEl.textContent = (state.mode === 'ai' ? 'vs AI · ' + state.level : state.mode === 'pass' ? 'Pass & Play' : 'Online') as string;
}

function onCell(i: number): void {
  if (state.over || state.board[i] !== 0) return;
  if (state.mode === 'ai' && state.player !== 1) return; // AI 回合不能点
  state.history.push(cloneBoard(state.board));
  state.board[i] = state.player;
  afterMove();
}

function afterMove(): void {
  const { winner } = checkWinner(state.board);
  if (winner !== 0) {
    state.over = true;
    stopTimer(state.timer);
    render();
    if (winner === 1 && state.mode === 'ai') {
      toast('You win · saved best');
      const cur = readBest('tictactoe', state.mode, state.level);
      writeBest('tictactoe', state.mode, state.level, cur + 1);
    } else if (winner === 2 && state.mode === 'ai') {
      toast('AI wins · try again');
    } else if (winner === 3) {
      toast('Draw · perfect play');
    }
    return;
  }
  state.player = state.player === 1 ? 2 : 1;
  render();
  if (state.mode === 'ai' && state.player === 2) {
    setTimeout(() => {
      if (state.over) return;
      const m = bestMove(state.board, 2, state.level);
      if (m < 0) return;
      state.history.push(cloneBoard(state.board));
      state.board[m] = 2;
      afterMove();
    }, 250);
  }
}

function newGame(): void {
  state.board = emptyBoard();
  state.player = 1;
  state.over = false;
  state.history = [];
  startTimer(state.timer, (ms) => { timeEl.textContent = fmtClock(ms); });
  render();
}

function undo(): void {
  if (state.over || state.history.length === 0) return;
  state.board = state.history.pop()!;
  state.player = state.player === 1 ? 2 : 1;
  // 撤销玩家走 + AI 走（一步 = 两回合）
  if (state.mode === 'ai' && state.history.length >= 2) {
    state.board = state.history.pop()!;
  }
  render();
}

// 模式切换 → 重置
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
    state.level = b.dataset.level as Difficulty;
    newGame();
  });
});
newBtn.addEventListener('click', newGame);
undoBtn.addEventListener('click', undo);

newGame();