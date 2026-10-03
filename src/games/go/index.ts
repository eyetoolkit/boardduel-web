/**
 * BoardDuel · Go（围棋）对局页（W3 · arena 范式三屏 + 中日棋钟 + 6 语言 i18n）
 *
 * 本文件把 W1 引擎 + W2 AI/渲染 接入 arena 范式（对齐 gomoku 五子棋 12 轮沉淀）：
 *   1.1 满屏沉浸 arena   1.2 头像 + 双棋钟（中日 byoyomi）   1.3 AI 难度键
 *   1.4 落子音效（复用 shared/sfx，placeLocal 唯一出口）      1.5 棋谱回放（viewBoard 纯函数）
 *   1.6 退出二次确认    1.7 终局延迟展示                    1.8 结算页 endbar
 *   1.10 国际化（window.t + i18n:ready 兜底 rerender）
 *
 * 棋钟为中日「读秒」制：主时间用尽 → 进入读秒（每手扣 1 段，3 段 × 60s），读秒用尽判负。
 * 纯逻辑在 clock.ts（可单测），本文件负责驱动 + 渲染。
 */
import { setupNav, toast } from '../game-core';
import { wireLobbyChrome } from '../../lobby-chrome';
import { playSfx, sfxOn, setSfx, unlockSfx } from '../../shared/sfx';
import {
  initialState, initialStateHandicap, play, pass, notation, opponent,
  scoreWithDead, toggleDeadGroup, resolveDead,
  type GoState, type Player, type DeadSet,
} from './engine';
import { renderGoBoardSVG, diffCaptures } from './render';
import { bestMove, type Difficulty } from './ai';
import { initialClock, tickClock, afterMoveClock, formatClock, type ClockState } from './clock';

setupNav('go');
wireLobbyChrome();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const boardEl = $<HTMLDivElement>('bd-board');
const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

const MODE_PAGE = '/games/go/lobby/';
const AI_THINK_MS: Record<Difficulty, number> = { easy: 480, medium: 760 };
const REPLAY_MS = 900;
const END_DELAY_MS = 1500;
const HUMAN: Player = 1;                              // 人类执黑先手
const AI: Player = opponent(HUMAN);

type Size = 9 | 13 | 19;
type Screen = 'match' | 'end';

interface UIState {
  screen: Screen;
  mode: 'ai' | 'pass';
  level: Difficulty;
  size: Size;
  handicap: number;                // 0 = 分先（黑先）；>=2 让子（白先）
  go: GoState;
  history: GoState[];
  moves: number[];                 // 棋谱：每手一个点下标（-1 = pass）
  clock: ClockState;
  aiThinking: boolean;
  reviewAt: number | null;         // 回放位置（null = 不在回放）
  over: boolean;
  endReason: 'score' | 'resign' | 'timeout' | null;
  resignArmed: boolean;
  endScheduled: boolean;
  counting: boolean;               // 终局数目确认阶段
  dead: DeadSet;                   // 玩家标定的「对方死子」下标
}

const state: UIState = {
  screen: 'match',
  mode: 'ai',
  level: 'medium',
  size: 19,
  handicap: 0,
  go: initialState(19),
  history: [],
  moves: [],
  clock: initialClock(),
  aiThinking: false,
  reviewAt: null,
  over: false,
  endReason: null,
  resignArmed: false,
  endScheduled: false,
  counting: false,
  dead: new Set(),
};

let ghost = -1;
let moveToken = 0;
let aiTimer: number | null = null;
let clockTimer: number | null = null;
let replayTimer: number | null = null;
let replayPlaying = false;
let clockLast = 0;

