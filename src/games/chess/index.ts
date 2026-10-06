/**
 * BoardDuel · Chess (8×8) · arena 范式拷贝（2026-10-03）
 * ------------------------------------------------------------
 * 镜像 tictactoe/connect4/reversi 的 11 项范式。
 *   · 三屏布局 + 两段式大厅
 *   · 双棋钟 + 头像 + AI 难度键 + 退出守卫 + 终局延迟
 *   · 音效（<audio> 主通道 + WebAudio 兜底） + 棋谱回放（moves[] 纯函数）
 *   · 结算页 i18n + 浏览器语言自动探测
 *
 * 与其他棋类的差异：
 *   · 棋盘 8×8，标准国际象棋（王/后/车/象/马/兵 + 易位 + 吃过路兵 + 升变）
 *   · **click-click 操作**：第一次点子选目标 → 第二次点目的方执行
 *   · viewBoard 用 applyMove 顺序重放 gs.history
 *
 * 完整范式清单见 E:/Users/workbuddy/游戏检测/_playbook/08-arena-pattern-template.md
 */
import {
  setupNav, startTimer, stopTimer, createTimer, fmtClock,
  toast, type Mode, type Difficulty,
} from '../game-core';
import { wireLobbyChrome } from '../../lobby-chrome';
import {
  initialState, cloneState, legalMoves, applyMove, bestMove,
  type GameState as CS, type Side as CSide, type Move as CMove, type Piece as CPiece,
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
const SLOT = 540;
const PAD = 16;
const CELL = (SLOT - 2 * PAD) / 8;

/* 棋子 SVG（白=W、黑=B；svg viewBox 0 0 40 40） */
const PIECE_G: Record<string, string> = {
  K: '<path d="M11.5 8.5h4.6v3.6h2.7V8.5h2.4v3.6h2.7V8.5h4.6V17h-17zM14.5 17h11l2 21.5h-15zM10.5 38.5h19v3.5h-19z"/>',
  Q: '<path d="M11.5 17.5 13 8l4.5 6L20 6.5 22.5 14 27 8l1.5 9.5zM13 20.5h14l2.5 18h-19zM10.5 38.5h19v3.5h-19z"/>',
  R: '<path d="M11.5 8.5h4.6v3.6h2.7V8.5h2.4v3.6h2.7V8.5h4.6V17h-17zM14.5 17h11l2 21.5h-15zM10.5 38.5h19v3.5h-19z"/>',
  B: '<path d="M11.5 17.5l3.5-9.5h10l3.5 9.5zM13 20.5h14l2.5 18h-19zM10.5 38.5h19v3.5h-19z"/>',
  N: '<path d="M22 8l-3-3-3 3 3 3v6l-5 5 1 2h17l1-2-5-5V8l3-3-3-3-3 3zM14.5 26h11v12.5h-11zM10.5 38.5h19v3.5h-19z"/>',
  P: '<path d="M19.5 17l-3-3-3 3 3 3v8h-4l-1 8.5h14l-1-8.5h-4v-8zM10.5 38.5h19v3.5h-19z"/>',
};

/* ======================
 * DOM 引用
 * ====================== */
const boardEl = document.getElementById('bd-board') as HTMLDivElement;
const turnEl = document.getElementById('ch-turn') as HTMLElement;
const lastEl = document.getElementById('ch-last') as HTMLElement;
const modeEl = document.getElementById('ch-mode-v') as HTMLElement;
const undoBtn = document.getElementById('ch-undo') as HTMLButtonElement;
const resignBtn = document.getElementById('ch-resign') as HTMLButtonElement;
const levelBtn = document.getElementById('ch-level') as HTMLButtonElement;
const levelCard = document.getElementById('ch-levelcard') as HTMLElement;
const levelClose = document.getElementById('ch-level-close') as HTMLButtonElement;
const replayBtn = document.getElementById('ch-replay') as HTMLButtonElement;
const soundBtn = document.getElementById('ch-sound') as HTMLButtonElement;
const replayBar = document.getElementById('ch-replaybar') as HTMLElement;
const rpFirst = document.getElementById('ch-rp-first') as HTMLButtonElement;
const rpPrev = document.getElementById('ch-rp-prev') as HTMLButtonElement;
const rpPlay = document.getElementById('ch-rp-play') as HTMLButtonElement;
const rpNext = document.getElementById('ch-rp-next') as HTMLButtonElement;
const rpLast = document.getElementById('ch-rp-last') as HTMLButtonElement;
const rpExit = document.getElementById('ch-rp-exit') as HTMLButtonElement;
const rpRange = document.getElementById('ch-rp-range') as HTMLInputElement;
const rpPos = document.getElementById('ch-rp-pos') as HTMLElement;
const matchEl = document.getElementById('ch-match') as HTMLElement;
const endEl = document.getElementById('ch-end') as HTMLElement;
const endVerdict = document.getElementById('ch-end-verdict') as HTMLElement;
const endLine = document.getElementById('ch-end-line') as HTMLElement;
const rematchBtn = document.getElementById('ch-rematch') as HTMLButtonElement;
const reviewBtn = document.getElementById('ch-review') as HTMLButtonElement;
const endLobbyBtn = document.getElementById('ch-end-lobby') as HTMLButtonElement;
const leaveCard = document.getElementById('ch-leavecard') as HTMLElement;
const leaveClose = document.getElementById('ch-leave-close') as HTMLButtonElement;
const leaveStay = document.getElementById('ch-leave-stay') as HTMLButtonElement;
const leaveYes = document.getElementById('ch-leave-yes') as HTMLButtonElement;
const backLobbyBtn = document.getElementById('ch-back-lobby') as HTMLButtonElement;
const clockMeTime = document.getElementById('go-clock-me-time') as HTMLElement;
const clockMeCard = document.getElementById('go-clock-me') as HTMLElement;
const clockOppCard = document.getElementById('go-clock-opp') as HTMLElement;
const clockOppWho = document.getElementById('go-clock-opp-who') as HTMLElement;

setupNav('chess');

/* ======================
 * 状态
 * ====================== */
type UIState = {
  screen: 'match' | 'end';
  mode: Mode;
  level: Difficulty;
  gs: CS;
  selected: number;
  lastMove: CMove | null;
  over: boolean;
  /** 每步快照：用于 Undo */
  history: CS[];
  /** 完整走子序列（每手一个 CMove；回放时按顺序 applyMove） */
  moves: CMove[];
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
  gs: initialState() as CS,
  selected: -1,
  lastMove: null,
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

const MODE_PAGE = '/games/chess/lobby/';

/* ======================
 * 工具
 * ====================== */
function squareXY(sq: number): [number, number] {
  return [sq % 8, 7 - Math.floor(sq / 8)];
}
function sqToAlg(sq: number): string {
  const f = sq % 8;
  const r = Math.floor(sq / 8);
  return String.fromCharCode(97 + f) + (r + 1);
}
function algToSq(alg: string): number {
  const f = alg.charCodeAt(0) - 97;
  const r = parseInt(alg.charAt(1), 10) - 1;
  return r * 8 + f;
}
function myColor(): CSide {
  return state.myIdx === 0 ? 'w' : 'b';
}
function humanSide(): CSide {
  return state.mode === 'ai' ? 'w' : state.gs.turn;
}

function notation(m: CMove): string {
  return sqToAlg(m.from) + (m.castle === 'K' ? 'O-O' : m.castle === 'Q' ? 'O-O-O' : sqToAlg(m.to)) + (m.promo && m.promo !== '.' ? '=' + m.promo.toUpperCase() : '');
}

/** viewBoard：按 reviewAt 重放 gs */
function viewBoard(moves: CMove[], reviewAt: number | null): { gs: CS; lastMove: CMove | null } {
  let g = initialState();
  const n = reviewAt === null ? moves.length : reviewAt + 1;
  let last: CMove | null = null;
  for (let k = 0; k < Math.min(n, moves.length); k++) {
    const m = moves[k];
    applyMove(g, m);
    last = m;
  }
  return { gs: g, lastMove: last };
}

/* ======================
 * 渲染
 * ====================== */
function pieceSvg(p: CPiece, sq: number): string {
  const kind = p.toLowerCase();
  if (kind === '.') return '';
  const [x, y] = squareXY(sq);
  const cx = PAD + x * CELL + CELL / 2;
  const cy = PAD + y * CELL + CELL / 2;
  const isWhite = p === p.toUpperCase();
  const body = isWhite ? 'var(--ch-w-body, #FFFFFF)' : 'var(--ch-b-body, #1E1B39)';
  const edge = isWhite ? 'var(--ch-w-edge, #1E1B39)' : 'var(--ch-b-edge, #7C8B95)';
  const glyph = PIECE_G[kind.toUpperCase()].replace(/stroke="#0A0F14"/g, `stroke="${edge}"`);
  const w = CELL * 0.74;
  const ox = cx - w / 2, oy = cy - w / 2;
  return `<g class="ch-piece" transform="translate(${ox} ${oy}) scale(${w / 40})" fill="${body}" pointer-events="none">`
    + `<g stroke="${edge}" stroke-width="1.1" stroke-linejoin="round" fill="${body}">${glyph}</g>`
    + '</g>';
}

function render(): void {
  const { gs: viewGs, lastMove } = viewBoard(state.moves, state.reviewAt);
  const renderGs = state.reviewAt !== null ? viewGs : state.gs;
  const lm = state.reviewAt !== null ? lastMove : state.lastMove;

  const canInteract = !state.over &&
    (state.mode === 'ai' ? humanSide() === state.gs.turn
      : state.mode === 'online' ? state.roomLive && state.gs.turn === myColor()   // 对手没进房：棋盘锁定
        : humanSide() === state.gs.turn)
    && state.reviewAt === null
    && !state.aiThinking;

  // 棋盘格（浅色）
  let squares = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const fill = (r + c) % 2 === 0 ? 'var(--ch-light, #FFFFFF)' : 'var(--ch-dark, #DDE3F5)';
      squares += `<rect x="${PAD + c * CELL}" y="${PAD + r * CELL}" width="${CELL}" height="${CELL}" fill="${fill}"/>`;
    }
  }

  // 上一步标记
  let lastMark = '';
  if (lm) {
    for (const sq of [lm.from, lm.to]) {
      const [x, y] = squareXY(sq);
      const cx = PAD + x * CELL + CELL / 2;
      const cy = PAD + y * CELL + CELL / 2;
      lastMark += `<circle cx="${cx}" cy="${cy}" r="6" fill="var(--ch-last, rgba(245,158,11,.45))"/>`;
    }
  }

  // 选中 + 可走目标
  let selMarks = '';
  let hitAreas = '';
  if (canInteract && state.selected >= 0) {
    const [sx, sy] = squareXY(state.selected);
    selMarks += `<rect x="${PAD + sx * CELL}" y="${PAD + sy * CELL}" width="${CELL}" height="${CELL}" fill="var(--ch-sel-fill, rgba(245,158,11,.28))"/>`;
    const moves = legalMoves(state.gs).filter((m) => m.from === state.selected);
    for (const m of moves) {
      const [mx, my] = squareXY(m.to);
      const mcx = PAD + mx * CELL + CELL / 2;
      const mcy = PAD + my * CELL + CELL / 2;
      const cap = state.gs.board[m.to] !== '.';
      selMarks += cap
        ? `<circle cx="${mcx}" cy="${mcy}" r="${CELL / 2 - 2}" fill="none" stroke="var(--ch-sel-stroke, #F59E0B)" stroke-width="2"/>`
        : `<circle cx="${mcx}" cy="${mcy}" r="5" fill="var(--ch-sel-stroke, #F59E0B)"/>`;
    }
  }

  if (canInteract) {
    const moves = legalMoves(state.gs);
    if (state.selected < 0) {
      const fromSqs = new Set(moves.map((m) => m.from));
      for (const sq of fromSqs) {
        const [x, y] = squareXY(sq);
        hitAreas += `<g class="ch-cell" data-sq="${sq}" style="cursor:pointer">
          <rect class="hit" x="${PAD + x * CELL}" y="${PAD + y * CELL}" width="${CELL}" height="${CELL}" fill="transparent"/>
        </g>`;
      }
    } else {
      for (const m of moves.filter((m) => m.from === state.selected)) {
        const [mx, my] = squareXY(m.to);
        hitAreas += `<g class="ch-cell" data-to="${m.to}" data-from="${state.selected}" style="cursor:pointer">
          <rect class="hit" x="${PAD + mx * CELL}" y="${PAD + my * CELL}" width="${CELL}" height="${CELL}" fill="transparent"/>
        </g>`;
      }
    }
  }

  // 棋子
  let pieces = '';
  for (let i = 0; i < 64; i++) {
    if (renderGs.board[i] !== '.') pieces += pieceSvg(renderGs.board[i], i);
  }

  boardEl.innerHTML = `<svg viewBox="0 0 ${SLOT} ${SLOT}" aria-label="Chess board">
    <rect x="0" y="0" width="${SLOT}" height="${SLOT}" fill="var(--ch-plate, #F1F2FA)" rx="14"/>
    ${squares}${lastMark}${selMarks}${pieces}${hitAreas}
  </svg>`;
  boardEl.querySelectorAll<SVGGElement>('.ch-cell').forEach((g) => {
    g.addEventListener('click', () => {
      const sq = g.dataset.sq;
      const to = g.dataset.to;
      const from = g.dataset.from;
      if (sq !== undefined) {
        state.selected = Number(sq);
        render();
      } else if (to !== undefined && from !== undefined) {
        const m = legalMoves(state.gs).find((mm) => mm.from === Number(from) && mm.to === Number(to));
        if (m) doMove(m);
      }
    });
  });

  // 最后一手文本
  lastEl.textContent = lm ? notation(lm) : '—';
  renderHud();
  renderClockHud();
}

