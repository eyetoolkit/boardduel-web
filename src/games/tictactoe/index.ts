/**
 * BoardDuel · Tic-Tac-Toe · arena 范式首拷贝（2026-10-03）
 * ------------------------------------------------------------
 * 完全镜像 gomoku 的 11 项范式：
 *   · 三屏布局（match / end / queue） + 两段式大厅
 *   · 双棋钟 + 头像 + AI 难度键 + 退出守卫 + 终局延迟
 *   · 音效（<audio> 主通道 + WebAudio 兜底；直接复用 shared/sfx）
 *   · 棋谱回放（moves[] 纯函数 viewBoard）
 *   · 结算页 i18n（再来一局 / 回看棋谱 / 回大厅）
 *   · AI 思考节奏（按难度 + ±12% 抖动，避免声音叠在一起）
 *
 * 与 gomoku 的差异：
 *   · 棋盘 3×3 = 9 格（gomoku 15×15=225）
 *   · 无 online 排名模式（online 灰态，目前只用 ai + pass）
 *   · 棋钟用普通 elapsed 时间，不引入棋钟消耗概念
 *
 * 完整范式清单见 E:/Users/workbuddy/游戏检测/_playbook/08-arena-pattern-template.md
 */
import {
  setupNav, startTimer, stopTimer, createTimer, fmtClock,
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
  roomLiveFromState, opponentNameFromState,
  type OnlineState, type OnlineMsg,
  isMoveRejected,
} from '../online-core';
import { modeFromUrl, syncModeCardUI } from '../shared';
import { openFriendRoom } from '../friend-room';
import { reportRound, isClassroom, urlRoomCode, ensureStudentCode } from '../../shared/teacher-track';
import { playSfx, sfxOn, setSfx, unlockSfx } from '../../shared/sfx';

/* ======================
 * 棋盘常量
 * ====================== */
const SLOT = 540;                    // 与 gomoku/chess 统一的棋盘 viewBox
const PAD = 24;
const UNIT = (SLOT - 2 * PAD) / 3;   // 3×3 棋盘，每格边长

/* ======================
 * DOM 引用
 * ====================== */
const boardEl = document.getElementById('bd-board') as HTMLDivElement;
const turnEl = document.getElementById('tt-turn') as HTMLElement;
const statusEl = document.getElementById('tt-status') as HTMLElement;
const modeEl = document.getElementById('tt-mode-v') as HTMLElement;
const undoBtn = document.getElementById('tt-undo') as HTMLButtonElement;
const resignBtn = document.getElementById('tt-resign') as HTMLButtonElement;
const levelBtn = document.getElementById('tt-level') as HTMLButtonElement;
const levelCard = document.getElementById('tt-levelcard') as HTMLElement;
const levelClose = document.getElementById('tt-level-close') as HTMLButtonElement;
const replayBtn = document.getElementById('tt-replay') as HTMLButtonElement;
const soundBtn = document.getElementById('tt-sound') as HTMLButtonElement;
const replayBar = document.getElementById('tt-replaybar') as HTMLElement;
const rpFirst = document.getElementById('tt-rp-first') as HTMLButtonElement;
const rpPrev = document.getElementById('tt-rp-prev') as HTMLButtonElement;
const rpPlay = document.getElementById('tt-rp-play') as HTMLButtonElement;
const rpNext = document.getElementById('tt-rp-next') as HTMLButtonElement;
const rpLast = document.getElementById('tt-rp-last') as HTMLButtonElement;
const rpExit = document.getElementById('tt-rp-exit') as HTMLButtonElement;
const rpRange = document.getElementById('tt-rp-range') as HTMLInputElement;
const rpPos = document.getElementById('tt-rp-pos') as HTMLElement;
const matchEl = document.getElementById('tt-match') as HTMLElement;
const endEl = document.getElementById('tt-end') as HTMLElement;
const endVerdict = document.getElementById('tt-end-verdict') as HTMLElement;
const endLine = document.getElementById('tt-end-line') as HTMLElement;
const rematchBtn = document.getElementById('tt-rematch') as HTMLButtonElement;
const reviewBtn = document.getElementById('tt-review') as HTMLButtonElement;
const endLobbyBtn = document.getElementById('tt-end-lobby') as HTMLButtonElement;
const leaveCard = document.getElementById('tt-leavecard') as HTMLElement;
const leaveClose = document.getElementById('tt-leave-close') as HTMLButtonElement;
const leaveStay = document.getElementById('tt-leave-stay') as HTMLButtonElement;
const leaveYes = document.getElementById('tt-leave-yes') as HTMLButtonElement;
const backLobbyBtn = document.getElementById('tt-back-lobby') as HTMLButtonElement;
const chatToggle = document.getElementById('tt-chat-toggle') as HTMLButtonElement;
const chatEl = document.getElementById('tt-chat') as HTMLElement;
const chatForm = document.getElementById('tt-chat-form') as HTMLFormElement;
const chatInput = document.getElementById('tt-chat-input') as HTMLInputElement;
const chatRoom = document.getElementById('tt-chat-room') as HTMLElement;
const clockMeTime = document.getElementById('go-clock-me-time') as HTMLElement;
void chatRoom;
const clockMeCard = document.getElementById('go-clock-me') as HTMLElement;
const clockOppCard = document.getElementById('go-clock-opp') as HTMLElement;
const clockOppWho = document.getElementById('go-clock-opp-who') as HTMLElement;