/* ── DOM ── */
const turnEl = $<HTMLElement>('go-turn');
const sizeEl = $<HTMLElement>('go-size-v');
const capsEl = $<HTMLElement>('go-caps');
const lastEl = $<HTMLElement>('go-last');
const modeEl = $<HTMLElement>('go-mode-v');
const metaSizeEl = $<HTMLElement>('go-meta-size');
const metaModeEl = $<HTMLElement>('go-meta-mode');
const clockMeTime = $<HTMLElement>('go-clock-me-time');
const clockOppTime = $<HTMLElement>('go-clock-opp-time');
const clockMeWho = $<HTMLElement>('go-clock-me-who');
const clockOppWho = $<HTMLElement>('go-clock-opp-who');
const clockMeBox = $<HTMLElement>('go-clock-me');
const clockOppBox = $<HTMLElement>('go-clock-opp');
const levelBtn = $<HTMLButtonElement>('go-level');
const levelCard = $<HTMLElement>('go-levelcard');
const leaveCard = $<HTMLElement>('go-leavecard');
const replayBar = $<HTMLElement>('go-replaybar');
const rpPos = $<HTMLElement>('go-rp-pos');
const rpRange = $<HTMLInputElement>('go-rp-range');
const rpPlay = $<HTMLButtonElement>('go-rp-play');
const endVerdict = $<HTMLElement>('go-end-verdict');
const endLine = $<HTMLElement>('go-end-line');
const matchEl = $<HTMLElement>('go-match');
const endEl = $<HTMLElement>('go-end');
const resignBtn = $<HTMLButtonElement>('go-resign');
const countBar = $<HTMLElement>('go-countbar');
const countB = $<HTMLElement>('go-count-b');
const countW = $<HTMLElement>('go-count-w');

/** 取翻译：字典未就绪 / 未命中时回退到 fallback（避免首帧显示裸 key） */
const t = (k: string, fallback: string): string => {
  let v = '';
  try { v = typeof window.t === 'function' ? window.t(k) : ''; } catch { v = ''; }
  return v && v !== k ? v : fallback;
};

/* ══════════════════════════════════════════════════════════════
   渲染
   ══════════════════════════════════════════════════════════════ */
function renderBoard(opts?: { placed?: number; captured?: number[]; capturedColor?: Player }): void {
  if (state.reviewAt !== null) {                    // 回放中：纯函数重放盘面
    const s = viewBoard(state.moves, state.reviewAt);
    boardEl.innerHTML = renderGoBoardSVG({
      size: state.size, board: s.board, lastMove: s.lastMove, placed: -1, interactive: false,
    });
    return;
  }
  boardEl.innerHTML = renderGoBoardSVG({
    size: state.size,
    board: state.go.board,
    lastMove: state.go.lastMove,
    placed: opts?.placed ?? -1,
    captured: opts?.captured ?? [],
    capturedColor: opts?.capturedColor ?? 2,
    ghost,
    dead: state.counting ? [...state.dead] : [],
    territory: state.counting ? territoryOf(state.dead) : [],
    interactive: true,
  });
  updateInfo();
}

/** 终局预览：去死子后的盘面上，双方各自围住的空点（territory） */
function territoryOf(dead: DeadSet): number[] {
  const resolved = resolveDead(state.go.board, state.size, dead);
  // flood-fill 空点，只邻接一种颜色 → 归该色；这里只用于「画哪些点」，
  // 归属颜色由 scoreWithDead 计算，渲染层只要知道「这些点被某方拥有」即可。
  const out: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < resolved.length; i++) {
    if (resolved[i] !== 0 || seen.has(i)) continue;
    const region: number[] = [];
    const stack = [i];
    seen.add(i);
    let tb = false, tw = false;
    while (stack.length) {
      const cur = stack.pop() as number;
      region.push(cur);
      const x = cur % state.size, y = Math.floor(cur / state.size);
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= state.size || ny >= state.size) continue;
        const ni = ny * state.size + nx;
        if (resolved[ni] === 0) { if (!seen.has(ni)) { seen.add(ni); stack.push(ni); } }
        else if (resolved[ni] === 1) tb = true;
        else tw = true;
      }
    }
    if (tb !== tw) out.push(...region);      // 只被一方围住 → 是 territory
  }
  return out;
}

/** 纯函数回放：重放 moves[0..upTo]，返回该时刻的 GoState（提子/劫都由引擎真实重放） */
function viewBoard(moves: number[], upTo: number): GoState {
  let s = state.handicap >= 2
    ? initialStateHandicap(state.size, state.handicap)
    : initialState(state.size);
  for (let i = 0; i <= upTo && i < moves.length; i++) {
    const m = moves[i];
    if (m < 0) s = pass(s);
    else {
      const r = play(s, m);
      if (r.ok && r.state) s = r.state;
    }
  }
  return s;
}

