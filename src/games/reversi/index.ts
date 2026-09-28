/**
 * BoardDuel · Reversi (8×8) · 完整可玩
 * 玩家执黑（你），AI 执白。点击合法空格落子。
 * Online：通过 ?c=<CODE> 进入好友房，走 judgment WS（发 place / 收 opponent_place），
 *          无合法步时发 pass，服务器回 pass_notify 翻转回合（双 pass 即终局）。
 */
import {
  setupNav,
  startTimer, stopTimer, createTimer, fmtClock,
  toast, type Mode} from '../game-core';
import { wireLobbyChrome } from '../../lobby-chrome';
import {
  emptyBoard, cloneBoard, legalMoves, place as revPlace, bestMove,
  type Board as RBoard, type Player as RPlayer, type Difficulty as RDifficulty,
} from './engine';
import {
  enterRoom, sendWs, inviteCode, clearInviteParam,
  type OnlineState, type OnlineMsg,
} from '../online-core';

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
  ws: null as WebSocket | null,
  roomCode: null as string | null,
  myIdx: null as number | null,
};

function render(): void {
  let lines = '';
  for (let r = 1; r < 8; r++) {
    const y = PAD + r * CELL;
    lines += `<line x1="${PAD}" y1="${y}" x2="${SLOT - PAD}" y2="${y}" stroke="var(--rv-grid, #2A3741)" stroke-width="0.6"/>`;
  }
  for (let c = 1; c < 8; c++) {
    const x = PAD + c * CELL;
    lines += `<line x1="${x}" y1="${PAD}" x2="${x}" y2="${SLOT - PAD}" stroke="var(--rv-grid, #2A3741)" stroke-width="0.6"/>`;
  }

  // 合法位预览（仅自己回合）
  let previews = '';
  const myTurnOnline = state.mode === 'online' && state.myIdx !== null && state.player === state.myIdx + 1;
  if (!state.over && (state.mode === 'ai' ? state.player === 1 : myTurnOnline)) {
    const moves = legalMoves(state.board, state.player);
    for (const i of moves) {
      const x = i % 8, y = Math.floor(i / 8);
      const cx = PAD + x * CELL + CELL / 2;
      const cy = PAD + y * CELL + CELL / 2;
      previews += `<circle class="rv-stone is-hint" cx="${cx}" cy="${cy}" r="${CELL * 0.42}" fill="none" stroke="var(--rv-hint, #FF6A3C)" stroke-width="2"/>`;
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
    const fill = v === 1 ? 'var(--rv-black, #0E1419)' : 'var(--rv-white, #F4F6F2)';
    pieces += `<circle class="rv-stone${isLast ? ' is-last' : ''}" cx="${cx}" cy="${cy}" r="${CELL * 0.42}" fill="${fill}" stroke="${v === 1 ? 'var(--rv-black-edge, #5C6B74)' : 'var(--rv-white-edge, #5C6B74)'}" stroke-width="0.6"/>`;
  }

  // 命中区（仅合法位 + 自己回合）
  let hits = '';
  if (!state.over) {
    const canClick = state.mode === 'pass' || (state.mode === 'ai' && state.player === 1) || myTurnOnline;
    if (canClick) {
      const moves = legalMoves(state.board, state.player);
      for (const i of moves) {
        const x = i % 8, y = Math.floor(i / 8);
        hits += `<g class="rv-cell" data-i="${i}" style="cursor:pointer">
          <rect class="hit" x="${PAD + x * CELL}" y="${PAD + y * CELL}" width="${CELL}" height="${CELL}" fill="transparent"/>
        </g>`;
      }
    }
  }

  boardEl.innerHTML = `<svg viewBox="0 0 ${SLOT} ${SLOT}" aria-label="Reversi board">
    <rect x="0" y="0" width="${SLOT}" height="${SLOT}" fill="var(--rv-bg, #1C262E)" rx="6"/>
    <rect x="${PAD}" y="${PAD}" width="${SLOT - 2 * PAD}" height="${SLOT - 2 * PAD}" fill="none" stroke="var(--rv-border, #5C6B74)" stroke-width="1.2"/>
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
    : state.mode === 'online'
      ? (state.player === 1 ? 'Black (P1)' : 'White (P2)')
      : state.mode === 'pass'
        ? (state.player === 1 ? 'Black (P1)' : 'White (P2)')
        : (state.player === 1 ? 'You (Black)' : 'AI (White)');
  turnEl.className = 'bd-hud-v ' + (state.over ? '' : state.mode === 'ai' && state.player === 2 ? 'bd-turn-ai' : 'bd-turn-you');
  statusEl.textContent = state.over ? `B ${counts[0]} · W ${counts[1]}` : state.mode === 'online'
    ? (state.player === state.myIdx! + 1 ? 'your turn' : 'opponent turn')
    : state.mode === 'pass' ? `${state.player === 1 ? 'Black' : 'White'} turn` : (state.player === 1 ? 'your turn' : 'AI thinking');
  modeEl.textContent = state.mode === 'ai' ? 'vs AI · ' + state.level : state.mode === 'pass' ? 'Pass & Play' : 'Online' + (state.roomCode ? ' · ' + state.roomCode : '');
}

function onCell(i: number): void {
  if (state.over) return;
  if (state.mode === 'ai' && state.player !== 1) return;
  if (state.mode === 'online') {
    if (state.myIdx === null || state.player !== state.myIdx + 1) return;
    const r = Math.floor(i / 8), c = i % 8;
    state.history.push({ board: cloneBoard(state.board), player: state.player, lastMove: state.lastMove });
    revPlace(state.board, i, state.player);
    state.lastMove = i;
    afterMove();
    sendWs(state as OnlineState, { type: 'place', p: state.player, r, c });
    return;
  }
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
      if (counts[0] === counts[1]) toast('Draw');
      else if (state.mode === 'ai') toast(counts[0] > counts[1] ? 'Black wins' : 'White wins');
      else { const wSide = counts[0] > counts[1] ? 1 : 2; toast(wSide === state.myIdx! + 1 ? 'You win' : 'Opponent wins'); }
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
/** 自己回合却无合法步 → 自动发 pass（服务器校验后回 pass_notify） */
function maybeAutoPass(): void {
  if (state.mode !== 'online' || state.myIdx === null || state.over) return;
  const me = state.myIdx + 1;
  if (state.player === me && legalMoves(state.board, me).length === 0) {
    sendWs(state as OnlineState, { type: 'pass' });
  }
}

function handleWs(msg: OnlineMsg): void {
  const t = String(msg.type || '');
  if (t === 'opponent_place') {
    const r = typeof msg.r === 'number' ? msg.r : -1;
    const c = typeof msg.c === 'number' ? msg.c : -1;
    const by = typeof msg.by === 'number' ? msg.by : -1;
    if (r >= 0 && c >= 0 && by !== state.myIdx) {
      const i = r * 8 + c;
      state.history.push({ board: cloneBoard(state.board), player: state.player, lastMove: state.lastMove });
      revPlace(state.board, i, (by + 1) as RPlayer);
      state.lastMove = i;
      afterMove();
      maybeAutoPass();
    }
  } else if (t === 'pass_notify') {
    state.player = state.player === 1 ? 2 : 1;
    render();
    maybeAutoPass();
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
    state.level = b.dataset.level as RDifficulty;
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
    onConnect: () => { newGame(); toast('Connected · room ' + ic); maybeAutoPass(); },
    onOpponentPlace: handleWs,
    onPassNotify: handleWs,
    onStart: () => newGame(),
    onRestart: () => newGame(),
    onOpponentLeave: () => toast('Opponent left the room'),
    onGameOver: handleWs,
  });
}
