/**
 * BoardDuel · Connect 4 · arena 范式拷贝（2026-10-03）
 * ------------------------------------------------------------
 * 直接镜像 tictactoe 的 11 项范式：
 *   · 三屏布局 + 两段式大厅
 *   · 双棋钟 + 头像 + AI 难度键 + 退出守卫 + 终局延迟
 *   · 音效（<audio> 主通道 + WebAudio 兜底） + 棋谱回放（moves[] 纯函数）
 *   · 结算页 i18n（再来一局 / 回看棋谱 / 回大厅） + 浏览器语言自动探测
 *
 * 与 tictactoe 的差异：
 *   · 棋盘 6 行 × 7 列（重力下落，点列顶投子）
 *   · m 序列按"列号 0..6"记录，回放时按 col 还原（c4drop 自动算行号）
 *
 * 完整范式清单见 E:/Users/workbuddy/游戏检测/_playbook/08-arena-pattern-template.md
 */
import {
  setupNav, startTimer, stopTimer, createTimer, fmtClock,
  toast, type Mode,
} from '../game-core';
import { wireLobbyChrome } from '../../lobby-chrome';
import {
  emptyBoard, cloneBoard, drop as c4drop, bestMove, checkWinner, ROWS, COLS,
  type Board as CBoard, type Player as CPlayer, type Difficulty as CDifficulty,
} from './engine';
import {
  enterRoom, sendWs, inviteCode, clearInviteParam,
  roomLiveFromState, opponentNameFromState,
  type OnlineState, type OnlineMsg,
} from '../online-core';
import { modeFromUrl, syncModeCardUI } from '../shared';
import { openFriendRoom } from '../friend-room';
import { reportRound, isClassroom, urlRoomCode, ensureStudentCode } from '../../shared/teacher-track';
import { playSfx, sfxOn, setSfx, unlockSfx } from '../../shared/sfx';

/* ======================
 * 棋盘常量
 * ====================== */
const SLOT_W = 420;
const SLOT_H = SLOT_W * ROWS / COLS;
const PAD = 16;
const R = (SLOT_W - 2 * PAD) / (COLS * 2.4);
const CELL = (SLOT_W - 2 * PAD) / COLS;

/* ======================
 * DOM 引用
 * ====================== */
const boardEl = document.getElementById('bd-board') as HTMLDivElement;
const turnEl = document.getElementById('c4-turn') as HTMLElement;
const statusEl = document.getElementById('c4-status') as HTMLElement;
const modeEl = document.getElementById('c4-mode-v') as HTMLElement;
const undoBtn = document.getElementById('c4-undo') as HTMLButtonElement;
const resignBtn = document.getElementById('c4-resign') as HTMLButtonElement;
const levelBtn = document.getElementById('c4-level') as HTMLButtonElement;
const levelCard = document.getElementById('c4-levelcard') as HTMLElement;
const levelClose = document.getElementById('c4-level-close') as HTMLButtonElement;
const replayBtn = document.getElementById('c4-replay') as HTMLButtonElement;
const soundBtn = document.getElementById('c4-sound') as HTMLButtonElement;
const replayBar = document.getElementById('c4-replaybar') as HTMLElement;
const rpFirst = document.getElementById('c4-rp-first') as HTMLButtonElement;
const rpPrev = document.getElementById('c4-rp-prev') as HTMLButtonElement;
const rpPlay = document.getElementById('c4-rp-play') as HTMLButtonElement;
const rpNext = document.getElementById('c4-rp-next') as HTMLButtonElement;
const rpLast = document.getElementById('c4-rp-last') as HTMLButtonElement;
const rpExit = document.getElementById('c4-rp-exit') as HTMLButtonElement;
const rpRange = document.getElementById('c4-rp-range') as HTMLInputElement;
const rpPos = document.getElementById('c4-rp-pos') as HTMLElement;
const matchEl = document.getElementById('c4-match') as HTMLElement;
const endEl = document.getElementById('c4-end') as HTMLElement;
const endVerdict = document.getElementById('c4-end-verdict') as HTMLElement;
const endLine = document.getElementById('c4-end-line') as HTMLElement;
const rematchBtn = document.getElementById('c4-rematch') as HTMLButtonElement;
const reviewBtn = document.getElementById('c4-review') as HTMLButtonElement;
const endLobbyBtn = document.getElementById('c4-end-lobby') as HTMLButtonElement;
const leaveCard = document.getElementById('c4-leavecard') as HTMLElement;
const leaveClose = document.getElementById('c4-leave-close') as HTMLButtonElement;
const leaveStay = document.getElementById('c4-leave-stay') as HTMLButtonElement;
const leaveYes = document.getElementById('c4-leave-yes') as HTMLButtonElement;
const backLobbyBtn = document.getElementById('c4-back-lobby') as HTMLButtonElement;
const clockMeTime = document.getElementById('go-clock-me-time') as HTMLElement;
const clockMeCard = document.getElementById('go-clock-me') as HTMLElement;
const clockOppCard = document.getElementById('go-clock-opp') as HTMLElement;
const clockOppWho = document.getElementById('go-clock-opp-who') as HTMLElement;