function canHumanMove(): boolean {
  if (state.over || state.reviewAt !== null) return false;
  if (state.screen !== 'match') return false;
  if (state.counting) return false;                    // 数目阶段不算「走子」
  if (state.mode === 'ai') return state.go.toPlay === HUMAN && !state.aiThinking;
  return true;
}

/* ══════════════════════════════════════════════════════════════
   终局数目确认（双 pass 后进入；玩家标对方死子 → 确认结算）
   ══════════════════════════════════════════════════════════════ */
function enterCounting(): void {
  state.counting = true;
  state.dead = new Set();
  stopClockLoop();
  document.body.classList.add('bd-counting');
  countBar.hidden = false;
  syncCount();
  renderBoard();
  // AI 模式：AI 不会主动认死子，由玩家替双方标（简化：玩家标完直接确认）
  $<HTMLElement>('go-count-hint').textContent = state.mode === 'ai'
    ? t('bg.bg_go_count_hint_ai', 'Tap enemy groups to mark them dead, then confirm. You are Black; the engine concedes any group with no liberties.')
    : t('bg.bg_go_count_hint', 'Tap a group of enemy stones to mark them dead. Empty eyes you already own are yours.');
}

/** 刷新数目条读数（去死子后中国规则数目） */
function syncCount(): void {
  const sc = scoreWithDead(state.go, state.dead);
  countB.textContent = String(sc.black);
  countW.textContent = String(sc.white);
}

/** 确认数目 → 终局结算 */
function confirmCount(): void {
  const sc = scoreWithDead(state.go, state.dead);
  const humanWon = state.mode === 'ai' ? sc.winner === HUMAN : sc.winner === 1;
  const verdict = state.mode === 'ai'
    ? (humanWon ? t('bg.bg_go_you_win', 'You win') : t('bg.bg_go_ai_wins', 'Engine wins'))
    : (sc.winner === 1 ? t('bi.black_wins', 'Black wins') : t('bi.white_wins', 'White wins'));
  const line = `${sc.black} – ${sc.white} · ${t('bg.bg_go_komi', 'komi')} 7.5`;
  exitCounting();
  endGame(verdict, line, 'score', humanWon);
}
function exitCounting(): void {
  state.counting = false;
  state.dead = new Set();
  document.body.classList.remove('bd-counting');
  countBar.hidden = true;
}

/** 数目阶段点击：切换对方棋块的死活（点任一点整块切换） */
function onCountCell(i: number): void {
  if (!state.counting) return;
  const enemy: Player = state.mode === 'ai' ? AI : (state.go.toPlay === 1 ? 2 : 1);
  if (state.go.board[i] !== enemy) {
    toast(t('bg.bg_go_count_only_enemy', 'Only enemy stones can be marked dead'));
    return;
  }
  state.dead = toggleDeadGroup(state.dead, i, enemy, state.go.board, state.size);
  syncCount();
  renderBoard();
}

function updateInfo(): void {
  const over = state.over;
  const thinking = state.aiThinking;
  let turn: string;
  if (state.reviewAt !== null) turn = t('bg.bg_go_review', 'Review');
  else if (over) turn = t('bi.game_over', 'Game over');
  else if (state.mode === 'ai') {
    turn = state.go.toPlay === HUMAN
      ? t('bg.bg_go_you_black_lc', 'You · Black')
      : (thinking
        ? `${t('bg.bg_go_engine', 'Engine')} · ${t('status.thinking', 'thinking…')}`
        : t('bg.bg_go_engine_white', 'Engine · White'));
  } else {
    turn = state.go.toPlay === 1 ? t('bj.black_p1', 'Black P1') : t('bj.white_p2', 'White P2');
  }
  turnEl.textContent = turn;
  turnEl.classList.toggle('is-thinking', thinking);
  sizeEl.textContent = `${state.size}×${state.size}`;
  capsEl.textContent = `${state.go.captures[0]} / ${state.go.captures[1]}`;
  lastEl.textContent = state.go.lastMove >= 0 && !over ? notation(state.size, state.go.lastMove) : '—';
  modeEl.textContent = state.mode === 'ai'
    ? `${t('bg.bg_go_vs', 'vs engine')} · ${state.level === 'easy' ? t('bg.bg_go_lv_easy_t', 'Novice') : t('bg.bg_go_lv_medium_t', 'Adept')}`
    : t('bg.bg_go_pass_play', 'Pass & Play');
  renderClocks();
}

