/**
 * BoardDuel · Tic-Tac-Toe · 完整可玩
 * - 玩家执 X，AI 执 O
 * - 点格子 → 落子 → AI minimax → 切回玩家
 * - 胜负 → toast + 终止交互
 * - New game 重置，Undo 回退一步
 * - Online：通过 ?c=<CODE> 进入好友房，走 relay WS（发 move / 收 opponent_move）
 */
import {
  setupNav,
  startTimer, stopTimer, createTimer, fmtClock,
  toast, readBest, writeBest,
  type Mode, type Difficulty,
} from '../game-core';
import { wireLobbyChrome } from '../../lobby-chrome';
import {
  emptyBoard, cloneBoard, bestMove, checkWinner,
  type Board as TBoard, type Player as TPlayer,
} from './engine';
import {
  enterRoom, sendWs, inviteCode, clearInviteParam,
  type OnlineState, type OnlineMsg,
} from '../online-core';
import { modeFromUrl, syncModeCardUI } from '../shared';

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

// F-002（2026-09-28）：URL ?mode= 初始 mode；online (?c=) 优先级最高
const _initialMode: Mode = inviteCode() ? 'online' : modeFromUrl('ai');
if (_initialMode !== 'online') syncModeCardUI(_initialMode);

const state = {
  mode: _initialMode as Mode,
  level: 'medium' as Difficulty,
  board: emptyBoard() as TBoard,
  player: 1 as TPlayer,
  over: false,
  history: [] as TBoard[],  // for undo
  timer: createTimer(),
  ws: null as WebSocket | null,
  roomCode: null as string | null,
  myIdx: null as number | null,
};

function filledCount(b: TBoard): number {
  return b.reduce<number>((s, v) => s + (v !== 0 ? 1 : 0), 0);
}
/** online 模式：filled 偶数=X(id0) 走，奇数=O(id1) 走 */
function onlineMyTurn(): boolean {
  if (state.myIdx === null) return false;
  return filledCount(state.board) % 2 === state.myIdx;
}