function renderHud(): void {
  const thinking = !state.over && state.aiThinking && state.mode === 'ai' && state.gs.turn === 'b';
  let label: string;
  if (state.reviewAt !== null) {
    label = window.t('bg.bg_chess_replay');
  } else if (state.over) {
    label = window.t('bi.game_over');
  } else if (state.mode === 'pass') {
    label = state.gs.turn === 'w' ? window.t('bg.bg_chess_you_white_lc') : window.t('bg.bg_chess_pass_black_lc');
  } else if (state.mode === 'online') {
    label = state.gs.turn === myColor() ? window.t('bg.bg_chess_you_white_lc') : window.t('bg.bg_chess_engine_black_lc');
  } else {
    label = state.gs.turn === 'w'
      ? window.t('bg.bg_chess_you_white_lc')
      : (thinking ? 'Engine · ' + window.t('status.thinking') : window.t('bg.bg_chess_engine_black_lc'));
  }
  turnEl.textContent = label;
  turnEl.className = 'go-turn-you' + (thinking ? ' is-thinking' : '');

  const lvName = state.level === 'easy' ? window.t('bg.bg_chess_lv1') :
                  state.level === 'medium' ? window.t('bg.bg_chess_lv2') :
                  window.t('bg.bg_chess_lv3');
  modeEl.textContent = state.mode === 'ai'
    ? window.t('bi.vs_ai_prefix') + ' ' + lvName
    : state.mode === 'pass' ? window.t('bi.pass_play')
    : window.t('bi.online') + (state.roomCode ? ' · ' + state.roomCode : '');
}