function renderClocks(): void {
  const meC = state.clock.me;
  const oppC = state.clock.opp;
  clockMeTime.textContent = formatClock(meC);
  clockOppTime.textContent = formatClock(oppC);
  clockMeTime.classList.toggle('is-low', meC.inByoyomi);
  clockOppTime.classList.toggle('is-low', oppC.inByoyomi);
  if (state.mode === 'ai') {
    clockMeWho.textContent = t('bg.bg_go_you_black', 'YOU · BLACK');
    clockOppWho.textContent = t('bg.bg_go_engine_white', 'ENGINE · WHITE');
  } else {
    clockMeWho.textContent = t('bj.black_p1', 'BLACK P1');
    clockOppWho.textContent = t('bj.white_p2', 'WHITE P2');
  }
  const active = state.go.toPlay;
  clockMeBox.classList.toggle('is-active', !state.over && active === 1);
  clockOppBox.classList.toggle('is-active', !state.over && active === 2);
}

/* ══════════════════════════════════════════════════════════════
   棋钟驱动（每 250ms 推进到 Play 方）
   ══════════════════════════════════════════════════════════════ */
function startClockLoop(): void {
  stopClockLoop();
  clockLast = performance.now();
  clockTimer = window.setInterval(() => {
    if (state.screen !== 'match' || state.over || state.reviewAt !== null) return;
    const now = performance.now();
    const dt = now - clockLast;
    clockLast = now;
    if (dt <= 0) return;
    state.clock = { ...state.clock, toPlay: state.go.toPlay };
    const next = tickClock(state.clock, dt);
    state.clock = next;
    renderClocks();
    if (state.clock.timeout !== null) finishByTimeout();
  }, 250);
}
function stopClockLoop(): void {
  if (clockTimer !== null) { window.clearInterval(clockTimer); clockTimer = null; }
}

/* ══════════════════════════════════════════════════════════════
   落子 / 停手（placeLocal = 人类唯一落子出口，统一 playSfx('place')）
   ══════════════════════════════════════════════════════════════ */
function placeLocal(i: number): boolean {
  if (!canHumanMove()) return false;
  const before = state.go;
  const r = play(before, i);
  if (!r.ok) return false;
  const mover = before.toPlay;
  const oppC: Player = opponent(mover);
  state.history.push(before);
  const captured = diffCaptures(before.board, r.state!.board, oppC);
  state.go = r.state!;
  state.moves.push(i);
  state.clock = afterMoveClock(state.clock, mover);
  playSfx('place');
  const token = ++moveToken;
  renderBoard({ placed: i, captured, capturedColor: oppC });
  if (captured.length) window.setTimeout(() => { if (token === moveToken) renderBoard(); }, 300);
  afterMove();
  return true;
}

function passLocal(): void {
  if (!canHumanMove()) return;
  const mover = state.go.toPlay;
  state.history.push(state.go);
  state.go = pass(state.go);
  state.moves.push(-1);
  state.clock = afterMoveClock(state.clock, mover);
  renderBoard();
  afterMove();
}

/** 落子/停手后统一收尾：终局判定 + AI 调度 */
function afterMove(): void {
  if (state.go.passes >= 2) {
    // 双 pass → 进入数目确认阶段（玩家标死子），不在这里直接结束
    if (!state.counting) { enterCounting(); return; }
    return;
  }
  if (state.mode === 'ai' && !state.over && !state.counting && state.go.toPlay === AI) scheduleAi();
}