function statusLabel(): string {
  if (state.over) {
    const { winner } = checkWinner(state.board);
    if (winner === 3) return 'draw';
    return winner === 1 ? 'you win' : 'AI wins';
  }
  if (state.mode === 'online') {
    const xTurn = filledCount(state.board) % 2 === 0;
    return (xTurn ? 'X' : 'O') + ' to move' + (onlineMyTurn() ? ' · your turn' : '');
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
      mark = `<path d="M${x + a} ${y + a} L${x + b} ${y + b} M${x + b} ${y + a} L${x + a} ${y + b}" stroke="var(--ttt-x, #F4F6F2)" stroke-width="${stroke}" stroke-linecap="round" fill="none" pointer-events="none"/>`;
    } else if (c === 2) {
      const cx = x + UNIT / 2, cy = y + UNIT / 2, r = UNIT / 2 - inset;
      mark = `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="var(--ttt-o, #FF6A3C)" stroke-width="${stroke}" fill="none" pointer-events="none"/>`;
    }
    const clickable = !state.over && c === 0 && (state.mode !== 'online' || onlineMyTurn());
    grid += `<g class="ttt-cell" data-i="${i}" style="cursor:${clickable ? 'pointer' : 'default'}">
      <rect class="hit" x="${x}" y="${y}" width="${UNIT}" height="${UNIT}" fill="transparent"/>
      ${mark}
    </g>`;
  }
  boardEl.innerHTML = `<svg viewBox="0 0 ${SLOT} ${SLOT}" class="ttt-grid" aria-label="Tic-Tac-Toe board">
    <rect x="0" y="0" width="${SLOT}" height="${SLOT}" fill="var(--ttt-bg, #1C262E)" rx="10"/>
    ${[1,2].map((r) => `<line x1="${PAD}" y1="${PAD + r * UNIT}" x2="${SLOT - PAD}" y2="${PAD + r * UNIT}" stroke="var(--ttt-grid, #5C6B74)" stroke-width="3" stroke-linecap="round"/>`).join('')}
    ${[1,2].map((c) => `<line x1="${PAD + c * UNIT}" y1="${PAD}" x2="${PAD + c * UNIT}" y2="${SLOT - PAD}" stroke="var(--ttt-grid, #5C6B74)" stroke-width="3" stroke-linecap="round"/>`).join('')}
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
  } else if (state.mode === 'online') {
    const xTurn = filledCount(state.board) % 2 === 0;
    turnEl.textContent = xTurn ? 'X' : 'O';
  } else {
    turnEl.textContent = state.mode === 'pass'
      ? (state.player === 1 ? 'X' : 'O')
      : (state.player === 1 ? 'You (X)' : 'AI (O)');
  }
  turnEl.className = 'bd-hud-v ' + (state.over ? '' : state.mode === 'ai' && state.player === 2 ? 'bd-turn-ai' : 'bd-turn-you');
  statusEl.textContent = statusLabel();
  modeEl.textContent = (state.mode === 'ai' ? 'vs AI · ' + state.level : state.mode === 'pass' ? 'Pass & Play' : 'Online' + (state.roomCode ? ' · ' + state.roomCode : '')) as string;
}

function onCell(i: number): void {
  if (state.over || state.board[i] !== 0) return;
  if (state.mode === 'ai' && state.player !== 1) return; // AI 回合不能点
  if (state.mode === 'online') {
    if (!onlineMyTurn()) return;
    state.player = (state.myIdx! + 1) as TPlayer;
    state.history.push(cloneBoard(state.board));
    state.board[i] = state.player;
    afterMove();
    sendWs(state as OnlineState, { type: 'move', i });
    return;
  }
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
    if (winner === 3) {
      toast('Draw · perfect play');
    } else if (state.mode === 'ai') {
      if (winner === 1) {
        toast('You win · saved best');
        const cur = readBest('tictactoe', state.mode, state.level);
        writeBest('tictactoe', state.mode, state.level, cur + 1);
      } else {
        toast('AI wins · try again');
      }
    } else {
      const meWon = winner === state.myIdx! + 1;
      toast(meWon ? 'You win' : 'Opponent wins');
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
  if (state.mode === 'online') { toast('Undo is off in online rooms'); return; }
  if (state.over || state.history.length === 0) return;
  state.board = state.history.pop()!;
  state.player = state.player === 1 ? 2 : 1;
  // 撤销玩家走 + AI 走（一步 = 两回合）
  if (state.mode === 'ai' && state.history.length >= 2) {
    state.board = state.history.pop()!;
  }
  render();
}

// ─── 在线双人房 ───
function handleWs(msg: OnlineMsg): void {
  const t = String(msg.type || '');
  if (t === 'opponent_move') {
    const i = typeof msg.i === 'number' ? msg.i : -1;
    const by = typeof msg.by === 'number' ? msg.by : -1;
    if (i >= 0 && state.board[i] === 0 && by !== state.myIdx) {
      state.player = (by + 1) as TPlayer;
      state.history.push(cloneBoard(state.board));
      state.board[i] = state.player;
      afterMove();
    }
  } else if (t === 'start' || t === 'restart_notify') {
    newGame();
  } else if (t === 'opponent_leave') {
    toast('Opponent left the room');
  } else if (t === 'game_over') {
    state.over = true;
    stopTimer(state.timer);
    render();
  }
}

// 模式切换 → 重置
document.querySelectorAll<HTMLButtonElement>('.bd-mode-card').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.classList.contains('is-disabled')) return;
    if (state.mode === 'online') { toast('Leave the room first to change mode'); return; }
    document.querySelectorAll('.bd-mode-card').forEach((x) => x.classList.remove('is-cur'));
    b.classList.add('is-cur');
    state.mode = b.dataset.mode as Mode;
    newGame();
  });
});
document.querySelectorAll<HTMLButtonElement>('.bd-diff-btn').forEach((b) => {
  b.addEventListener('click', () => {
    if (state.mode === 'online') { toast('Leave the room first to change level'); return; }
    document.querySelectorAll('.bd-diff-btn').forEach((x) => x.classList.remove('is-cur'));
    b.classList.add('is-cur');
    state.level = b.dataset.level as Difficulty;
    newGame();
  });
});
newBtn.addEventListener('click', () => {
  if (state.mode === 'online') { sendWs(state as OnlineState, { type: 'restart' }); return; }
  newGame();
});
undoBtn.addEventListener('click', undo);

newGame();

// 站点 chrome（侧栏抽屉 / 桌面收起 / 主题切换）
wireLobbyChrome();

// 通过 ?c=<CODE> 进入好友房
const ic = inviteCode();
if (ic) {
  clearInviteParam();
  enterRoom(state as OnlineState, ic, {
    onConnect: () => { newGame(); toast('Connected · room ' + ic); },
    onOpponentMove: handleWs,
    onStart: () => newGame(),
    onRestart: () => newGame(),
    onOpponentLeave: () => toast('Opponent left the room'),
    onGameOver: handleWs,
  });
}