function renderClockHud(): void {
  if (state.mode === 'ai') {
    clockMeCard.classList.toggle('is-active', !state.over && state.gs.turn === 'w' && !state.aiThinking);
    clockOppCard.classList.toggle('is-active', !state.over && (state.gs.turn === 'b' || state.aiThinking));
  } else {
    clockMeCard.classList.toggle('is-active', false);
    clockOppCard.classList.toggle('is-active', false);
  }
  // 联机：对手侧不能一直写「引擎」。没进房显示「等待中」，进房后显示真实昵称。
  if (state.mode === 'online') {
    clockOppWho.textContent = state.roomLive && state.oppName
      ? state.oppName
      : window.t('bg.bg_common_waiting_opponent');
  }
}

/* ======================
 * 落子
 * ====================== */
function doMove(m: CMove): void {
  state.history.push(cloneState(state.gs));
  state.moves.push(m);
  applyMove(state.gs, m);
  state.lastMove = m;
  state.selected = -1;
  playSfx('place');
  if (state.mode === 'online' && state.ws) {
    sendWs(state as OnlineState, {
      type: 'move',
      from: sqToAlg(m.from),
      to: sqToAlg(m.to),
      promotion: m.promo ?? undefined,
    });
  }
  afterMove();
}

function afterMove(): void {
  const moves = legalMoves(state.gs);
  if (moves.length === 0) {
    state.over = true;
    stopTimer(state.timer);
    render();
    finish();
    return;
  }
  render();
  if (state.mode === 'ai' && state.gs.turn === 'b' && !state.aiThinking) {
    aiMove();
  }
}