function scheduleAi(): void {
  cancelAiMove();
  state.aiThinking = true;
  updateInfo();
  const base = AI_THINK_MS[state.level] + (state.moves.length <= 1 ? 260 : 0);   // 开局加时
  const delay = Math.round(base * (0.88 + Math.random() * 0.24));                 // ±12% 抖动
  aiTimer = window.setTimeout(() => {
    aiTimer = null;
    state.aiThinking = false;
    if (state.over || state.reviewAt !== null || state.screen !== 'match' || state.counting) { updateInfo(); return; }
    // 人类已停一手（passes>=1）→ AI 也停一手，进入终局数目确认
    if (state.go.passes >= 1) {
      state.history.push(state.go);
      state.go = pass(state.go);
      state.moves.push(-1);
      state.clock = afterMoveClock(state.clock, AI);
      renderBoard();
      afterMove();
      return;
    }
    const m = bestMove(state.go, state.level);
    if (m < 0) {
      state.history.push(state.go);
      state.go = pass(state.go);
      state.moves.push(-1);
      state.clock = afterMoveClock(state.clock, AI);
      renderBoard();
    } else {
      const before = state.go;
      const r = play(before, m);
      if (r.ok && r.state) {
        state.history.push(before);
        const captured = diffCaptures(before.board, r.state.board, HUMAN);
        state.go = r.state;
        state.moves.push(m);
        state.clock = afterMoveClock(state.clock, AI);
        playSfx('place');
        const token = ++moveToken;
        renderBoard({ placed: m, captured, capturedColor: HUMAN });
        if (captured.length) window.setTimeout(() => { if (token === moveToken) renderBoard(); }, 300);
      }
    }
    afterMove();
  }, delay);
}
function cancelAiMove(): void {
  if (aiTimer !== null) { window.clearTimeout(aiTimer); aiTimer = null; }
  state.aiThinking = false;
}

/* ══════════════════════════════════════════════════════════════
   终局（双 pass 数目 / 认输 / 超时）
   ══════════════════════════════════════════════════════════════ */
function finishByResign(): void {
  if (state.mode === 'ai') {
    endGame(t('bj.you_resigned', 'You resigned'), t('bj.by_resignation', 'by resignation'), 'resign', false);
  } else {
    const winner = opponent(state.go.toPlay);
    endGame(winner === 1 ? t('bi.black_wins', 'Black wins') : t('bi.white_wins', 'White wins'),
      t('bj.by_resignation', 'by resignation'), 'resign', winner === 1);
  }
}
function finishByTimeout(): void {
  const loser = state.clock.timeout;
  if (loser === null) return;                        // 无超时方（防御，正常不会进来）
  if (state.mode === 'ai') {
    const youTimedOut = loser === HUMAN;
    endGame(youTimedOut ? t('bg.bg_go_timeout_you', 'You ran out of time') : t('bg.bg_go_timeout_ai', 'Engine ran out of time'),
      t('bg.bg_go_byoyomi', 'by time (byoyomi)'), 'timeout', !youTimedOut);
  } else {
    const winner = opponent(loser);
    endGame(winner === 1 ? t('bi.black_wins', 'Black wins') : t('bi.white_wins', 'White wins'),
      t('bg.bg_go_byoyomi', 'by time (byoyomi)'), 'timeout', winner === 1);
  }
}
function endGame(verdict: string, line: string, reason: UIState['endReason'], humanWon: boolean): void {
  if (state.over) return;
  state.over = true;
  state.endReason = reason;
  cancelAiMove();
  stopClockLoop();
  endVerdict.textContent = verdict;
  endLine.textContent = line;
  if (state.mode === 'ai') playSfx(humanWon ? 'win' : 'lose');
  scheduleEndScreen();
}
/** 终局延迟 1.5s 进结算屏（让玩家看清最后一手） */
function scheduleEndScreen(): void {
  if (state.endScheduled) return;
  state.endScheduled = true;
  window.setTimeout(() => {
    if (state.over && state.reviewAt === null) showScreen('end');
  }, END_DELAY_MS);
}
function showScreen(s: Screen): void {
  state.screen = s;
  matchEl.hidden = s !== 'match';
  endEl.hidden = s !== 'end';
  document.body.classList.toggle('bd-in-match', s === 'match' && !state.over);
  if (s === 'end') stopClockLoop();
}

