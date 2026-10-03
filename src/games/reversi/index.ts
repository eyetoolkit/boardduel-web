/**
 * BoardDuel · Reversi (Othello, 8×8) · arena 范式拷贝（2026-10-03）
 * ------------------------------------------------------------
 * 镜像 tictactoe/connect4 的 11 项范式。
 *   · 三屏布局 + 两段式大厅
 *   · 双棋钟 + 头像 + AI 难度键 + 退出守卫 + 终局延迟
 *   · 音效（<audio> 主通道 + WebAudio 兜底） + 棋谱回放（moves[] 纯函数）
 *   · 结算页 i18n + 浏览器语言自动探测
 *
 * 与 tictactoe/connect4 的差异：
 *   · 棋盘 8×8，落子要"翻转"对方被夹住的子（Othello 规则）
 *   · 玩家执白（engine player 1）· AI 执黑（engine player 2）；标准 Othello 4 子开局
 *   · 当前回合无合法步自动跳过（maybeAutoPass）· 服务器发 pass_notify
 *   · 终局判定：双方都无合法步或棋盘满
 *
 * 完整范式清单见 E:/Users/workbuddy/游戏检测/_playbook/08-arena-pattern-template.md
 */
import {
  setupNav, startTimer, stopTimer, createTimer, fmtClock,
  toast, type Mode,
} from '../game-core';
import { wireLobbyChrome } from '../../lobby-chrome';
import {
  emptyBoard, cloneBoard, legalMoves, place as revPlace, bestMove, SIZE,
  type Board as RBoard, type Player as RPlayer, type Difficulty as RDifficulty,
} from './engine';
import {
  enterRoom, sendWs, inviteCode, clearInviteParam,
  type OnlineState, type OnlineMsg,
} from '../online-core';
import { modeFromUrl, syncModeCardUI } from '../shared';
import { reportRound, isClassroom, urlRoomCode, ensureStudentCode } from '../../shared/teacher-track';
import { playSfx, sfxOn, setSfx, unlockSfx } from '../../shared/sfx';

/* ======================
 * 棋盘常量
 * ====================== */
const SLOT = 540;
const PAD = 16;
const CELL = (SLOT - 2 * PAD) / 8;

/* ======================
 * DOM 引用
 * ====================== */
const boardEl = document.getElementById('bd-board') as HTMLDivElement;
const turnEl = document.getElementById('rv-turn') as HTMLElement;
const scoreEl = document.getElementById('rv-score') as HTMLElement;
const modeEl = document.getElementById('rv-mode-v') as HTMLElement;
const undoBtn = document.getElementById('rv-undo') as HTMLButtonElement;
const resignBtn = document.getElementById('rv-resign') as HTMLButtonElement;
const levelBtn = document.getElementById('rv-level') as HTMLButtonElement;
const levelCard = document.getElementById('rv-levelcard') as HTMLElement;
const levelClose = document.getElementById('rv-level-close') as HTMLButtonElement;
const replayBtn = document.getElementById('rv-replay') as HTMLButtonElement;
const soundBtn = document.getElementById('rv-sound') as HTMLButtonElement;
const replayBar = document.getElementById('rv-replaybar') as HTMLElement;
const rpFirst = document.getElementById('rv-rp-first') as HTMLButtonElement;
const rpPrev = document.getElementById('rv-rp-prev') as HTMLButtonElement;
const rpPlay = document.getElementById('rv-rp-play') as HTMLButtonElement;
const rpNext = document.getElementById('rv-rp-next') as HTMLButtonElement;
const rpLast = document.getElementById('rv-rp-last') as HTMLButtonElement;
const rpExit = document.getElementById('rv-rp-exit') as HTMLButtonElement;
const rpRange = document.getElementById('rv-rp-range') as HTMLInputElement;
const rpPos = document.getElementById('rv-rp-pos') as HTMLElement;
const matchEl = document.getElementById('rv-match') as HTMLElement;
const endEl = document.getElementById('rv-end') as HTMLElement;
const endVerdict = document.getElementById('rv-end-verdict') as HTMLElement;
const endLine = document.getElementById('rv-end-line') as HTMLElement;
const rematchBtn = document.getElementById('rv-rematch') as HTMLButtonElement;
const reviewBtn = document.getElementById('rv-review') as HTMLButtonElement;
const endLobbyBtn = document.getElementById('rv-end-lobby') as HTMLButtonElement;
const leaveCard = document.getElementById('rv-leavecard') as HTMLElement;
const leaveClose = document.getElementById('rv-leave-close') as HTMLButtonElement;
const leaveStay = document.getElementById('rv-leave-stay') as HTMLButtonElement;
const leaveYes = document.getElementById('rv-leave-yes') as HTMLButtonElement;
const backLobbyBtn = document.getElementById('rv-back-lobby') as HTMLButtonElement;
const clockMeTime = document.getElementById('go-clock-me-time') as HTMLElement;
const clockMeCard = document.getElementById('go-clock-me') as HTMLElement;
const clockOppCard = document.getElementById('go-clock-opp') as HTMLElement;