setupNav('connect4');

/* ======================
 * 状态
 * ====================== */
type UIState = {
  screen: 'match' | 'end';
  mode: Mode;
  level: CDifficulty;
  board: CBoard;
  player: CPlayer;
  lastMove: number;
  over: boolean;
  /** 每步快照：用于 Undo */
  history: { board: CBoard; player: CPlayer; lastMove: number }[];
  /** 完整落子序列（按 col 0..6 记录，重力计算由 c4drop 负责） */
  moves: number[];
  timer: ReturnType<typeof createTimer>;
  aiThinking: boolean;
  reviewAt: number | null;
  replayPlaying: boolean;
  ws: WebSocket | null;
  roomCode: string | null;
  /** 对手已进房（2026-10-06）：false 时棋盘锁定、计时不走、对手侧显示「等待中」 */
  roomLive: boolean;
  /** 对手昵称，服务端 start/state 广播带来 */
  oppName: string | null;
  myIdx: number | null;
  sawGameOver: boolean;
};

const state: UIState = {
  screen: 'match',
  mode: 'ai',
  level: 'medium',
  board: emptyBoard() as CBoard,
  player: 1,
  lastMove: -1,
  over: false,
  history: [],
  moves: [],
  timer: createTimer(),
  aiThinking: false,
  reviewAt: null,
  replayPlaying: false,
  ws: null,
  roomCode: null,
  roomLive: false,
  oppName: null,
  myIdx: null,
  sawGameOver: false,
};

const MODE_PAGE = '/games/connect4/lobby/';

/* ======================
 * 工具函数
 * ====================== */
function pieceColor(p: CPlayer): string {
  return p === 1 ? 'var(--c4-p1, #FF6A3C)' : 'var(--c4-p2, #2FC4C9)';
}

/** 渲染棋盘（按 reviewAt 决定看最新还是看历史；moves 序列按 col 重放） */
function viewBoard(moves: number[], reviewAt: number | null): { b: CBoard; lastMove: number } {
  const b = emptyBoard() as CBoard;
  const n = reviewAt === null ? moves.length : reviewAt + 1;
  let last = -1;
  for (let k = 0; k < Math.min(n, moves.length); k++) {
    const col = moves[k];
    if (col < 0 || col >= COLS) continue;
    const p = (k % 2 === 0 ? 1 : 2) as CPlayer;
    const idx = c4drop(b, col, p);
    if (idx >= 0) last = idx;
  }
  return { b, lastMove: last };
}

/* ======================
 * 渲染
 * ====================== */