/* ══════════════════════════════════════════════════════════════
   新局 / 悔棋 / 认输
   ══════════════════════════════════════════════════════════════ */
function newGame(sz?: Size): void {
  if (sz) state.size = sz;
  cancelAiMove();
  stopClockLoop();
  resetReplayUI();
  exitCounting();
  state.go = state.handicap >= 2
    ? initialStateHandicap(state.size, state.handicap)
    : initialState(state.size);
  state.history = [];
  state.moves = [];
  state.clock = initialClock();
  state.over = false;
  state.endReason = null;
  state.resignArmed = false;
  state.endScheduled = false;
  state.reviewAt = null;
  ghost = -1;
  moveToken++;
  metaSizeEl.textContent = `${state.size}×${state.size}`;
  metaModeEl.textContent = state.mode === 'ai'
    ? `${t('bg.bg_go_vs', 'vs AI')} · ${state.level}`
    : (state.handicap >= 2 ? `H${state.handicap}` : '2 players');
  document.querySelectorAll<HTMLButtonElement>('#go-sizes button').forEach((b) => {
    b.classList.toggle('is-cur', Number(b.dataset.size) === state.size);
  });
  resignBtn.textContent = t('bg.bg_go_resign', 'Resign');
  showScreen('match');
  startClockLoop();
  renderBoard();
  armBackGuard();
}

function doUndo(): void {
  cancelAiMove();
  if (state.over || state.reviewAt !== null || !state.history.length) return;
  let guard = 0;
  while (state.history.length > 0 && guard < state.size * state.size + 2) {
    state.go = state.history.pop()!;
    state.moves.pop();
    guard++;
    if (state.mode !== 'ai' || state.go.toPlay === HUMAN) break;
  }
  // 棋钟按剩余手数重建（黑先，依次轮转）
  state.clock = initialClock();
  for (let i = 0; i < state.moves.length; i++) {
    state.clock = afterMoveClock(state.clock, (i % 2 === 0 ? 1 : 2) as Player);
  }
  ghost = -1;
  moveToken++;
  renderBoard();
}

function doResign(): void {
  if (state.over) return;
  if (!state.resignArmed) {
    state.resignArmed = true;
    resignBtn.textContent = t('bj.confirm_resign', 'Confirm resign?');
    window.setTimeout(() => {
      if (state.resignArmed && !state.over) { state.resignArmed = false; resignBtn.textContent = t('bg.bg_go_resign', 'Resign'); }
    }, 2600);
    return;
  }
  finishByResign();
}

/* ══════════════════════════════════════════════════════════════
   棋谱回放
   ══════════════════════════════════════════════════════════════ */
function enterReplay(): void {
  if (!state.moves.length) { toast(t('bg.bg_go_no_moves', 'No moves to review')); return; }
  cancelAiMove();
  stopClockLoop();
  state.reviewAt = 0;
  replayBar.hidden = false;
  document.body.classList.add('bd-replay');
  syncReplayUI();
  renderBoard();
}
function exitReplay(): void {
  stopReplayAuto();
  state.reviewAt = null;
  replayBar.hidden = true;
  document.body.classList.remove('bd-replay');
  if (!state.over) startClockLoop();
  renderBoard();
  updateInfo();
}
function setReview(at: number): void {
  if (state.reviewAt === null) return;
  state.reviewAt = Math.max(0, Math.min(state.moves.length - 1, at));
  syncReplayUI();
  renderBoard();
}
function stepReview(d: number): void { stopReplayAuto(); setReview((state.reviewAt ?? 0) + d); }
function syncReplayUI(): void {
  const at = state.reviewAt ?? 0;
  const total = state.moves.length;
  rpPos.textContent = `${at + 1} / ${total}`;
  rpRange.max = String(Math.max(0, total - 1));
  rpRange.value = String(at);
  rpPlay.setAttribute('aria-label', replayPlaying ? t('bg.bg_go_rp_pause', 'Pause') : t('bg.bg_go_rp_play', 'Play'));
}
function toggleReplayAuto(): void {
  if (replayPlaying) { stopReplayAuto(); syncReplayUI(); return; }
  if (state.reviewAt === null) return;
  if ((state.reviewAt ?? 0) >= state.moves.length - 1) state.reviewAt = 0;
  replayPlaying = true;
  replayTimer = window.setInterval(() => {
    if (state.reviewAt === null) { stopReplayAuto(); return; }
    if ((state.reviewAt ?? 0) >= state.moves.length - 1) { stopReplayAuto(); syncReplayUI(); return; }
    setReview((state.reviewAt ?? 0) + 1);
  }, REPLAY_MS);
  syncReplayUI();
}
function stopReplayAuto(): void {
  if (replayTimer !== null) { window.clearInterval(replayTimer); replayTimer = null; }
  replayPlaying = false;
}
function resetReplayUI(): void {
  stopReplayAuto();
  state.reviewAt = null;
  replayBar.hidden = true;
  document.body.classList.remove('bd-replay');
}