setupNav('reversi');

/* ======================
 * 状态
 * ====================== */
type UIState = {
  screen: 'match' | 'end';
  mode: Mode;
  level: RDifficulty;
  board: RBoard;
  player: RPlayer;
  lastMove: number;
  over: boolean;
  history: { board: RBoard; player: RPlayer; lastMove: number }[];
  /** 完整走子序列（按 idx 0..63 记录，回放时用 revPlace 重放翻转） */
  moves: number[];
  timer: ReturnType<typeof createTimer>;
  aiThinking: boolean;
  reviewAt: number | null;
  replayPlaying: boolean;
  ws: WebSocket | null;
  roomCode: string | null;
  myIdx: number | null;
  sawGameOver: boolean;
};

const state: UIState = {
  screen: 'match',
  mode: 'ai',
  level: 'medium',
  board: emptyBoard() as RBoard,
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
  myIdx: null,
  sawGameOver: false,
};

const MODE_PAGE = '/games/reversi/lobby/';
const HUMAN = 1;       // 玩家 = 白（engine player 1 = 白）
const ENGINE = 2;      // AI = 黑（engine player 2 = 黑）

/* ======================
 * 工具
 * ====================== */
function counts(b: RBoard): [number, number] {
  let w = 0, k = 0;
  for (const v of b) { if (v === 1) w++; else if (v === 2) k++; }
  return [w, k];
}