function render(): void {
  const { b, lastMove } = viewBoard(state.moves, state.reviewAt);
  const renderBoard = state.reviewAt !== null ? b : state.board;
  const lastIdx = state.reviewAt !== null ? lastMove : state.lastMove;

  // 列落子提示（顶部）+ 棋盘格子 + 棋子
  let header = '';
  for (let c = 0; c < COLS; c++) {
    const cx = PAD + c * CELL + CELL / 2;
    const hoverable = !state.over && state.board[c] === 0 &&
      state.mode !== 'online' &&
      (state.mode === 'pass' || (state.mode === 'ai' ? state.player === 1 && !state.aiThinking : true));
    if (hoverable) {
      header += `<g class="c4-cell" data-c="${c}" style="cursor:pointer">
        <rect class="hit" x="${PAD + c * CELL}" y="0" width="${CELL}" height="${SLOT_H}" fill="transparent"/>
        <polygon points="${cx - 9},${PAD - 3} ${cx + 9},${PAD - 3} ${cx},${PAD + 12}" fill="${pieceColor(state.player)}" opacity="0.55"/>
      </g>`;
    }
  }

  let board = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cx = PAD + c * CELL + CELL / 2;
      const cy = PAD + r * CELL + CELL / 2;
      board += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="transparent" stroke="var(--c4-hole, rgba(124,58,237,.20))" stroke-width="0.6"/>`;
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      const v = renderBoard[idx];
      if (v === 0) continue;
      const cx = PAD + c * CELL + CELL / 2;
      const cy = PAD + r * CELL + CELL / 2;
      board += `<circle class="c4-piece${lastIdx === idx ? ' is-last' : ''}" cx="${cx}" cy="${cy}" r="${R}" fill="${pieceColor(v as CPlayer)}"/>`;
    }
  }

  boardEl.innerHTML = `<svg viewBox="0 0 ${SLOT_W} ${SLOT_H}" aria-label="Connect 4 board">
    <rect x="0" y="0" width="${SLOT_W}" height="${SLOT_H}" fill="var(--c4-plate, #FFFFFF)" rx="10"/>
    <rect x="${PAD - 6}" y="${PAD - 6}" width="${SLOT_W - 2 * (PAD - 6)}" height="${SLOT_H - 2 * (PAD - 6)}" rx="8" fill="var(--c4-bg, #FFFFFF)" stroke="var(--c4-edge, rgba(124,58,237,.22))"/>
    ${header}${board}
  </svg>`;
  boardEl.querySelectorAll<SVGGElement>('.c4-cell').forEach((g) => {
    g.addEventListener('click', () => onCell(Number(g.dataset.c)));
  });

  renderHud();
  renderClockHud();
}

function renderHud(): void {
  const thinking = !state.over && state.aiThinking && state.mode === 'ai' && state.player === 2;
  let label: string;
  if (state.reviewAt !== null) {
    label = window.t('bg.bg_connect4_replay');
  } else if (state.over) {
    label = window.t('bi.game_over');
  } else if (state.mode === 'pass') {
    label = state.player === 1 ? window.t('bg.bg_connect4_you_red_lc') : window.t('bg.bg_connect4_pass_teal_lc');
  } else if (state.mode === 'online') {
    label = state.player === 1 ? window.t('bg.bg_connect4_you_red_lc') : window.t('bg.bg_connect4_engine_teal_lc');
  } else {
    label = state.player === 1
      ? window.t('bg.bg_connect4_you_red_lc')
      : (thinking ? 'Engine · ' + window.t('status.thinking') : window.t('bg.bg_connect4_engine_teal_lc'));
  }
  turnEl.textContent = label;
  turnEl.className = 'go-turn-you' + (thinking ? ' is-thinking' : '');

  statusEl.textContent = statusLabel();
  const lvName = state.level === 'easy' ? window.t('bg.bg_connect4_lv1') :
                  state.level === 'medium' ? window.t('bg.bg_connect4_lv2') :
                  window.t('bg.bg_connect4_lv3');
  modeEl.textContent = state.mode === 'ai'
    ? window.t('bi.vs_ai_prefix') + ' ' + lvName
    : state.mode === 'pass' ? window.t('bi.pass_play')
    : window.t('bi.online') + (state.roomCode ? ' · ' + state.roomCode : '');
}

function statusLabel(): string {
  if (state.over) {
    const w = checkWinner(state.board).winner;
    if (w === 3) return 'draw';
    return w === 1 ? 'you win' : (state.mode === 'ai' ? 'AI wins' : 'Teal wins');
  }
  if (state.aiThinking) return window.t('status.thinking');
  return state.player === 1 ? window.t('bg.bg_connect4_you_red_lc') + ' turn' : 'Teal turn';
}

function renderClockHud(): void {
  if (state.mode === 'ai') {
    clockMeCard.classList.toggle('is-active', !state.over && state.player === 1 && !state.aiThinking);
    clockOppCard.classList.toggle('is-active', !state.over && (state.player === 2 || state.aiThinking));
  } else if (state.mode === 'pass') {
    clockMeCard.classList.toggle('is-active', false);
    clockOppCard.classList.toggle('is-active', false);
  } else {
    const myTurn = state.roomLive && state.myIdx !== null && state.player === (state.myIdx === 0 ? 1 : 2);
    clockMeCard.classList.toggle('is-active', !state.over && myTurn);
    clockOppCard.classList.toggle('is-active', !state.over && !myTurn && state.roomLive);
  }
  // 对手侧标签统一在此设置（原先靠 data-i18n，但 i18n 的 MutationObserver
  // 会把 JS 设的文案覆盖回去，2026-10-06 已摘掉该节点的 data-i18n）：
  //   联机 → 未开局「等待中…」，开局后显示服务端带来的真实昵称
  //   其余 → 引擎 / 玩家 2 的固定名
  clockOppWho.textContent = state.mode === 'online'
    ? (state.roomLive && state.oppName ? state.oppName : window.t('bg.bg_common_waiting_opponent'))
    : window.t('bg.bg_connect4_engine_teal');
}

/* ======================
 * 落子
 * ====================== */
function placeLocal(col: number, p: CPlayer): number {
  state.moves.push(col);
  const idx = c4drop(state.board, col, p);
  state.lastMove = idx;
  playSfx('place');           // 唯一出口（gomoku/tictactoe 同款范式）
  return idx;
}

function onCell(col: number): void {
  if (state.over || state.board[col] !== 0) return;
  if (state.mode === 'ai' && state.aiThinking) return;
  if (state.mode === 'ai' && state.player !== 1) return;
  if (state.mode === 'online' && !onlineMyTurn()) return;
  if (state.reviewAt !== null) return;

  pushHistory();
  if (state.mode === 'online') {
    state.player = ((state.myIdx ?? 0) + 1) as CPlayer;
  }
  placeLocal(col, state.player);
  afterMove();
  if (state.mode === 'online' && state.ws) {
    sendWs(state as OnlineState, { type: 'place', p: state.player, c: col, by: state.myIdx ?? 0 });
  }
}

function pushHistory(): void {
  state.history.push({ board: cloneBoard(state.board), player: state.player, lastMove: state.lastMove });
}

function afterMove(): void {
  const r = checkWinner(state.board);
  if (r.winner !== 0) {
    state.over = true;
    stopTimer(state.timer);
    render();
    finish(r.winner as CPlayer, r.line);
    return;
  }
  if (state.board.every((v) => v !== 0)) {
    state.over = true;
    stopTimer(state.timer);
    render();
    finishDraw();
    return;
  }
  state.player = state.player === 1 ? 2 : 1;
  render();
  if (state.mode === 'ai' && state.player === 2) {
    aiMove();
  }
}

/* ======================
 * AI 思考节奏（gomoku/tictactoe 同款范式）
 * ====================== */
const AI_THINK_MS: Record<CDifficulty, number> = { easy: 520, medium: 660, hard: 820 };
let aiTimer = 0;

function cancelAiMove(): void {
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = 0; }
  state.aiThinking = false;
}

function aiMove(extraMs = 0): void {
  if (aiTimer) clearTimeout(aiTimer);
  state.aiThinking = true;
  render();
  const base = AI_THINK_MS[state.level] ?? AI_THINK_MS.medium;
  const jitter = Math.round(base * (Math.random() * 0.24 - 0.12));
  aiTimer = window.setTimeout(() => {
    aiTimer = 0;
    state.aiThinking = false;
    if (state.over || state.screen !== 'match' || state.reviewAt !== null || state.player !== 2) {
      render();
      return;
    }
    const col = bestMove(state.board, 2, state.level);
    if (col < 0) { render(); return; }
    pushHistory();
    placeLocal(col, 2);
    afterMove();
  }, Math.max(160, base + jitter + extraMs));
}

/* ======================
 * 终局
 * ====================== */
let endScreenTimer = 0;
function scheduleEndScreen(): void {
  if (endScreenTimer) window.clearTimeout(endScreenTimer);
  endScreenTimer = window.setTimeout(() => {
    endScreenTimer = 0;
    if (state.over && state.screen === 'match' && state.reviewAt === null) showScreen('end');
  }, 1500);
}

function notation(i: number): string {
  const col = String.fromCharCode(65 + (i % COLS));
  const row = (Math.floor(i / COLS) + 1).toString();
  return col + row;
}

function finish(winner: CPlayer, line: number[] | null): void {
  if (state.mode === 'online' && isClassroom() && state.roomCode) {
    const dur = state.timer ? Date.now() - state.timer.startedAt : 0;
    const me = ((state.myIdx ?? 0) + 1) as CPlayer;
    const youWin = winner === me;
    reportRound(state.roomCode, {
      round: 1, solved: youWin, duration_ms: dur,
      outcome: youWin ? 'win' : 'loss',
    });
  }

  const verdict = state.mode === 'ai'
    ? (winner === 1 ? 'You win' : 'Engine wins')
    : state.mode === 'pass'
      ? (winner === 1 ? 'Red wins' : 'Teal wins')
      : (winner === ((state.myIdx ?? 0) + 1) ? 'You win' : 'You lose');
  endVerdict.textContent = verdict;
  endLine.textContent = line && line.length ? line.map(notation).join(' – ') : '—';
  endVerdict.className = 'go-end-verdict ' + (winner === 1 ? 'is-win' : 'is-loss');
  playSfx(winner === 1 ? 'win' : 'lose');
  // 终局快照给「分享结果」卡片：AI 模式下 1 号是玩家，联机看自己那一手
  snapshotResult(winner === (state.mode === 'ai' ? 1 : (state.myIdx ?? 0) + 1));

  toast(verdict + (line && line.length ? ' · ' + line.map(notation).join(' – ') : ''));
  scheduleEndScreen();
}

function finishDraw(): void {
  endVerdict.textContent = window.t('bi.draw');
  endVerdict.className = 'go-end-verdict';
  endLine.textContent = window.t('bi.board_full');
  toast(window.t('bi.draw'));
  snapshotResult(false);   // 和棋不算赢
  scheduleEndScreen();
}

/* ======================
 * 棋谱回放
 * ====================== */
let replayTimer = 0;
const REPLAY_MS = 700;

function resetReplayUI(): void {
  state.replayPlaying = false;
  if (replayTimer) { clearTimeout(replayTimer); replayTimer = 0; }
  state.reviewAt = null;
  replayBar.hidden = true;
  document.body.classList.remove('bd-replay');
}

function enterReplay(): void {
  if (!state.moves.length) { toast('No moves yet'); return; }
  cancelAiMove();
  if (state.screen !== 'match') showScreen('match');
  state.reviewAt = 0;
  replayBar.hidden = false;
  document.body.classList.add('bd-replay');
  syncReplayBar();
  render();
  startReplay();
}

function exitReplay(): void {
  resetReplayUI();
  if (state.over) showScreen('end'); else showScreen('match');
  render();
}

function syncReplayBar(): void {
  const total = state.moves.length;
  const at = state.reviewAt === null ? total - 1 : state.reviewAt;
  rpRange.max = String(Math.max(0, total - 1));
  rpRange.value = String(Math.max(0, at));
  rpPos.textContent = (at + 1) + ' / ' + total;
  rpPlay.classList.toggle('is-playing', state.replayPlaying);
}

function seek(n: number): void {
  if (state.reviewAt === null) return;
  const max = state.moves.length - 1;
  state.reviewAt = Math.max(0, Math.min(max, n));
  syncReplayBar();
  render();
}

function startReplay(): void {
  if (state.reviewAt === null) return;
  const max = state.moves.length - 1;
  if (state.reviewAt >= max) { state.reviewAt = 0; syncReplayBar(); render(); }
  state.replayPlaying = true;
  syncReplayBar();
  const step = (): void => {
    if (!state.replayPlaying) return;
    const nxt = (state.reviewAt ?? 0) + 1;
    if (nxt > max) { stopReplay(); return; }
    seek(nxt);
    playSfx('place');
    replayTimer = window.setTimeout(step, REPLAY_MS);
  };
  replayTimer = window.setTimeout(step, REPLAY_MS);
}

function stopReplay(): void {
  state.replayPlaying = false;
  if (replayTimer) { clearTimeout(replayTimer); replayTimer = 0; }
  syncReplayBar();
}

rpFirst.addEventListener('click', () => { stopReplay(); seek(0); });
rpPrev.addEventListener('click', () => { stopReplay(); seek((state.reviewAt ?? 0) - 1); });
rpNext.addEventListener('click', () => { stopReplay(); seek((state.reviewAt ?? 0) + 1); });
rpLast.addEventListener('click', () => { stopReplay(); seek(state.moves.length - 1); });
rpPlay.addEventListener('click', () => state.replayPlaying ? stopReplay() : startReplay());
rpExit.addEventListener('click', exitReplay);
rpRange.addEventListener('input', () => { stopReplay(); seek(Number(rpRange.value)); });

/* ======================
 * Undo / Resign
 * ====================== */
function undo(): void {
  if (state.over) return;
  cancelAiMove();
  if (state.history.length === 0) return;
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
  state.moves.pop();
  render();
}

let resignArmed = false;
let resignTimer = 0;
function resign(): void {
  if (state.over) return;
  if (!resignArmed) {
    resignArmed = true;
    resignBtn.textContent = window.t('bj.confirm_resign');
    resignBtn.classList.add('is-confirm');
    resignTimer = window.setTimeout(() => {
      resignArmed = false;
      resignBtn.textContent = window.t('bj.resign');
      resignBtn.classList.remove('is-confirm');
    }, 2200);
    return;
  }
  clearTimeout(resignTimer);
  resignArmed = false;
  resignBtn.textContent = window.t('bj.resign');
  resignBtn.classList.remove('is-confirm');
  doResign();
}

function doResign(): void {
  if (state.over) return;
  cancelAiMove();
  state.over = true;
  stopTimer(state.timer);
  endVerdict.textContent = 'You resigned';
  endVerdict.className = 'go-end-verdict is-loss';
  endLine.textContent = '—';
  toast('Resigned');
  scheduleEndScreen();
}

/* ======================
 * 难度键
 * ====================== */
levelBtn.addEventListener('click', () => {
  if (state.mode !== 'ai') return;
  levelCard.hidden = false;
  levelCard.querySelectorAll<HTMLButtonElement>('.go-level-opt').forEach((b) => {
    b.classList.toggle('is-cur', b.dataset.level === state.level);
  });
});
levelClose.addEventListener('click', () => { levelCard.hidden = true; });
levelCard.addEventListener('click', (e) => { if (e.target === levelCard) levelCard.hidden = true; });
levelCard.querySelectorAll<HTMLButtonElement>('.go-level-opt').forEach((b) => {
  b.addEventListener('click', () => {
    const lv = b.dataset.level as CDifficulty;
    levelCard.hidden = true;
    if (state.mode !== 'ai' || lv === state.level) return;
    state.level = lv;
    toast(window.t('bj.engine_set_to', { level: lv.toUpperCase() }));
    newGame();
  });
});

/* ======================
 * 声音键
 * ====================== */
function refreshSoundBtn(): void {
  soundBtn.classList.toggle('is-off', !sfxOn());
  soundBtn.setAttribute('aria-pressed', sfxOn() ? 'true' : 'false');
  soundBtn.setAttribute('aria-label', window.t(sfxOn() ? 'bg.bg_connect4_sound_on' : 'bg.bg_connect4_sound_off'));
  soundBtn.setAttribute('title', window.t(sfxOn() ? 'bg.bg_connect4_sound_on' : 'bg.bg_connect4_sound_off'));
}
soundBtn.addEventListener('click', () => {
  setSfx(!sfxOn());
  refreshSoundBtn();
  if (sfxOn()) playSfx('place');
});

/* ======================
 * 退出守卫
 * ====================== */
let backGuard = false;
let backLeaving = false;
let pendingLobbyNav = false;
function armBackGuard(): void {
  if (backGuard) return;
  history.pushState({ c4Guard: 1 }, '', location.href);
  backGuard = true;
}
function disarmBackGuard(): void {
  if (!backGuard) return;
  backGuard = false;
  pendingLobbyNav = false;
}
window.addEventListener('popstate', () => {
  if (backLeaving) { backLeaving = false; return; }
  if (!backGuard) return;
  history.pushState({ c4Guard: 1 }, '', location.href);
  if (state.screen === 'match' && !state.over) {
    leaveCard.hidden = false;
  } else {
    disarmBackGuard();
    if (state.screen === 'match') location.replace(MODE_PAGE);
  }
});

function exitMatchToLobby(): void {
  leaveCard.hidden = true;
  cancelAiMove();
  resetReplayUI();
  leaveRoom();
  if (backGuard) {
    backLeaving = true;
    backGuard = false;
    pendingLobbyNav = true;
    try { history.back(); } catch (e) { location.replace(MODE_PAGE); }
    setTimeout(() => {
      if (pendingLobbyNav) { pendingLobbyNav = false; backLeaving = false; location.replace(MODE_PAGE); }
    }, 600);
  } else {
    location.replace(MODE_PAGE);
  }
}
leaveClose.addEventListener('click', () => { leaveCard.hidden = true; });
leaveStay.addEventListener('click', () => { leaveCard.hidden = true; });
leaveYes.addEventListener('click', exitMatchToLobby);
backLobbyBtn.addEventListener('click', exitMatchToLobby);

/* ======================
 * 结算页三键
 * ====================== */
rematchBtn.addEventListener('click', () => {
  if (state.mode === 'online') {
    if (state.ws) sendWs(state as OnlineState, { type: 'restart' });
    state.over = false; newGame(); return;
  }
  newGame();
});
reviewBtn.addEventListener('click', enterReplay);
endLobbyBtn.addEventListener('click', exitMatchToLobby);

/* 2026-10-06：分享结果 → Canvas 大图卡片（MathDuel 范式，可保存 PNG / 系统分享） */
let lastResult: { youWin: boolean; moves: number; durationSec: number } | null = null;
/** 终局时快照，避免之后回放/悔棋改写数据 */
function snapshotResult(youWin: boolean): void {
  lastResult = {
    youWin,
    moves: state.moves.length,
    durationSec: state.timer ? Math.max(1, Math.round((Date.now() - state.timer.startedAt) / 1000)) : 0,
  };
}
document.getElementById('c4-share')?.addEventListener('click', async () => {
  if (!lastResult) { toast('Finish a game first'); return; }
  const m = await import('../share-card');
  m.shareResult('Connect 4 · 7×6', {
    youWin: lastResult.youWin,
    moves: lastResult.moves,
    durationSec: lastResult.durationSec,
    link: state.roomCode ? location.origin + '/b/connect4/' + state.roomCode : location.origin + '/games/connect4/',
    qrGame: state.roomCode ? 'connect4' : undefined,
    tone: lastResult.youWin ? 'wood' : 'indigo',
  });
});

/* ======================
 * 模式与深链
 * ====================== */
const _initialMode: Mode = inviteCode() ? 'online' : modeFromUrl('ai');
state.mode = _initialMode;
syncModeCardUI(state.mode);

/* ======================
 * 屏幕切换
 * ====================== */
function showScreen(s: 'match' | 'end'): void {
  state.screen = s;
  matchEl.hidden = s !== 'match';
  endEl.hidden = s !== 'end';
  if (s === 'match') document.body.classList.add('bd-in-match');
  else document.body.classList.remove('bd-in-match');
  render();
}

/* ======================
 * 新局
 * ====================== */
function newGame(): void {
  cancelAiMove();
  resetReplayUI();
  state.board = emptyBoard() as CBoard;
  state.player = 1;
  state.lastMove = -1;
  state.over = false;
  state.history = [];
  state.moves = [];
  state.aiThinking = false;
  state.sawGameOver = false;
  // 联机：对手没进房时不启钟（2026-10-06）。由 applyRoomState 在 start 到达时再启动。
  if (state.mode !== 'online' || state.roomLive) {
    startTimer(state.timer, (ms) => { clockMeTime.textContent = fmtClock(ms); });
  }
  levelBtn.hidden = state.mode !== 'ai';
  showScreen('match');
  render();
  armBackGuard();
}

/* ======================
 * 联机
 * ====================== */
function onlineMyTurn(): boolean {
  if (!state.roomLive) return false;   // 对手没进房：棋盘锁定
  if (state.myIdx === null) return false;
  return state.moves.length % 2 === state.myIdx;
}

function leaveRoom(): void {
  if (state.ws) {
    try { state.ws.close(); } catch (e) { /* ignore */ }
    state.ws = null;
  }
  state.roomCode = null;
  state.myIdx = null;
}

function handleWs(msg: OnlineMsg): void {
  const t = String(msg.type || '');
  if (t === 'opponent_place') {
    const c = typeof msg.c === 'number' ? msg.c : -1;
    const by = typeof msg.by === 'number' ? msg.by : -1;
    if (c >= 0 && by !== state.myIdx) {
      pushHistory();
      placeLocal(c, (by + 1) as CPlayer);
      afterMove();
    }
  } else if (t === 'start' || t === 'restart_notify') {
    newGame();
  } else if (t === 'opponent_leave') {
    toast('Opponent left');
  } else if (t === 'game_over') {
    state.over = true;
    stopTimer(state.timer);
    render();
  }
}

/* ======================
 * 启动
 * ====================== */
document.querySelectorAll<HTMLButtonElement>('.bd-mode-card').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.classList.contains('is-disabled')) return;
    const m = b.dataset.mode as Mode;
    if (m === 'human') { toast('Online match coming soon'); return; }
    state.mode = m;
    syncModeCardUI(m);
    newGame();
  });
});

undoBtn.addEventListener('click', undo);
resignBtn.addEventListener('click', resign);
replayBtn.addEventListener('click', enterReplay);

const keepAlive = () => { unlockSfx(); };
window.addEventListener('pointerdown', keepAlive, { capture: true, passive: true });
window.addEventListener('touchstart', keepAlive, { capture: true, passive: true });
window.addEventListener('mousedown', keepAlive, { capture: true, passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) unlockSfx(); });
refreshSoundBtn();
wireLobbyChrome();

document.addEventListener('keydown', (e) => {
  if (state.reviewAt !== null) {
    if (e.key === 'ArrowLeft') { stopReplay(); seek((state.reviewAt ?? 0) - 1); e.preventDefault(); return; }
    if (e.key === 'ArrowRight') { stopReplay(); seek((state.reviewAt ?? 0) + 1); e.preventDefault(); return; }
    if (e.key === ' ') { e.preventDefault(); state.replayPlaying ? stopReplay() : startReplay(); return; }
    if (e.key === 'Escape') { exitReplay(); return; }
  }
  if (e.key === 'Escape' && state.screen === 'match') exitMatchToLobby();
});

const ic = inviteCode();
const wantsFriend = (() => {
  try { return (new URLSearchParams(location.search).get('mode') || '').toLowerCase() === 'friend'; }
  catch (e) { return false; }
})();

/* ── 好友房：建房 → 房码 + QR + 邀请链接（2026-10-05 补齐，参考 gomoku）──
   此前大厅「Friend Room」卡是假入口（指向 ?mode=ai），游戏页无建房逻辑。 */
/** 吸收服务端房间状态（state / start），驱动等待态与启钟。 */
function applyRoomState(msg: OnlineMsg, viaStart: boolean): void {
  const live = viaStart || roomLiveFromState(msg);
  const wasLive = state.roomLive;
  state.roomLive = live;
  const name = opponentNameFromState(msg, state.myIdx);
  if (name) state.oppName = name;
  if (live && !wasLive) {
    startTimer(state.timer, (ms) => { clockMeTime.textContent = fmtClock(ms); });
  }
  render();
}

function roomHandlers(code: string) {
  return {
    onConnect: () => { newGame(); toast('Connected · room ' + code); },
    onOpponentPlace: handleWs,
    onStart: (m: OnlineMsg) => { newGame(); applyRoomState(m, true); },
    onState: (m: OnlineMsg) => applyRoomState(m, false),
    onRestart: () => newGame(),
    onOpponentLeave: () => { state.roomLive = false; toast('Opponent left'); render(); },
    onGameOver: handleWs,
  };
}

function startFriendRoom(): void {
  state.mode = 'online';   // 先置 online：空盘等友期间不排 AI 落子（enterRoom 会再置一次）
  newGame();
  void openFriendRoom('connect4', 'c4', {
    enter: (code) => { enterRoom(state as OnlineState, code, roomHandlers(code)); },
    onFail: () => { window.setTimeout(() => { location.replace(MODE_PAGE); }, 1400); },
  });
}

if (ic) {
  clearInviteParam();
  const classroomHook = isClassroom() && urlRoomCode() === ic ? ensureStudentCode(ic) : Promise.resolve(null);
  (classroomHook || Promise.resolve()).then(() => {
    enterRoom(state as OnlineState, ic, roomHandlers(ic));
  });
} else if (wantsFriend) {
  startFriendRoom();
} else {
  newGame();
}

// i18n 字典异步 fetch 兜底：250ms 后强制 rerender 一次（gomoku/tictactoe 同款范式）
setTimeout(() => render(), 250);