/* ======================
 * AI 思考节奏（与 gomoku 同款范式，但 chess 思考上限更长）
 * ====================== */
const AI_THINK_MS: Record<Difficulty, number> = { easy: 600, medium: 900, hard: 1300 };
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
    if (state.over || state.screen !== 'match' || state.reviewAt !== null || state.gs.turn !== 'b') {
      render();
      return;
    }
    const m = bestMove(state.gs, state.level, 1500);
    if (!m) { render(); return; }
    doMove(m);
  }, Math.max(200, base + jitter + extraMs));
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
    const meWon = state.gs.turn !== myColor();
    reportRound(state.roomCode, {
      round: 1, solved: !!meWon, duration_ms: dur,
      outcome: meWon ? 'win' : 'loss',
    });
  }

  const meWon = state.mode === 'ai' ? state.gs.turn === 'b' : (state.mode === 'online' ? state.gs.turn !== myColor() : false);
  const verdict = meWon ? 'You win' : 'You lose';
  const line = meWon ? 'Checkmate' : 'Checkmate';
  endVerdict.textContent = verdict;
  endLine.textContent = line;
  endVerdict.className = 'go-end-verdict ' + (meWon ? 'is-win' : 'is-loss');
  snapshotResult(meWon);   // 终局快照给「分享结果」卡片
  playSfx(meWon ? 'win' : 'lose');
  toast(verdict + ' · ' + line);
  scheduleEndScreen();
}