setupNav('tictactoe');

/* ======================
 * 状态
 * ====================== */
type UIState = {
  screen: 'match' | 'end';           // 主屏三态：match（对局中）/ end（结算）。lobby 走独立 URL
  mode: Mode;
  level: Difficulty;
  board: TBoard;
  /** 当前该谁走：1 = 玩家 X，2 = AI/pass 玩家 O */
  player: TPlayer;
  over: boolean;
  /** 用于 Undo 的快照栈（每手 push 一个） */
  history: TBoard[];
  /** 完整走子序列（用于棋谱回放） */
  moves: number[];
  /** 棋钟：当前总用时（ms） */
  timer: ReturnType<typeof createTimer>;
  /** 引擎正在思考（延迟落子期间）—— 用于轮次行显示"思考中"并挡住玩家点击 */
  aiThinking: boolean;
  /** 复盘回看位置（null = 看最新盘面） */
  reviewAt: number | null;
  /** 回放自动播放 */
  replayPlaying: boolean;
  /** WebSocket 联机 */
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
  board: emptyBoard() as TBoard,
  player: 1,
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

const MODE_PAGE = '/games/tictactoe/lobby/';

/* ======================
 * 工具函数
 * ====================== */
function filledCount(b: TBoard): number {
  return b.reduce<number>((s, v) => s + (v !== 0 ? 1 : 0), 0);
}

function notation(i: number): string {
  // 0..8 → A1..C3（与棋谱回放一致；井字棋小，简化 A/B/C 行 × 1/2/3 列）
  const col = String.fromCharCode(65 + (i % 3)); // A/B/C
  const row = (Math.floor(i / 3) + 1).toString();
  return col + row;
}

/** 渲染棋盘（按 reviewAt 决定看最新还是看历史） */
function viewBoard(moves: number[], reviewAt: number | null): { b: TBoard; lastMove: number } {
  const b = emptyBoard() as TBoard;
  const n = reviewAt === null ? moves.length : reviewAt + 1;
  let last = -1;
  for (let k = 0; k < Math.min(n, moves.length); k++) {
    const i = moves[k];
    if (i < 0 || i > 8) continue;
    b[i] = (k % 2 === 0 ? 1 : 2) as TPlayer;
    last = i;
  }
  return { b, lastMove: last };
}

/* ======================
 * 渲染
 * ====================== */
function render(): void {
  const { b } = viewBoard(state.moves, state.reviewAt);
  // 实际落子棋盘（reviewAt!==null 时用 b，否则与 state.board 一致）
  const renderBoard = state.reviewAt !== null ? b : state.board;

  const stroke = Math.max(6, UNIT * 0.13);
  const inset = UNIT * 0.24;
  let grid = '';
  for (let i = 0; i < 9; i++) {
    const x = PAD + (i % 3) * UNIT;
    const y = PAD + Math.floor(i / 3) * UNIT;
    const c = renderBoard[i];
    let mark = '';
    if (c === 1) {
      const a = inset, bx = UNIT - inset;
      mark = `<path d="M${x + a} ${y + a} L${x + bx} ${y + bx} M${x + bx} ${y + a} L${x + a} ${y + bx}" stroke="var(--ttt-x, #7C3AED)" stroke-width="${stroke}" stroke-linecap="round" fill="none" pointer-events="none"/>`;
    } else if (c === 2) {
      const cx = x + UNIT / 2, cy = y + UNIT / 2, r = UNIT / 2 - inset;
      mark = `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="var(--ttt-o, #F59E0B)" stroke-width="${stroke}" fill="none" pointer-events="none"/>`;
    }
    // 这里的 clickable 只决定光标样式，真正能不能落子在 onCell。与那道闸对齐：
    // 原式 state.mode !== 'ai' 对 online 直接放行（等对手时也是 pointer），
    // 且没排回放态（回放里历史棋盘照常显示 pointer）。
    const canClick = state.reviewAt === null && !state.over && c === 0 && (
      state.mode === 'online' ? onlineMyTurn()
        : state.mode === 'ai' ? (state.player === 1 && !state.aiThinking)
          : true);
    const clickable = canClick;
    grid += `<g class="ttt-cell" data-i="${i}" style="cursor:${clickable ? 'pointer' : 'default'}">
      <rect class="hit" x="${x}" y="${y}" width="${UNIT}" height="${UNIT}" fill="transparent"/>
      ${mark}
    </g>`;
  }
  boardEl.innerHTML = `<svg viewBox="0 0 ${SLOT} ${SLOT}" class="ttt-grid" aria-label="Tic-Tac-Toe board">
    <rect x="0" y="0" width="${SLOT}" height="${SLOT}" fill="var(--ttt-bg, #FFFFFF)" rx="14"/>
    ${[1, 2].map((r) => `<line x1="${PAD}" y1="${PAD + r * UNIT}" x2="${SLOT - PAD}" y2="${PAD + r * UNIT}" stroke="var(--ttt-grid, rgba(124,58,237,.45))" stroke-width="3" stroke-linecap="round"/>`).join('')}
    ${[1, 2].map((c) => `<line x1="${PAD + c * UNIT}" y1="${PAD}" x2="${PAD + c * UNIT}" y2="${SLOT - PAD}" stroke="var(--ttt-grid, rgba(124,58,237,.45))" stroke-width="3" stroke-linecap="round"/>`).join('')}
    ${grid}
  </svg>`;
  boardEl.querySelectorAll<SVGGElement>('.ttt-cell').forEach((g) => {
    g.addEventListener('click', () => onCell(Number(g.dataset.i)));
  });

  // HUD
  renderHud();
  renderClockHud();
}

function renderHud(): void {
  // 思考中 / 终局 / 回放态——轮次行统一走 window.t()，匹配 gomoku 范式
  const thinking = !state.over && state.aiThinking && state.mode === 'ai' && state.player === 2;
  let label: string;
  if (state.reviewAt !== null) {
    label = window.t('bg.bg_tictactoe_replay');
  } else if (state.over) {
    const w = checkWinner(state.board).winner;
    if (w === 3) label = window.t('bi.draw_sep');
    else if (w === 1) label = window.t('bg.bg_tictactoe_you_x_lc') + ' wins';
    else label = window.t('bg.bg_tictactoe_engine_o_lc') + ' wins';
  } else if (state.mode === 'pass') {
    label = state.player === 1 ? window.t('bg.bg_tictactoe_you_x_lc') : window.t('bg.bg_tictactoe_pass_o_lc');
  } else if (state.mode === 'online') {
    label = state.player === 1 ? window.t('bg.bg_tictactoe_you_x_lc') : window.t('bg.bg_tictactoe_engine_o_lc');
  } else {
    // AI 模式
    label = state.player === 1
      ? window.t('bg.bg_tictactoe_you_x_lc')
      : (thinking ? 'Engine · ' + window.t('status.thinking') : window.t('bg.bg_tictactoe_engine_o_lc'));
  }
  turnEl.textContent = label;
  turnEl.className = 'go-turn-you' + (thinking ? ' is-thinking' : '');

  // Status 行（player vs AI / turn / thinking）
  statusEl.textContent = statusLabel();
  // Mode 行
  const lvName = state.level === 'easy' ? window.t('bg.bg_tictactoe_lv1') :
                  state.level === 'medium' ? window.t('bg.bg_tictactoe_lv2') :
                  window.t('bg.bg_tictactoe_lv3');
  modeEl.textContent = state.mode === 'ai'
    ? window.t('bi.vs_ai_prefix') + ' ' + lvName
    : state.mode === 'pass' ? window.t('bi.pass_play')
    : window.t('bi.online') + (state.roomCode ? ' · ' + state.roomCode : '');
}

function statusLabel(): string {
  if (state.over) {
    const w = checkWinner(state.board).winner;
    if (w === 3) return 'draw';
    return w === 1 ? 'you win' : (state.mode === 'ai' ? 'AI wins' : 'O wins');
  }
  if (state.aiThinking) return window.t('status.thinking');
  return state.player === 1 ? window.t('bg.bg_tictactoe_you_x_lc') + ' turn' : 'O turn';
}

function renderClockHud(): void {
  if (state.mode === 'ai') {
    clockMeCard.classList.toggle('is-active', !state.over && state.player === 1 && !state.aiThinking);
    clockOppCard.classList.toggle('is-active', !state.over && (state.player === 2 || state.aiThinking));
  } else if (state.mode === 'pass') {
    clockMeCard.classList.toggle('is-active', false);
    clockOppCard.classList.toggle('is-active', false);
  } else {
    // online
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
    : window.t('bg.bg_tictactoe_engine_o');
}

/* ======================
 * 落子
 * ====================== */
function placeLocal(i: number, p: TPlayer): void {
  state.board[i] = p;
  state.moves.push(i);
  playSfx('place');             // 唯一出口（gomoku 同款范式）
}

function onCell(i: number): void {
  if (state.over || state.board[i] !== 0) return;
  // 思考中：玩家点击不会立刻落子
  if (state.mode === 'ai' && state.aiThinking) return;
  if (state.mode === 'ai' && state.player !== 1) return;
  if (state.mode === 'online' && !onlineMyTurn()) return;
  if (state.reviewAt !== null) return;        // 回放中不允许落子

  pushHistory();
  if (state.mode === 'online') {
    state.player = ((state.myIdx ?? 0) + 1) as TPlayer;
  }
  placeLocal(i, state.player);
  afterMove();
  if (state.mode === 'online' && state.ws) {
    sendWs(state as OnlineState, { type: 'move', i, by: state.myIdx ?? 0 });
  }
}

function pushHistory(): void {
  state.history.push(cloneBoard(state.board));
}

function afterMove(): void {
  const { winner } = checkWinner(state.board);
  if (winner !== 0) {
    state.over = true;
    stopTimer(state.timer);
    render();
    finish(winner as TPlayer);
    return;
  }
  if (state.moves.length >= 9) {
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
 * AI 思考节奏（gomoku 第十轮范式直搬）
 *   · 按难度给时长（easy 520 / medium 660 / hard 820 ms）
 *   · ±12% 随机抖动（避免节拍器感）
 *   · state.aiThinking 控制轮次行显示 "Thinking…" 与禁止点击
 *   · 回调守卫：期间已终局 / 已切回玩家回合 / 已进回放 一律不再落子
 * ====================== */
const AI_THINK_MS: Record<Difficulty, number> = { easy: 520, medium: 660, hard: 820 };
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
    const m = bestMove(state.board, 2, state.level);
    if (m < 0) { render(); return; }
    pushHistory();
    placeLocal(m, 2);
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

function finish(winner: TPlayer): void {
  // M2: classroom 上报
  if (state.mode === 'online' && isClassroom() && state.roomCode) {
    const dur = state.timer ? Date.now() - state.timer.startedAt : 0;
    reportRound(state.roomCode, {
      round: 1,
      solved: winner === ((state.myIdx ?? 0) + 1),
      duration_ms: dur,
      outcome: winner === ((state.myIdx ?? 0) + 1) ? 'win' : 'loss',
    });
  }

  const verdict = state.mode === 'ai'
    ? (winner === 1 ? 'You win' : 'Engine wins')
    : state.mode === 'pass'
      ? (winner === 1 ? 'X wins' : 'O wins')
      : (winner === ((state.myIdx ?? 0) + 1) ? 'You win' : 'You lose');
  const line = checkWinner(state.board).line;
  endVerdict.textContent = verdict;
  endLine.textContent = line && line.length ? line.map(notation).join(' – ') : '—';
  endVerdict.className = 'go-end-verdict ' + (winner === 1 ? 'is-win' : 'is-loss');
  playSfx(winner === 1 ? 'win' : 'lose');
  // 终局快照给「分享结果」卡片：AI 模式下 X(1) 是玩家，联机看自己那一手
  snapshotResult(winner === (state.mode === 'ai' ? 1 : (state.myIdx ?? 0) + 1));

  if (winner === 1 && state.mode === 'ai') {
    const cur = readBest('tictactoe', state.mode, state.level);
    writeBest('tictactoe', state.mode, state.level, cur + 1);
  }
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
  cancelAiMove();          // 引擎待落的要撤掉
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
  state.board = state.history.pop()!;
  state.moves.pop();
  // AI 模式：玩家撤销后还要回退到玩家回合（撤销玩家 + AI 共 2 步）
  if (state.mode === 'ai' && state.history.length >= 1) {
    state.board = state.history.pop()!;
    state.moves.pop();
  }
  state.player = 1;
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
  endVerdict.textContent = state.mode === 'ai' ? 'You resigned' : 'You resigned';
  endVerdict.className = 'go-end-verdict is-loss';
  endLine.textContent = '—';
  toast('Resigned');
  scheduleEndScreen();
}

/* ======================
 * 难度键（仅 AI 模式）
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
    const lv = b.dataset.level as Difficulty;
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
  soundBtn.setAttribute('aria-label', window.t(sfxOn() ? 'bg.bg_tictactoe_sound_on' : 'bg.bg_tictactoe_sound_off'));
  soundBtn.setAttribute('title', window.t(sfxOn() ? 'bg.bg_tictactoe_sound_on' : 'bg.bg_tictactoe_sound_off'));
}
soundBtn.addEventListener('click', () => {
  setSfx(!sfxOn());
  refreshSoundBtn();
  if (sfxOn()) playSfx('place');
});

/* ======================
 * 退出守卫（手机侧滑 / 返回键）
 * ------------------------------------------------------------
 * 进对局 pushState 压占位 → popstate 时把条目补回去 + 弹确认。
 * 统一走 exitMatchToLobby() 出口，避免占位条目不消费。
 * ====================== */
let backGuard = false;
let backLeaving = false;
let pendingLobbyNav = false;
function armBackGuard(): void {
  if (backGuard) return;
  history.pushState({ ttGuard: 1 }, '', location.href);
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
  // 立刻把条目压回去（URL 不变），再弹确认框
  history.pushState({ ttGuard: 1 }, '', location.href);
  if (state.screen === 'match' && !state.over) {
    leaveCard.hidden = false;
  } else {
    // 终局/大厅态不拦，放行
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
document.getElementById('tt-share')?.addEventListener('click', async () => {
  if (!lastResult) { toast('Finish a game first'); return; }
  const m = await import('../share-card');
  m.shareResult('Tic-Tac-Toe · 3×3', {
    youWin: lastResult.youWin,
    moves: lastResult.moves,
    durationSec: lastResult.durationSec,
    link: state.roomCode ? location.origin + '/b/tictactoe/' + state.roomCode : location.origin + '/games/tictactoe/',
    qrGame: state.roomCode ? 'tictactoe' : undefined,
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
  if (s === 'match') {
    document.body.classList.add('bd-in-match');
  } else {
    document.body.classList.remove('bd-in-match');
  }
  render();
}

/* ======================
 * 新局 / 模式切换
 * ====================== */
function newGame(): void {
  cancelAiMove();
  resetReplayUI();
  state.board = emptyBoard() as TBoard;
  state.player = 1;
  state.over = false;
  state.history = [];
  state.moves = [];
  state.aiThinking = false;
  state.sawGameOver = false;
  // 联机：对手没进房时不启钟（2026-10-06）。由 applyRoomState 在 start 到达时再启动。
  if (state.mode !== 'online' || state.roomLive) {
    startTimer(state.timer, (ms) => { clockMeTime.textContent = fmtClock(ms); });
  }
  // 模式键可见性
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
  return filledCount(state.board) % 2 === state.myIdx;
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
  if (t === 'opponent_move') {
    const i = typeof msg.i === 'number' ? msg.i : -1;
    const by = typeof msg.by === 'number' ? msg.by : -1;
    if (i >= 0 && state.board[i] === 0 && by !== state.myIdx) {
      const p = ((by + 1) as TPlayer);
      pushHistory();
      placeLocal(i, p);
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
 * 聊天
 * ====================== */
let chatOpen = false;
function refreshChat(): void {
  if (state.mode !== 'online' || !state.roomCode) {
    chatEl.hidden = true;
    chatToggle.hidden = true;
    return;
  }
  chatToggle.hidden = false;
  chatEl.classList.toggle('is-open', chatOpen);
}
chatToggle.addEventListener('click', () => { chatOpen = !chatOpen; refreshChat(); });
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  sendWs(state as OnlineState, { type: 'chat', text });
  chatInput.value = '';
});

/* ======================
 * 启动
 * ====================== */
// 模式卡：仅 ai / pass 两张可点（井字棋目前无 ranked）
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

// 音效保活（gomoku 同款）
const keepAlive = () => { unlockSfx(); };
window.addEventListener('pointerdown', keepAlive, { capture: true, passive: true });
window.addEventListener('touchstart', keepAlive, { capture: true, passive: true });
window.addEventListener('mousedown', keepAlive, { capture: true, passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) unlockSfx(); });
refreshSoundBtn();
wireLobbyChrome();

// 键盘
document.addEventListener('keydown', (e) => {
  if (state.reviewAt !== null) {
    if (e.key === 'ArrowLeft') { stopReplay(); seek((state.reviewAt ?? 0) - 1); e.preventDefault(); return; }
    if (e.key === 'ArrowRight') { stopReplay(); seek((state.reviewAt ?? 0) + 1); e.preventDefault(); return; }
    if (e.key === ' ') { e.preventDefault(); state.replayPlaying ? stopReplay() : startReplay(); return; }
    if (e.key === 'Escape') { exitReplay(); return; }
  }
  if (e.key === 'Escape' && state.screen === 'match') {
    exitMatchToLobby();
  }
});

// 初始：根据 URL ?mode= 起局；?c=/?room=/?code= 进好友房；?mode=friend 建房
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

/**
 * 服务端拒了刚走的那一步（not_your_turn / illegal_move …）→ 回到走之前。
 * 没有这一步：本地已乐观落子、服务端那边没这一手，棋盘多一个子，
 * 且 filledCount 奇偶被带偏，此后每一步都会被拒 —— 房间直接卡死。
 * onlineMyTurn 由 filledCount 推回合，所以弹掉 board 就自动回到自己回合。
 */
function rollbackRejected(): void {
  const prev = state.history.pop();
  if (prev) state.board = prev;
  state.moves.pop();
  state.over = false;
  state.sawGameOver = false;
  render();
  toast(window.t('bg.bg_common_move_rejected'));
}

function roomHandlers(code: string) {
  return {
    onConnect: () => { newGame(); toast('Connected · room ' + code); },
    onOpponentMove: handleWs,
    onStart: (m: OnlineMsg) => { newGame(); applyRoomState(m, true); },
    onState: (m: OnlineMsg) => applyRoomState(m, false),
    onRestart: () => newGame(),
    onOpponentLeave: () => { state.roomLive = false; toast('Opponent left'); render(); },
    onGameOver: handleWs,
    onError: (m: OnlineMsg) => {
      const c = String((m.code as string) || (m.message as string) || '');
      if (isMoveRejected(m)) rollbackRejected();
      if (c) toast(c);
    },
  };
}

function startFriendRoom(): void {
  state.mode = 'online';   // 先置 online：空盘等友期间不排 AI 落子（enterRoom 会再置一次）
  newGame();                       // showScreen('match') + 空盘
  void openFriendRoom('tictactoe', 'tt', {
    enter: (code) => {
      enterRoom(state as OnlineState, code, roomHandlers(code));
      refreshChat();
    },
    onFail: () => { window.setTimeout(() => { location.replace(MODE_PAGE); }, 1400); },
  });
}

// i18n 字典是异步 fetch 的；renderHud 在 newGame() 里会调 window.t，
// 此时可能字典还没到（返回原始 key）。字典到位后重 render 一次。
window.addEventListener('DOMContentLoaded', () => {
  // 已有 DOMContentLoaded 处理器；这里观察 i18n 是否已生效
});
// 直接在末尾 200ms 后强制 rerender 一次（确保 renderHud 走的是翻译值）
setTimeout(() => { if (typeof render === 'function') render(); }, 250);

if (ic) {
  clearInviteParam();
  const classroomHook = isClassroom() && urlRoomCode() === ic
    ? ensureStudentCode(ic)
    : Promise.resolve(null);
  (classroomHook || Promise.resolve()).then(() => {
    enterRoom(state as OnlineState, ic, roomHandlers(ic));
    refreshChat();
  });
} else if (wantsFriend) {
  startFriendRoom();
} else {
  newGame();
}