/* ══════════════════════════════════════════════════════════════
   退出守卫（pushState 占位 + popstate 拦截）
   ══════════════════════════════════════════════════════════════ */
let backGuard = false;
let backLeaving = false;
let pendingLobbyNav = false;

function armBackGuard(): void {
  if (backGuard) return;
  try { history.pushState({ bdMatch: 1 }, ''); backGuard = true; } catch (e) { /* 放弃拦截 */ }
}
window.addEventListener('popstate', () => {
  if (backLeaving) {
    backLeaving = false;
    if (pendingLobbyNav) { pendingLobbyNav = false; location.replace(MODE_PAGE); }
    return;
  }
  if (state.screen !== 'match' || state.over) return;
  try { history.pushState({ bdMatch: 1 }, ''); backGuard = true; } catch (e) { /* noop */ }
  leaveCard.hidden = false;
});
function stayInGame(): void { leaveCard.hidden = true; }
function exitMatchToLobby(): void {
  leaveCard.hidden = true;
  cancelAiMove();
  stopClockLoop();
  resetReplayUI();
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

/* ══════════════════════════════════════════════════════════════
   事件绑定
   ══════════════════════════════════════════════════════════════ */
boardEl.addEventListener('click', (ev) => {
  const g = (ev.target as Element).closest?.('.go-cell') as HTMLElement | null;
  if (!g) return;
  const i = Number(g.dataset.i);
  if (state.counting) { onCountCell(i); return; }
  placeLocal(i);
});
if (!isTouch) {
  boardEl.addEventListener('mousemove', (ev) => {
    const g = (ev.target as Element).closest?.('.go-cell') as HTMLElement | null;
    const i = g ? Number(g.dataset.i) : -1;
    const want = canHumanMove() ? i : -1;
    if (want !== ghost) { ghost = want; renderBoard(); }
  });
  boardEl.addEventListener('mouseleave', () => { if (ghost !== -1) { ghost = -1; renderBoard(); } });
}

$<HTMLButtonElement>('go-pass').addEventListener('click', passLocal);
$<HTMLButtonElement>('go-undo').addEventListener('click', doUndo);
resignBtn.addEventListener('click', doResign);

/* ── 终局数目确认 ── */
$<HTMLButtonElement>('go-count-ok').addEventListener('click', confirmCount);
$<HTMLButtonElement>('go-count-clear').addEventListener('click', () => {
  state.dead = new Set();
  syncCount();
  renderBoard();
});

/* ── 让子棋 ── */
$<HTMLElement>('go-handicap').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest?.('button[data-hc]') as HTMLButtonElement | null;
  if (!b) return;
  state.handicap = Number(b.dataset.hc);
  document.querySelectorAll<HTMLButtonElement>('#go-handicap button').forEach((x) => x.classList.toggle('is-cur', x === b));
  newGame();
});

$<HTMLElement>('go-sizes').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest?.('button[data-size]') as HTMLButtonElement | null;
  if (b) newGame(Number(b.dataset.size) as Size);
});