/* ======================
 * 棋谱回放
 * ====================== */
let replayTimer = 0;
const REPLAY_MS = 1000;  // chess 一手更长，回放节奏慢一点

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
  state.gs = state.history.pop()!;
  state.moves.pop();
  state.lastMove = state.gs.history[state.gs.history.length - 1] || null;
  state.selected = -1;
  // AI 模式：玩家撤销后还要回退到玩家回合
  if (state.mode === 'ai' && state.history.length >= 1) {
    state.gs = state.history.pop()!;
    state.moves.pop();
    state.lastMove = state.gs.history[state.gs.history.length - 1] || null;
  }
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
  soundBtn.setAttribute('aria-label', window.t(sfxOn() ? 'bg.bg_chess_sound_on' : 'bg.bg_chess_sound_off'));
  soundBtn.setAttribute('title', window.t(sfxOn() ? 'bg.bg_chess_sound_on' : 'bg.bg_chess_sound_off'));
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
  history.pushState({ chGuard: 1 }, '', location.href);
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
  history.pushState({ chGuard: 1 }, '', location.href);
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
document.getElementById('ch-share')?.addEventListener('click', async () => {
  if (!lastResult) { toast('Finish a game first'); return; }
  const m = await import('../share-card');
  m.shareResult('Chess', {
    youWin: lastResult.youWin,
    moves: lastResult.moves,
    durationSec: lastResult.durationSec,
    link: state.roomCode ? location.origin + '/b/chess/' + state.roomCode : location.origin + '/games/chess/',
    qrGame: state.roomCode ? 'chess' : undefined,
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
  state.gs = initialState() as CS;
  state.selected = -1;
  state.lastMove = null;
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
    const from = msg.from, to = msg.to;
    if (typeof from === 'string' && typeof to === 'string') {
      const sqFrom = algToSq(from);
      const sqTo = algToSq(to);
      const m: CMove = {
        from: sqFrom,
        to: sqTo,
        piece: state.gs.board[sqFrom],
        promo: msg.promotion as CPiece | undefined,
      };
      state.history.push(cloneState(state.gs));
      applyMove(state.gs, m);
      state.lastMove = m;
      state.selected = -1;
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

/* ── 好友房：建房 → 房码 + QR + 邀请链接（2026-10-05 补齐，参考 gomoku）── */
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
    onOpponentMove: handleWs,
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
  void openFriendRoom('chess', 'ch', {
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

// i18n 字典异步 fetch 兜底
setTimeout(() => render(), 250);