/** viewBoard：按 moves 序列 + reviewAt 纯函数重放；用 revPlace 自动翻转 */
function viewBoard(moves: number[], reviewAt: number | null): { b: RBoard; lastMove: number } {
  const b = emptyBoard() as RBoard;
  const n = reviewAt === null ? moves.length : reviewAt + 1;
  let last = -1;
  for (let k = 0; k < Math.min(n, moves.length); k++) {
    const i = moves[k];
    if (i < 0 || i >= SIZE * SIZE) continue;
    const p = (k % 2 === 0 ? 1 : 2) as RPlayer;
    revPlace(b, i, p);
    last = i;
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

  let lines = '';
  for (let r = 1; r < 8; r++) {
    const y = PAD + r * CELL;
    lines += `<line x1="${PAD}" y1="${y}" x2="${SLOT - PAD}" y2="${y}" stroke="var(--rv-grid, rgba(124,58,237,.22))" stroke-width="0.6"/>`;
  }
  for (let c = 1; c < 8; c++) {
    const x = PAD + c * CELL;
    lines += `<line x1="${x}" y1="${PAD}" x2="${x}" y2="${SLOT - PAD}" stroke="var(--rv-grid, rgba(124,58,237,.22))" stroke-width="0.6"/>`;
  }

  // 合法位预览
  let previews = '';
  const myTurnOnline = state.mode === 'online' && state.myIdx !== null && state.player === state.myIdx + 1;
  const showHints = !state.over && (state.mode === 'pass' || (state.mode === 'ai' ? state.player === HUMAN : myTurnOnline));
  if (showHints) {
    const moves = legalMoves(renderBoard, state.player);
    for (const i of moves) {
      const x = i % 8, y = Math.floor(i / 8);
      const cx = PAD + x * CELL + CELL / 2;
      const cy = PAD + y * CELL + CELL / 2;
      previews += `<circle class="rv-stone is-hint" cx="${cx}" cy="${cy}" r="${CELL * 0.42}" fill="none" stroke="var(--rv-hint, #D97706)" stroke-width="2"/>`;
    }
  }

  // 棋子
  let pieces = '';
  for (let i = 0; i < 64; i++) {
    const v = renderBoard[i];
    if (v === 0) continue;
    const x = i % 8, y = Math.floor(i / 8);
    const cx = PAD + x * CELL + CELL / 2;
    const cy = PAD + y * CELL + CELL / 2;
    const isLast = lastIdx === i;
    const fill = v === 1 ? 'var(--rv-white, #FFFFFF)' : 'var(--rv-black, #1E1B39)';
    const stroke = v === 1 ? 'var(--rv-white-edge, rgba(124,58,237,.50))' : 'var(--rv-black-edge, rgba(30,27,57,.40))';
    pieces += `<circle class="rv-stone${isLast ? ' is-last' : ''}" cx="${cx}" cy="${cy}" r="${CELL * 0.42}" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>`;
  }

  // 命中区
  let hits = '';
  if (!state.over && showHints) {
    const moves = legalMoves(renderBoard, state.player);
    for (const i of moves) {
      const x = i % 8, y = Math.floor(i / 8);
      hits += `<g class="rv-cell" data-i="${i}" style="cursor:pointer">
        <rect class="hit" x="${PAD + x * CELL}" y="${PAD + y * CELL}" width="${CELL}" height="${CELL}" fill="transparent"/>
      </g>`;
    }
  }

  boardEl.innerHTML = `<svg viewBox="0 0 ${SLOT} ${SLOT}" aria-label="Reversi board">
    <rect x="0" y="0" width="${SLOT}" height="${SLOT}" fill="var(--rv-bg, #FFFFFF)" rx="14"/>
    <rect x="${PAD}" y="${PAD}" width="${SLOT - 2 * PAD}" height="${SLOT - 2 * PAD}" fill="none" stroke="var(--rv-border, rgba(124,58,237,.45))" stroke-width="1.2"/>
    ${lines}${previews}${pieces}${hits}
  </svg>`;
  boardEl.querySelectorAll<SVGGElement>('.rv-cell').forEach((g) => {
    g.addEventListener('click', () => onCell(Number(g.dataset.i)));
  });

  // 计分
  const [w, k] = counts(renderBoard);
  scoreEl.textContent = `${w} · ${k}`;
  renderHud();
  renderClockHud();
}

function renderHud(): void {
  const thinking = !state.over && state.aiThinking && state.mode === 'ai' && state.player === ENGINE;
  let label: string;
  if (state.reviewAt !== null) {
    label = window.t('bg.bg_reversi_replay');
  } else if (state.over) {
    label = window.t('bi.game_over');
  } else if (state.mode === 'pass') {
    label = state.player === HUMAN ? window.t('bg.bg_reversi_you_white_lc') : window.t('bg.bg_reversi_pass_black_lc');
  } else if (state.mode === 'online') {
    label = state.player === HUMAN ? window.t('bg.bg_reversi_you_white_lc') : window.t('bg.bg_reversi_engine_black_lc');
  } else {
    label = state.player === HUMAN
      ? window.t('bg.bg_reversi_you_white_lc')
      : (thinking ? 'Engine · ' + window.t('status.thinking') : window.t('bg.bg_reversi_engine_black_lc'));
  }
  turnEl.textContent = label;
  turnEl.className = 'go-turn-you' + (thinking ? ' is-thinking' : '');

  const lvName = state.level === 'easy' ? window.t('bg.bg_reversi_lv1') :
                  state.level === 'medium' ? window.t('bg.bg_reversi_lv2') :
                  window.t('bg.bg_reversi_lv3');
  modeEl.textContent = state.mode === 'ai'
    ? window.t('bi.vs_ai_prefix') + ' ' + lvName
    : state.mode === 'pass' ? window.t('bi.pass_play')
    : window.t('bi.online') + (state.roomCode ? ' · ' + state.roomCode : '');
}

function renderClockHud(): void {
  if (state.mode === 'ai') {
    clockMeCard.classList.toggle('is-active', !state.over && state.player === HUMAN && !state.aiThinking);
    clockOppCard.classList.toggle('is-active', !state.over && (state.player === ENGINE || state.aiThinking));
  } else {
    clockMeCard.classList.toggle('is-active', false);
    clockOppCard.classList.toggle('is-active', false);
  }
}

/* ======================
 * 落子
 * ====================== */
function placeLocal(i: number, p: RPlayer): void {
  state.moves.push(i);
  revPlace(state.board, i, p);
  state.lastMove = i;
  playSfx('place');
}

function onCell(i: number): void {
  if (state.over) return;
  if (state.mode === 'ai' && state.aiThinking) return;
  if (state.mode === 'ai' && state.player !== HUMAN) return;
  if (state.mode === 'online' && !onlineMyTurn()) return;
  if (state.reviewAt !== null) return;
  if (legalMoves(state.board, state.player).indexOf(i) < 0) return;

  pushHistory();
  if (state.mode === 'online') {
    state.player = ((state.myIdx ?? 0) + 1) as RPlayer;
  }
  placeLocal(i, state.player);
  afterMove();
  if (state.mode === 'online' && state.ws) {
    const r = Math.floor(i / 8), c = i % 8;
    sendWs(state as OnlineState, { type: 'place', p: state.player, r, c, by: state.myIdx ?? 0 });
  }
}

function pushHistory(): void {
  state.history.push({ board: cloneBoard(state.board), player: state.player, lastMove: state.lastMove });
}

function afterMove(): void {
  // 切换回合
  const other: RPlayer = state.player === 1 ? 2 : 1;
  // 当前方无合法步 → 跳过
  if (legalMoves(state.board, other).length === 0) {
    // 对方也无合法步 → 终局
    if (legalMoves(state.board, state.player).length === 0) {
      state.over = true;
      stopTimer(state.timer);
      render();
      finish();
      return;
    }
    // 仅当前方无子下 → 跳过，current player 继续
    toast(other === HUMAN ? 'You have no move · skip' : 'Engine has no move · skip');
    state.player = other;
    render();
    if (state.mode === 'ai' && state.player === ENGINE) aiMove();
    return;
  }
  state.player = other;
  render();
  if (state.mode === 'ai' && state.player === ENGINE) {
    aiMove();
  }
}

/* ======================
 * AI 思考节奏
 * ====================== */
const AI_THINK_MS: Record<RDifficulty, number> = { easy: 520, medium: 660, hard: 820 };
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
    if (state.over || state.screen !== 'match' || state.reviewAt !== null || state.player !== ENGINE) {
      render();
      return;
    }
    const m = bestMove(state.board, ENGINE, state.level);
    if (m < 0) {
      // 引擎无合法步：跳过（仿 pass_notify）
      state.player = HUMAN;
      render();
      // 若 HUMAN 也无合法步 → 终局
      if (legalMoves(state.board, HUMAN).length === 0) {
        state.over = true;
        stopTimer(state.timer);
        finish();
      }
      return;
    }
    pushHistory();
    placeLocal(m, ENGINE);
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

function finish(): void {
  if (state.mode === 'online' && isClassroom() && state.roomCode) {
    const dur = state.timer ? Date.now() - state.timer.startedAt : 0;
    const [w, k] = counts(state.board);
    const me = ((state.myIdx ?? 0) + 1) as RPlayer;
    const my = me === HUMAN ? w : k;
    const op = me === HUMAN ? k : w;
    const youWin = my > op;
    reportRound(state.roomCode, {
      round: 1, solved: youWin, duration_ms: dur,
      outcome: my === op ? 'draw' : (youWin ? 'win' : 'loss'),
    });
  }

  const [w, k] = counts(state.board);
  let verdict: string;
  if (w === k) verdict = window.t('bi.draw');
  else if (state.mode === 'ai') verdict = w > k ? 'You win' : 'Engine wins';
  else if (state.mode === 'pass') verdict = w > k ? 'White wins' : 'Black wins';
  else {
    const me = ((state.myIdx ?? 0) + 1) as RPlayer;
    const my = me === HUMAN ? w : k;
    const op = me === HUMAN ? k : w;
    verdict = my > op ? 'You win' : 'You lose';
  }
  const line = `${window.t('bg.bg_reversi_score')} ${w} · ${k}`;
  endVerdict.textContent = verdict;
  endLine.textContent = line;
  endVerdict.className = 'go-end-verdict ' + (w >= k ? 'is-win' : 'is-loss');
  playSfx(w >= k ? 'win' : 'lose');
  toast(verdict + ' · ' + line);
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
    const lv = b.dataset.level as RDifficulty;
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
  soundBtn.setAttribute('aria-label', window.t(sfxOn() ? 'bg.bg_reversi_sound_on' : 'bg.bg_reversi_sound_off'));
  soundBtn.setAttribute('title', window.t(sfxOn() ? 'bg.bg_reversi_sound_on' : 'bg.bg_reversi_sound_off'));
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
  history.pushState({ rvGuard: 1 }, '', location.href);
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
  history.pushState({ rvGuard: 1 }, '', location.href);
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
  state.board = emptyBoard() as RBoard;
  state.player = HUMAN;
  state.lastMove = -1;
  state.over = false;
  state.history = [];
  state.moves = [];
  state.aiThinking = false;
  state.sawGameOver = false;
  startTimer(state.timer, (ms) => { clockMeTime.textContent = fmtClock(ms); });
  levelBtn.hidden = state.mode !== 'ai';
  showScreen('match');
  render();
  armBackGuard();
}

/* ======================
 * 联机
 * ====================== */
function onlineMyTurn(): boolean {
  if (state.myIdx === null) return false;
  return state.player === state.myIdx + 1;
}

function leaveRoom(): void {
  if (state.ws) {
    try { state.ws.close(); } catch (e) { /* ignore */ }
    state.ws = null;
  }
  state.roomCode = null;
  state.myIdx = null;
}

function maybeAutoPass(): void {
  if (state.mode !== 'online' || state.myIdx === null || state.over) return;
  const me = (state.myIdx + 1) as RPlayer;
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
      pushHistory();
      placeLocal(i, (by + 1) as RPlayer);
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
if (ic) {
  clearInviteParam();
  const classroomHook = isClassroom() && urlRoomCode() === ic ? ensureStudentCode(ic) : Promise.resolve(null);
  (classroomHook || Promise.resolve()).then(() => {
    enterRoom(state as OnlineState, ic, {
      onConnect: () => { newGame(); toast('Connected · room ' + ic); maybeAutoPass(); },
      onOpponentPlace: handleWs,
      onPassNotify: handleWs,
      onStart: () => newGame(),
      onRestart: () => newGame(),
      onOpponentLeave: () => toast('Opponent left'),
      onGameOver: handleWs,
    });
  });
} else {
  newGame();
}

// i18n 字典异步 fetch 兜底
setTimeout(() => render(), 250);
