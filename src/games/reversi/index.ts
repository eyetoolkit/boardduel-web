/**
 * BoardDuel · Reversi (8×8) · 完整可玩
 * 玩家执黑（你），AI 执白。点击合法空格落子。
 */
import {
  setupNav,
  startTimer, stopTimer, createTimer, fmtClock,
  toast, type Mode} from '../game-core';
import {
  emptyBoard, cloneBoard, legalMoves, place as revPlace, bestMove,
  type Board as RBoard, type Player as RPlayer, type Difficulty as RDifficulty,
} from './engine';

const SLOT = 540;
const PAD = 16;
const CELL = (SLOT - 2 * PAD) / 8;

const boardEl = document.getElementById('bd-board') as HTMLDivElement;
const turnEl  = document.getElementById('bd-turn-v') as HTMLSpanElement;
const timeEl  = document.getElementById('bd-time-v') as HTMLSpanElement;
const statusEl = document.getElementById('bd-status-v') as HTMLSpanElement;
const modeEl  = document.getElementById('bd-mode-v') as HTMLSpanElement;
const newBtn  = document.getElementById('bd-new') as HTMLButtonElement;
const undoBtn = document.getElementById('bd-undo') as HTMLButtonElement;

setupNav('reversi');

const state = {
  mode: 'ai' as Mode,
  level: 'medium' as RDifficulty,
  board: emptyBoard() as RBoard,
  player: 1 as RPlayer,        // 1=黑(玩家), 2=白(AI)
  lastMove: -1,
  over: false,
  history: [] as { board: RBoard; player: RPlayer; lastMove: number }[],
  timer: createTimer(),
};

function render(): void {
  let lines = '';
  for (let r = 1; r < 8; r++) {
    const y = PAD + r * CELL;
    lines += `<line x1="${PAD}" y1="${y}" x2="${SLOT - PAD}" y2="${y}" stroke="#2A3741" stroke-width="0.6"/>`;
  }
  for (let c = 1; c < 8; c++) {
    const x = PAD + c * CELL;
    lines += `<line x1="${x}" y1="${PAD}" x2="${x}" y2="${SLOT - PAD}" stroke="#2A3741" stroke-width="0.6"/>`;
  }

  // 合法位预览
  let previews = '';
  if (!state.over && state.mode === 'ai' && state.player === 1) {
    const moves = legalMoves(state.board, 1);
    for (const i of moves) {
      const x = i % 8, y = Math.floor(i / 8);
      const cx = PAD + x * CELL + CELL / 2;
      const cy = PAD + y * CELL + CELL / 2;
      previews += `<circle class="rv-stone is-hint" cx="${cx}" cy="${cy}" r="${CELL * 0.42}" fill="none" stroke="#FF6A3C" stroke-width="2"/>`;
    }
  }

  // 棋子
  let pieces = '';
  for (let i = 0; i < 64; i++) {
    const v = state.board[i];
    if (v === 0) continue;
    const x = i % 8, y = Math.floor(i / 8);
    const cx = PAD + x * CELL + CELL / 2;
    const cy = PAD + y * CELL + CELL / 2;
    const isLast = state.lastMove === i;
    const fill = v === 1 ? '#0E1419' : '#F4F6F2';
    pieces += `<circle class="rv-stone${isLast ? ' is-last' : ''}" cx="${cx}" cy="${cy}" r="${CELL * 0.42}" fill="${fill}" stroke="#5C6B74" stroke-width="0.6"/>`;
  }

  // 命中区（仅合法位）
  let hits = '';
  if (!state.over) {
    const moves = legalMoves(state.board, state.player);
    const canClick = state.mode === 'pass' || (state.mode === 'ai' && state.player === 1);
    if (canClick) {
      for (const i of moves) {
        const x = i % 8, y = Math.floor(i / 8);
        hits += `<g class="rv-cell" data-i="${i}" style="cursor:pointer">
          <rect class="hit" x="${PAD + x * CELL}" y="${PAD + y * CELL}" width="${CELL}" height="${CELL}" fill="transparent"/>
        </g>`;
      }
    }
  }

  boardEl.innerHTML = `<svg viewBox="0 0 ${SLOT} ${SLOT}" aria-label="Reversi board">
    <rect x="0" y="0" width="${SLOT}" height="${SLOT}" fill="#1C262E" rx="6"/>
    <rect x="${PAD}" y="${PAD}" width="${SLOT - 2 * PAD}" height="${SLOT - 2 * PAD}" fill="none" stroke="#5C6B74" stroke-width="1.2"/>
    ${lines}${previews}${pieces}${hits}
  </svg>`;
  boardEl.querySelectorAll<SVGGElement>('.rv-cell').forEach((g) => {
    g.addEventListener('click', () => onCell(Number(g.dataset.i)));
  });

  // 子数
  const counts = state.board.reduce(
    (acc, v) => { if (v === 1) acc[0]++; else if (v === 2) acc[1]++; return acc; },
    [0, 0]
  );

  turnEl.textContent = state.over
    ? '— game over —'
    : state.mode === 'pass'
      ? (state.player === 1 ? 'Black (P1)' : 'White (P2)')
      : (state.player === 1 ? 'You (Black)' : 'AI (White)');
  turnEl.className = 'bd-hud-v ' + (state.over ? '' : state.mode === 'ai' && state.player === 2 ? 'bd-turn-ai' : 'bd-turn-you');
  statusEl.textContent = state.over ? `B ${counts[0]} · W ${counts[1]}` : state.mode === 'pass' ? `${state.player === 1 ? 'Black' : 'White'} turn` : (state.player === 1 ? 'your turn' : 'AI thinking');
  modeEl.textContent = state.mode === 'ai' ? 'vs AI · ' + state.level : 'Pass & Play';
}

function onCell(i: number): void {
  if (state.over) return;
  if (state.mode === 'ai' && state.player !== 1) return;
  state.history.push({ board: cloneBoard(state.board), player: state.player, lastMove: state.lastMove });
  revPlace(state.board, i, state.player);
  state.lastMove = i;
  afterMove();
}

function afterMove(): void {
  // 检查对手是否无合法位 → 跳回合
  state.player = state.player === 1 ? 2 : 1;
  if (legalMoves(state.board, state.player).length === 0) {
    // 双方都无子下
    if (legalMoves(state.board, state.player === 1 ? 2 : 1).length === 0) {
      state.over = true;
      stopTimer(state.timer);
      render();
      const counts = state.board.reduce((acc, v) => { if (v === 1) acc[0]++; else if (v === 2) acc[1]++; return acc; }, [0, 0]);
      const w = counts[0] > counts[1] ? 'Black wins' : counts[1] > counts[0] ? 'White wins' : 'Draw';
      toast(w);
      return;
    }
    // 当前轮无子下，让对手继续
    toast(state.player === 1 ? 'Black has no move · skip' : 'White has no move · skip');
    render();
    return;
  }
  render();
  if (state.mode === 'ai' && state.player === 2) {
    setTimeout(() => {
      if (state.over) return;
      const m = bestMove(state.board, 2, state.level);
      if (m < 0) {
        // 跳过
        state.player = 1;
        render();
        return;
      }
      state.history.push({ board: cloneBoard(state.board), player: state.player, lastMove: state.lastMove });
      revPlace(state.board, m, 2);
      state.lastMove = m;
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
    state.level = b.dataset.level as RDifficulty;
    newGame();
  });
});
newBtn.addEventListener('click', newGame);
undoBtn.addEventListener('click', undo);

newGame();