$<HTMLButtonElement>('go-replay').addEventListener('click', () => { state.reviewAt === null ? enterReplay() : exitReplay(); });
$<HTMLButtonElement>('go-rp-first').addEventListener('click', () => { stopReplayAuto(); setReview(0); });
$<HTMLButtonElement>('go-rp-prev').addEventListener('click', () => stepReview(-1));
$<HTMLButtonElement>('go-rp-next').addEventListener('click', () => stepReview(1));
$<HTMLButtonElement>('go-rp-last').addEventListener('click', () => { stopReplayAuto(); setReview(state.moves.length - 1); });
rpPlay.addEventListener('click', toggleReplayAuto);
$<HTMLButtonElement>('go-rp-exit').addEventListener('click', exitReplay);
rpRange.addEventListener('input', () => { stopReplayAuto(); setReview(Number(rpRange.value)); });   // 先取值再停播（防拖动回弹）

levelBtn.addEventListener('click', () => { levelCard.hidden = !levelCard.hidden; });
levelCard.addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest?.('.go-level-opt') as HTMLButtonElement | null;
  if (!b) return;
  state.level = b.dataset.level as Difficulty;
  levelCard.hidden = true;
  newGame();
});
$<HTMLButtonElement>('go-level-close').addEventListener('click', () => { levelCard.hidden = true; });

$<HTMLButtonElement>('go-leave-close').addEventListener('click', stayInGame);
$<HTMLButtonElement>('go-leave-stay').addEventListener('click', stayInGame);
$<HTMLButtonElement>('go-leave-yes').addEventListener('click', exitMatchToLobby);
$<HTMLButtonElement>('go-back-lobby').addEventListener('click', exitMatchToLobby);
$<HTMLButtonElement>('go-end-lobby').addEventListener('click', exitMatchToLobby);
$<HTMLButtonElement>('go-rematch').addEventListener('click', () => newGame());
$<HTMLButtonElement>('go-review').addEventListener('click', () => { showScreen('match'); enterReplay(); });

const soundBtn = $<HTMLButtonElement>('go-sound');
function syncSound(): void {
  const on = sfxOn();
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.setAttribute('aria-label', on ? t('bg.bg_go_sound_on', 'Sound on') : t('bg.bg_go_sound_off', 'Sound off'));
}
soundBtn.addEventListener('click', () => {
  setSfx(!sfxOn());
  syncSound();
  if (sfxOn()) playSfx('start');
});
['pointerdown', 'touchstart', 'mousedown'].forEach((ev) =>
  window.addEventListener(ev, unlockSfx, { passive: true }));
document.addEventListener('visibilitychange', () => { if (!document.hidden) unlockSfx(); });
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  levelCard.hidden = true;
  leaveCard.hidden = true;
});

/* ══════════════════════════════════════════════════════════════
   深链 / 启动
   ══════════════════════════════════════════════════════════════ */
function readMode(): void {
  const q = new URLSearchParams(location.search);
  const m = q.get('mode');
  state.mode = m === 'pass' ? 'pass' : 'ai';
  const lv = q.get('level');
  if (lv === 'easy' || lv === 'medium') state.level = lv;
  const sz = q.get('size');
  if (sz === '9' || sz === '13' || sz === '19') state.size = Number(sz) as Size;
  // 让子只在同屏双人模式有意义（AI 棋力固定，不需要让子）
  const hc = q.get('hc');
  if (state.mode === 'pass' && hc && /^[02469]$/.test(hc)) state.handicap = Number(hc);
}

function boot(): void {
  readMode();
  levelBtn.hidden = state.mode !== 'ai';
  $<HTMLElement>('go-handicap').hidden = state.mode !== 'pass';   // 让子仅同屏双人
  syncSound();
  newGame();
  // i18n 字典异步 fetch：ready/change 后重渲染，避免首帧裸 key（gomoku 同款坑）
  window.addEventListener('i18n:ready', () => { updateInfo(); syncSound(); });
  window.addEventListener('i18n:change', () => { updateInfo(); syncSound(); });
  setTimeout(() => { updateInfo(); syncSound(); }, 250);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// 裸访问（无 ?mode= / ?c=）→ 回模式大厅（两段式铁律）
(function redirectBare(): void {
  const q = new URLSearchParams(location.search);
  if (q.get('mode') || q.get('c')) return;
  const sz = q.get('size');
  location.replace(sz ? `${MODE_PAGE}?size=${sz}` : MODE_PAGE);
})();
