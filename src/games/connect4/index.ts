/**
 * BoardDuel · Connect 4 · 完整可玩
 * 6×7 棋盘，玩家执红，AI 执黄（teal）。点击列顶下落。
 * Online：通过 ?c=<CODE> 进入好友房，走 judgment WS（发 place / 收 opponent_place + 权威 state）
 */
import {
  setupNav,
  startTimer, stopTimer, createTimer, fmtClock,
  toast, type Mode} from '../game-core';
import { wireLobbyChrome } from '../../lobby-chrome';
import {
  emptyBoard, cloneBoard, drop as c4drop, bestMove, checkWinner, ROWS, COLS,
  type Board as CBoard, type Player as CPlayer, type Difficulty as CDifficulty,
} from './engine';
import {
  enterRoom, sendWs, inviteCode, clearInviteParam,
  type OnlineState, type OnlineMsg,
} from '../online-core';
import { modeFromUrl, syncModeCardUI } from '../shared';
// M2（2026-10-01）：教师端房间码归因
import { isClassroom, urlRoomCode, reportRound, ensureStudentCode } from '../../shared/teacher-track';

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

// F-002（2026-09-28）：URL ?mode= 初始 mode；online (?c=) 优先级最高
const _initialMode: Mode = inviteCode() ? 'online' : modeFromUrl('ai');
if (_initialMode !== 'online') syncModeCardUI(_initialMode);

const state = {
  mode: _initialMode as Mode,
  level: 'medium' as CDifficulty,
  board: emptyBoard() as CBoard,
  player: 1 as CPlayer, // 1=玩家, 2=AI
  lastMove: -1,
  over: false,
  history: [] as { board: CBoard; player: CPlayer; lastMove: number }[],
  timer: createTimer(),
  ws: null as WebSocket | null,
  roomCode: null as string | null,
  myIdx: null as number | null,
};

function filledCount(b: CBoard): number {
  return b.reduce<number>((s, v) => s + (v !== 0 ? 1 : 0), 0);
}
function onlineMyTurn(): boolean {
  if (state.myIdx === null) return false;
  return filledCount(state.board) % 2 === state.myIdx;
}

function pieceColor(p: CPlayer): string {
  return p === 1 ? 'var(--c4-p1, #FF6A3C)' : 'var(--c4-p2, #2FC4C9)';
}

function render(): void {
  // 列落子提示（顶部）+ 棋盘格子 + 棋子
  let header = '';
  for (let c = 0; c < COLS; c++) {
    const cx = PAD + c * CELL + CELL / 2;
    const hoverable = !state.over && state.board[c] === 0 &&
      (state.mode === 'pass' || (state.mode === 'online' ? onlineMyTurn() : state.player === 1));
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
      board += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="transparent" stroke="var(--c4-hole, #2A3741)" stroke-width="0.6"/>`;
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
    <rect x="0" y="0" width="${SLOT_W}" height="${SLOT_H}" fill="var(--c4-plate, #151D24)" rx="6"/>
    <rect x="${PAD - 6}" y="${PAD - 6}" width="${SLOT_W - 2 * (PAD - 6)}" height="${SLOT_H - 2 * (PAD - 6)}" rx="6" fill="var(--c4-bg, #1C262E)" stroke="var(--c4-edge, #2A3741)"/>
    ${header}${board}
  </svg>`;
  boardEl.querySelectorAll<SVGGElement>('.c4-cell').forEach((g) => {
    g.addEventListener('click', () => onCell(Number(g.dataset.c)));
  });

  turnEl.textContent = state.over
    ? '— game over —'
    : state.mode === 'online'
      ? (state.player === 1 ? 'Red (P1)' : 'Teal (P2)')
      : state.mode === 'pass'
        ? (state.player === 1 ? 'Red (P1)' : 'Teal (P2)')
        : (state.player === 1 ? 'You (Red)' : 'AI (Teal)');
  turnEl.className = 'bd-hud-v ' + (state.over ? '' : state.mode === 'ai' && state.player === 2 ? 'bd-turn-ai' : 'bd-turn-you');
  statusEl.textContent = state.over
    ? 'game over'
    : state.mode === 'online'
      ? (state.player === state.myIdx! + 1 ? 'your turn' : 'opponent turn')
      : (state.player === 1 ? 'your turn' : 'AI thinking');
  modeEl.textContent = state.mode === 'ai' ? window.t('bi.vs_ai_prefix') + state.level : state.mode === 'pass' ? window.t('bi.pass_play') : window.t('bi.online') + (state.roomCode ? ' · ' + state.roomCode : '');
}

function onCell(col: number): void {
  if (state.over || state.board[col] !== 0) return;
  if (state.mode === 'ai' && state.player !== 1) return;
  if (state.mode === 'online') {
    if (!onlineMyTurn()) return;
    const me = (state.myIdx! + 1) as CPlayer;
    const idx = c4drop(state.board, col, me);
    if (idx < 0) return;
    state.history.push({ board: cloneBoard(state.board), player: state.player, lastMove: state.lastMove });
    state.player = me;
    state.lastMove = idx;
    afterMove();
    sendWs(state as OnlineState, { type: 'place', p: me, c: col });
    return;
  }
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
    if (r.winner === 3) toast('Draw');
    else if (state.mode === 'ai') toast(r.winner === 1 ? 'Red wins' : 'Teal wins');
    else toast(r.winner === state.player ? 'You win' : 'Opponent wins');
    // M2（2026-10-01）：classroom 在线终局上报
    if (state.mode === 'online' && isClassroom() && state.roomCode) {
      const dur = state.timer ? Date.now() - state.timer.startedAt : 0;
      const youWin = r.winner === 3 ? false : (r.winner === state.player);
      reportRound(state.roomCode, {
        round: 1,
        solved: youWin,
        duration_ms: dur,
        outcome: r.winner === 3 ? 'draw' : (youWin ? 'win' : 'loss'),
      });
    }
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
  if (state.mode === 'online') { toast('Undo is off in online rooms'); return; }
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

// ─── 在线双人房 ───
function handleWs(msg: OnlineMsg): void {
  const t = String(msg.type || '');
  if (t === 'opponent_place') {
    const c = typeof msg.c === 'number' ? msg.c : -1;
    const by = typeof msg.by === 'number' ? msg.by : -1;
    if (c >= 0 && by !== state.myIdx) {
      const idx = c4drop(state.board, c, (by + 1) as CPlayer);
      if (idx >= 0) {
        state.history.push({ board: cloneBoard(state.board), player: state.player, lastMove: state.lastMove });
        state.lastMove = idx;
        state.player = (by + 1) as CPlayer;
        afterMove();
      }
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
    state.level = b.dataset.level as CDifficulty;
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
  // M2（2026-10-01）：classroom 邀请链接先弹代号
  const classroomHook = isClassroom() && urlRoomCode() === ic
    ? ensureStudentCode(ic)
    : Promise.resolve(null);
  (classroomHook || Promise.resolve()).then(() => {
    enterRoom(state as OnlineState, ic, {
      onConnect: () => { newGame(); toast('Connected · room ' + ic); },
      onOpponentPlace: handleWs,
      onStart: () => newGame(),
      onRestart: () => newGame(),
      onOpponentLeave: () => toast('Opponent left the room'),
      onGameOver: handleWs,
    });
  });
}
