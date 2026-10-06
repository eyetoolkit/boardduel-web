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
import { myName as ocMyName, opponentNameFromState, isMoveRejected } from '../online-core';
// 2026-10-06：好友房邀请卡片（全屏遮罩弹窗，范式抄 MathDuel 24-game share-overlay）
import { mountInviteCard, showInviteCard, onOpponentJoined } from '../invite-card';
import '../../styles/invite-card.css';
import {
  initialState, play, pass, notation, opponent,
  scoreWithDead, toggleDeadGroup, resolveDead, hashPosition,
  territoryByColor, legalMoves,
  type GoState, type Player, type DeadSet,
} from './engine';
import { renderGoBoardSVG, diffCaptures } from './render';
import { bestMoveAny, isNeural, type Difficulty } from './ai';
import { bestMoveKatago, warmupKatago, katagoStatus, TEMP_BY_DIFFICULTY } from './katago';
import { initialClock, tickClock, afterMoveClock, formatClock, type ClockState } from './clock';

setupNav('go');
wireLobbyChrome();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const boardEl = $<HTMLDivElement>('bd-board');
const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

const MODE_PAGE = '/games/go/lobby/';
// 思考节奏：所有 AI 档位都走神经网络 KataGo b6c96（单次前向 ≈ 16ms WebGL / 1s CPU），
// AI_THINK_MS 只控制"假装在思考"的 UI 延迟，避免网络下秒落显得机械。
const AI_THINK_MS: Record<Difficulty, number> = { easy: 420, medium: 600, hard: 900, katago: 260 };

/**
 * 🆕 2026-10-05：围棋三档 AI 全部走 KataGo b6c96 神经网络（不同 temp 区分棋力），
 * 不再有 αβ 同步搜索路径——`bestMoveKatago` 异步调用，预算由前向耗时决定。
 *
 * WebGL 实测 15.6ms/手 → UI 延迟 260ms 让开局有"思考"感。
 * CPU 回退 ~1s/手 → UI 延迟适当延长以避免网络抖动。
 */

/**
 * 🆕 W6：hard/medium 的**搜索时间预算**（ms）。
 *
 * 🔴 关键约束：搜索是**同步**跑的（bestMove 在主线程），预算 = 真实 UI 卡顿时间。
 * 必须与 AI_THINK_MS 协调：动画播完后再卡 budget ms。
 * 取 350ms 是权衡结果：9 路 depth 3~4 能在预算内跑完，桌面不卡手；
 * 且搜索在 depth 2 之后收益趋平（实测 depth2/3/4 选点几乎一致），
 * 再加预算只烧时间不涨棋力。移动端若仍卡，可下调或改走 Web Worker。
 */
const REPLAY_MS = 900;
const END_DELAY_MS = 1500;
const HUMAN: Player = 1;                              // 人类执黑先手
const AI: Player = opponent(HUMAN);

type Size = 19;
type Screen = 'match' | 'end';

interface UIState {
  screen: Screen;
  mode: 'ai' | 'pass' | 'ranked';
  level: Difficulty;
  size: Size;
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
  countPending: boolean;           // 联机：已提交本方标记，等对手确认
  dead: DeadSet;                   // 玩家标定的「对方死子」下标
  /**
   * 「形势」叠加层：玩家主动点「形势」按钮时为 true，把每个空位按归属染色；
   * 默认 false，棋盘外观与之前一致。
   * 终局（state.over）时强制关闭 —— 双方已确认死子，进「点目」精算即可。
   */
  showSituation: boolean;
  /**
   * 「点目」面板：true 时显示精算目数（活子 + territory + 贴目，含 KOMI）。
   * 与 `state.counting` 不同：counting 是终局后死子确认，这个是**任意时刻**的精算。
   */
  showScorePanel: boolean;
  /**
   * 🔴 2026-10-04：已出现过的局面哈希集合（board + toPlay），用于 positional superko。
   *
   * 中国规则要求「同形再现禁止」—— 整盘局面 + 轮到方不得重复。
   * 引擎的 `superko` 是**可选参数**（`computePlay(state,i,opts)`），
   * 而 `ai.ts` 内部搜索**开了**（superko=true + 自建 history），
   * 但 UI 的 8 处 play()/legalMoves() 调用**全部没传** ⇒ 玩家能走 AI 认为非法的棋，
   * 三劫 / 长生 / 双打单等循环劫争无解。
   * 这个集合必须在每次落子后更新，并在悔棋/新局/回放重建时同步。
   */
  posHashes: Set<string>;
  /** 联机：WebSocket */
  ws: WebSocket | null;
  /** 联机：房间码 */
  roomCode: string | null;
  /** 联机：本玩家座位 0/1（0=黑，1=白） */
  myIdx: number | null;
  /** 联机：本地是否已发起/收到 game_over（区分“我认输” vs “对手认输”） */
  sawGameOver: boolean;
  /**
   * 联机：对局是否已真正开始（收到 'start' 或 state.roomStatus==='playing'）。
   * 🔴 2026-10-05：没有这个守卫，房主在对手进房前就能落子——本地棋盘走了、
   * 服务端拒绝（对局未开始），等对手进房 'start' 广播一来 newGame() 又清盘，
   * 造成「我下的子凭空消失」的错觉。
   */
  rankedLive: boolean;
  /** 对手昵称；未进房为 null。对手侧标签与时钟高亮都用它。 */
  oppName: string | null;
}

const state: UIState = {
  screen: 'match',
  mode: 'ai',
  level: 'medium',     // 默认档：αβ depth 2，玩家可切到 hard 或 katago
  size: 19 as const,
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
  countPending: false,
  dead: new Set(),
  showSituation: false,
  showScorePanel: false,
  posHashes: new Set<string>(),
  ws: null,
  roomCode: null,
  myIdx: null,
  sawGameOver: false,
  rankedLive: false,
  oppName: null,
};

/* ══════════════════════════════════════════════════════════════
   超级劫（positional superko）辅助
   中国规则要求整盘局面不得重复。所有落子路径必须走playWithKo()，
   它负责「校验时带上 posHashes，落子后把新局面加进去」。
   ══════════════════════════════════════════════════════════════ */
/** 落子 + 登记局面哈希（唯一落子出口的规则层包装） */
function playWithKo(st: GoState, i: number) {
  const r = play(st, i, { superko: true, history: state.posHashes });
  if (r.ok && r.state) state.posHashes.add(hashPosition(r.state.board, r.state.toPlay));
  return r;
}
/** pass 也是一次轮转，局面（board+toPlay）同样算「出现过」 */
function registerHash(st: GoState): void {
  state.posHashes.add(hashPosition(st.board, st.toPlay));
}
/** 新局 / 让子变更：重置局面集合并登记初始局面 */
function resetPosHashes(): void {
  state.posHashes = new Set<string>();
  registerHash(state.go);
}

const API = (() => {
  const w = window as unknown as { API_BASE?: string };
  if (w.API_BASE) return w.API_BASE;
  return '';
})();

function myName(): string {
  return ocMyName();
}

/* ─── 邀请深链 ─── */
function inviteCode(): string {
  try {
    const q = new URLSearchParams(location.search);
    // 🔴 2026-10-05：兼容 ?c= / ?room= / ?code=（gomoku 同款；第三方/手写邀请链接不再被丢）
    const c = q.get('c') || q.get('room') || q.get('code');
    if (!c) return '';
    return /^[A-Za-z0-9]{5,8}$/.test(c) ? c.toUpperCase() : '';
  } catch (e) { return ''; }
}
function inviteIsHost(): boolean {
  try { return new URLSearchParams(location.search).get('vs') === '1'; }
  catch (e) { return false; }
}
function clearInviteParam(): void {
  try {
    const u = new URL(location.href);
    u.searchParams.delete('c');
    u.searchParams.delete('vs');
    u.searchParams.delete('room');
    u.searchParams.delete('code');
    const q = u.searchParams.toString();
    history.replaceState(null, '', u.pathname + (q ? '?' + q : '') + u.hash);
  } catch (e) { /* noop */ }
}

let ghost = -1;
let moveToken = 0;
let aiTimer: number | null = null;
/** KataGo 下载进度轮询（200ms），见 startKatagoWarmup */
let kgPollTimer: number | null = null;
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
const situationBtn = $<HTMLButtonElement>('go-situation');
const chatEl = $<HTMLDivElement>('go-chat');
const chatToggleBtn = $<HTMLButtonElement>('go-chat-toggle');
const chatLog = $<HTMLUListElement>('go-chat-log');
const chatForm = $<HTMLFormElement>('go-chat-form');
const chatInput = $<HTMLInputElement>('go-chat-input');
const chatRoom = $<HTMLElement>('go-chat-room');
const inviteEl = $<HTMLElement>('go-invite');
const inviteCopyBtn = $<HTMLButtonElement>('go-invite-copy');
mountInviteCard('go', 'go', 'Go · 19×19');
const scorePanelBtn = $<HTMLButtonElement>('go-score-panel');
const scorePanel = $<HTMLElement>('go-scorepanel');
const scorePanelBody = $<HTMLElement>('go-scorepanel-body');
const scorePanelKomi = $<HTMLElement>('go-scorepanel-komi');

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
    // 🔴 2026-10-04 round3 修复：回放期间态势/形势叠加层也要跟上 reviewAt 位置，
    // 否则棋盘已回到第 N 手但形势叠加层还显示「最后一手」的染色（永远对不上）。
    // 但点目面板在 updateInfo 钩子里按 state.go 算数字 —— 见下方 renderScorePanel 分支。
    const reviewSit = state.showSituation
      ? territoryByColor(s.board, state.size, state.dead)
      : undefined;
    boardEl.innerHTML = renderGoBoardSVG({
      size: state.size, board: s.board, lastMove: s.lastMove, placed: -1, interactive: false,
      situation: reviewSit,
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
    // 「形势」叠加：玩家主动开启时把每个空位按归属染色。
    // 🔴 2026-10-04 round3 修复：终局后仍可看形势（玩家审视死子是否漏标），去掉 !state.over 守卫。
    situation: state.showSituation
      ? territoryByColor(state.go.board, state.size, state.dead)
      : undefined,
    interactive: true,
    hitMode: state.counting ? 'count' : 'play',
    countEnemy: (state.mode === 'ai' ? AI : (state.go.toPlay === 1 ? 2 : 1)) as Player,
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
  let s = initialState(state.size);
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
  if (state.aiThinking) return false;
  if (state.mode === 'ai') return state.go.toPlay === HUMAN;
  if (state.mode === 'ranked') {
    // 🔴 2026-10-05：对局未真正开始（对手没进房）不允许落子——否则本地走了、
    //   服务端拒了、'start' 一来又被清盘，玩家看到「子凭空消失」。
    if (!state.rankedLive) return false;
    if (state.myIdx === null) return false;
    const mySide: Player = state.myIdx === 0 ? 1 : 2;
    return state.go.toPlay === mySide;
  }
  return true; // pass & play
}

/* ══════════════════════════════════════════════════════════════
   终局数目确认（双 pass 后进入；玩家标对方死子 → 确认结算）
   ══════════════════════════════════════════════════════════════ */
function enterCounting(): void {
  // 联机下座位未知时不能进入：结算要把结果归到某一方，myIdx 为 null 会无从判定。
  if (state.mode === 'ranked' && state.myIdx === null) return;
  state.counting = true;
  state.countPending = false;
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

/** 确认数目 → 终局结算。
 *  联机（ranked）**不再就地结算**：把本方标出的「对方死子」提交给服务端，
 *  等双方都提交后由 count_ready 下发两端的集合，取并集再算分。
 *  两方标的是不同的子（黑标白 / 白标黑），集合天然互补，所以并集无歧义、
 *  两端算出的比分必然相同 —— 此前不交换、就地各算各的，比分可能不同且谁都不作数。 */
function confirmCount(): void {
  if (state.mode === 'ranked') {
    // 座位未知时无法把结果归到正确的一方，先别收
    if (state.myIdx === null) return;
    state.countPending = true;
    sendWs({ type: 'count_submit', dead: [...state.dead] });
    $('go-count-hint').textContent = t('bg.bg_go_count_wait', 'Waiting for your opponent to confirm the count…');
    renderBoard();
    return;
  }
  finishCounting(new Set(state.dead));
}

/** 用「双方标记的并集」结算（两端各自算，结果必然一致） */
function finishCounting(dead: Set<number>): void {
  const sc = scoreWithDead(state.go, dead);
  let verdict: string;
  let humanWon = false;
  if (state.mode === 'ai') {
    humanWon = sc.winner === HUMAN;
    verdict = humanWon ? t('bg.bg_go_you_win', 'You win') : t('bg.bg_go_ai_wins', 'Engine wins');
  } else if (state.mode === 'ranked') {
    const mySide: Player = state.myIdx === 0 ? 1 : 2;
    humanWon = sc.winner === mySide;
    verdict = humanWon ? t('bg.bg_go_you_win', 'You win') : t('bg.bg_go_opp_wins', 'You lose');
  } else {
    verdict = sc.winner === 1 ? t('bi.black_wins', 'Black wins') : t('bi.white_wins', 'White wins');
  }
  const line = `${sc.black} – ${sc.white} · ${t('bg.bg_go_komi', 'komi')} 7.5`;
  state.countPending = false;
  exitCounting();
  endGame(verdict, line, 'score', humanWon);
  // 联机：败方（或和棋）向服务端宣告结果，触发正常结算与房间收尾。
  // 胜方不发 —— 与现有「认输由败方发起」的约定一致，避免重复 settle。
  // 座位映射与上面一致：seat 0 = 黑(1)，seat 1 = 白(2)。
  if (state.mode === 'ranked' && state.myIdx !== null && !humanWon) {
    const winnerSeat: 0 | 1 | 'draw' = sc.winner === 1 ? 0 : sc.winner === 2 ? 1 : 'draw';
    sendWs({ type: 'count_finish', winner: winnerSeat });
  }
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

/** 当前难度的显示名（三档） */
function levelLabel(): string {
  if (state.level === 'hard') return t('bg.bg_go_lv_hard_t', 'Hard');
  if (state.level === 'katago') return t('bg.bg_go_lv_katago_t', 'KataGo');
  return t('bg.bg_go_lv_medium_t', 'Medium');
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
  } else if (state.mode === 'ranked') {
    // ranked：轮次行只显示黑白（与 gomoku 一致，避免和 HUD 标签重复）
    turn = state.go.toPlay === 1 ? 'Black' : 'White';
  } else {
    turn = state.go.toPlay === 1 ? t('bj.black_p1', 'Black P1') : t('bj.white_p2', 'White P2');
  }
  turnEl.textContent = turn;
  turnEl.classList.toggle('is-thinking', thinking);
  sizeEl.textContent = `${state.size}×${state.size}`;
  capsEl.textContent = `${state.go.captures[0]} / ${state.go.captures[1]}`;
  lastEl.textContent = state.go.lastMove >= 0 && !over ? notation(state.size, state.go.lastMove) : '—';
  modeEl.textContent = state.mode === 'ai'
    ? `${t('bg.bg_go_vs', 'vs engine')} · ${levelLabel()}`
    : state.mode === 'ranked'
      ? t('bj.ranked_online', 'Ranked online')
      : t('bg.bg_go_pass_play', 'Pass & Play');
  renderClocks();
  // 点目面板开着就跟着刷新（每手棋后数值变）
  if (state.showScorePanel) renderScorePanel();
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
  } else if (state.mode === 'ranked') {
    clockMeWho.textContent = state.myIdx === 0 ? t('bj.you_black', 'You · Black') : t('bj.you_white', 'You · White');
    // 对手没进房时别写「Opponent · White」——表也没走（clockFrozen），写等待态才对应真实情况。
    clockOppWho.textContent = state.rankedLive && state.oppName
      ? state.oppName
      : t('bg.bg_common_waiting_opponent', 'Waiting for opponent…');
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

   🔴 2026-10-04：加冻结机制。两个「假超时」来源都会让人以为计时器坏了：
     ① KataGo 首次加载（TF.js + 3.7MB 权重，弱网好几秒）。这段时间**谁都没在思考**，
        却一直在扣 AI 的表 → AI 自己先超时。加载完成前整个表停走。
     ② 标签页切后台。浏览器会把 setInterval 节流到 ≥1s（后台甚至 1min），
        玩家回来那一帧 dt = 60s+ → 瞬间烧掉一分钟 → 假超时。
        切走时冻结，回来时重新取基准点，dt 不累积。
   ══════════════════════════════════════════════════════════════ */
function clockFrozen(): boolean {
  if (document.hidden) return true;
  // 引擎加载中：AI 的表不走（人类此刻也没法落子，公平）
  if (state.mode === 'ai' && katagoStatus().loading) return true;
  // 🔴 2026-10-06：对手还没进房时不能走表。棋盘锁（canHumanMove:363）做了，
  //   但时钟没跟着锁 —— 建房方是黑方（toPlay=1，initialClock 默认）时，
  //   空房等 10 分钟主时间就烧光，finishByTimeout 直接判负。
  if (state.mode === 'ranked' && !state.rankedLive) return true;
  return false;
}

function startClockLoop(): void {
  stopClockLoop();
  clockLast = performance.now();
  clockTimer = window.setInterval(() => {
    if (state.screen !== 'match' || state.over || state.reviewAt !== null) return;
    const now = performance.now();
    const dt = now - clockLast;
    clockLast = now;                       // 🔴 无论走不走表都刷新基准（冻结时 dt 被丢弃）
    if (dt <= 0 || clockFrozen()) return;
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
  const r = playWithKo(before, i);
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
  if (state.mode === 'ranked') sendWs({ type: 'move', i });
  afterMove();
  return true;
}

function passLocal(): void {
  if (!canHumanMove()) return;
  const mover = state.go.toPlay;
  state.history.push(state.go);
  state.go = pass(state.go);
  registerHash(state.go);                    // 🔴 pass 也是一次轮转，局面要登记
  state.moves.push(-1);
  state.clock = afterMoveClock(state.clock, mover);
  playSfx('place');
  renderBoard();
  if (state.mode === 'ranked') sendWs({ type: 'move', i: -1 });
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
  // ranked：轮到对手时刷新 UI（棋钟高亮、轮次行）
  if (state.mode === 'ranked') updateInfo();
}

/**
 * AI 回合。
 *
 * 🆕 第三档 katago 是**异步**神经网络路径：要先加载 TF.js + 3.7 MB 权重，
 * 前向在 WebGL 上是异步的（await）。规则档（medium/hard）仍是同步调用。
 * 所以拆成两条路径，共用后面的落子/渲染逻辑。
 */
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
      registerHash(state.go);
      state.moves.push(-1);
      state.clock = afterMoveClock(state.clock, AI);
      renderBoard();
      afterMove();
      return;
    }
    if (isNeural(state.level)) {
      // 异步：神经网络（easy/medium/hard 全走 KataGo 同网络，仅 temp 区分）
      void runKatagoTurn();
      return;
    }
    // 理论上不会到达（所有 UI 档位都是 isNeural），兜底走规则档（向后兼容）
    const m = bestMoveAny(state.go, state.level);
    applyAiMove(m);
  }, delay);
}

/** 把算出的落点落到盘上并推进 UI（规则/神经网络两条路径共用）。 */
function applyAiMove(m: number): void {
  if (m < 0) {
    state.history.push(state.go);
    state.go = pass(state.go);
    registerHash(state.go);
    state.moves.push(-1);
    state.clock = afterMoveClock(state.clock, AI);
    renderBoard();
  } else {
    const before = state.go;
    const r = playWithKo(before, m);
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
    } else {
      // 🔴 2026-10-04 补：原来这里静默跳过。AI 与 UI 的合法点集不一致时（曾因
      // katago.ts 漏传 superko 导致）表现为「AI 突然停手不落子」，玩家无从察觉。
      // 现在落成warn + 降级 pass，保证对局继续且留有痕迹。
      console.warn('[go] AI move rejected by engine:', r.reason, 'idx', m);
      state.history.push(before);
      state.go = pass(before);
      registerHash(state.go);
      state.moves.push(-1);
      state.clock = afterMoveClock(state.clock, AI);
      renderBoard();
    }
  }
  afterMove();
}

/** KataGo 不可用时的用户提示（只 toast 一次，免得每手都弹）。 */
let _aiFallbackNoteShown = false;
function aiFallbackNote(err: string): void {
  if (_aiFallbackNoteShown) return;
  _aiFallbackNoteShown = true;
  toast(t('bg.bg_go_katago_fallback', 'KataGo could not load — falling back to random play. Reload to retry.') + ` (${err})`);
}

/**
 * 🔴 手机端的加载反馈。
 *
 * 症状：5 MB 弱网下要好几秒，而原来只有一个 2.2 秒的 toast —— 用户看到屏幕没反应
 * 就以为「加载失败」。这里改成一个常驻的加载卡，带真实百分比（来自 fetch 的
 * Content-Length），并在超长无响应时给出可重试的按钮。
 */
function updateLoadCard(): void {
  const card = document.getElementById('go-kg-load');
  if (!card) return;
  const st = katagoStatus();
  const need = st.loading;
  card.hidden = !need;
  if (!need) return;
  const pct = st.downloadProgress;
  const bar = document.getElementById('go-kg-bar');
  const txt = document.getElementById('go-kg-txt');
  if (bar) bar.style.width = pct == null ? '100%' : `${Math.round(pct * 100)}%`;
  if (bar) bar.classList.toggle('is-indeterminate', pct == null);
  if (txt) {
    txt.textContent = pct == null
      ? t('bg.bg_go_kg_preparing', 'Preparing the engine…')
      : t('bg.bg_go_kg_downloading', 'Downloading the engine') + ` ${Math.round(pct * 100)}%`;
  }
}

/** 启动 KataGo 预热（带进度 UI + 失败重试）。 */
function startKatagoWarmup(): void {
  if (!isNeural(state.level)) return;
  updateLoadCard();
  // 轮询进度：fetch 的 reader 每收到一块就更新 katagoStatus()，
  // 这里 200 ms 刷一次 UI 就够（再密只是烧 CPU）。
  if (kgPollTimer) window.clearInterval(kgPollTimer);
  kgPollTimer = window.setInterval(updateLoadCard, 200);
  void warmupKatago(state.size)
    .then(updateLoadCard)
    .catch(updateLoadCard)
    .finally(() => { if (kgPollTimer) { window.clearInterval(kgPollTimer); kgPollTimer = 0; } });
}

/** 第三档：KataGo 神经网络回合（异步）。 */
async function runKatagoTurn(): Promise<void> {
  state.aiThinking = true;
  updateInfo();
  const before = state.go;
  const movesSnapshot = state.moves.slice();
  // 🔴快照传给异步 AI：等待期间玩家可能悔棋/落子，live 的 posHashes 已变，
  // 但 AI 是在「等待前那一刻」的合法点集上决策的（这才是它该看到的局面）。
  const hashSnapshot = new Set(state.posHashes);
  try {
    // 按档位传 temp（easy/medium/hard 共享同一 KataGo 网络，仅温度不同）
    const temp = TEMP_BY_DIFFICULTY[state.level as 'easy' | 'medium' | 'hard'];
    const m = await bestMoveKatago(before, state.size, movesSnapshot, temp, undefined, hashSnapshot);
    // 等待期间玩家可能已经退出/悔棋/重开/进回放 —— 丢弃这一手
    // 🔴 2026-10-04：补 state.reviewAt 守卫（与 scheduleAi 对齐）。
    // 否则进回放期间 KataGo 解出手 → 落在被回放覆盖的盘面上（state.go 已不对应 before）。
    if (state.over || state.screen !== 'match' || state.go !== before || state.reviewAt !== null) {
      state.aiThinking = false;
      updateInfo();
      return;
    }
    state.aiThinking = false;
    applyAiMove(m);
  } catch (e) {
    state.aiThinking = false;
    updateInfo();
    // 加载失败不该让玩家卡死：toast 提示一次，并随机走一个合法点让游戏继续。
    // 规则 AI 档已下线（方案 A 后），所以兜底改成"随机合法点"——玩家能继续下，
    // AI 走法每手随机（按 easy 档语义更自然），等玩家手动刷新页面再恢复 KataGo。
    const msg = katagoStatus().error ?? String(e);
    console.warn('[go] KataGo unavailable, falling back to random play:', msg);
    aiFallbackNote(msg);
    if (state.go === before && !state.over) {
      const legal = legalMoves(before, { superko: true, history: state.posHashes });
      // 没合法点（终局 / 全占）→ pass；否则随机挑一个
      const m = legal.length > 0 ? legal[(Math.random() * legal.length) | 0] : -1;
      applyAiMove(m);
    }
  }
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
  } else if (state.mode === 'ranked') {
    const mySide: Player = state.myIdx === 0 ? 1 : 2;
    const winner = opponent(state.go.toPlay);
    const humanWon = winner === mySide;
    endGame(humanWon ? t('bg.bg_go_you_win', 'You win') : t('bg.bg_go_opp_wins', 'You lose'),
      t('bj.by_resignation', 'by resignation'), 'resign', humanWon);
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
  } else if (state.mode === 'ranked') {
    // 🔴 2026-10-05：本地超时必须通知服务端结算（否则对手端棋局永远继续，两端失步）。
    //   走 resign → 服务端 settleAndBroadcast(winner=对手) → 对手收到 game_over。
    sendWs({ type: 'resign' });
    const mySide: Player = state.myIdx === 0 ? 1 : 2;
    const winner = opponent(loser);
    const humanWon = winner === mySide;
    endGame(humanWon ? t('bg.bg_go_you_win', 'You win') : t('bg.bg_go_opp_wins', 'You lose'),
      t('bg.bg_go_byoyomi', 'by time (byoyomi)'), 'timeout', humanWon);
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
function newGame(): void {
  cancelAiMove();
  stopClockLoop();
  resetReplayUI();
  exitCounting();
  state.go = initialState(state.size);
  state.history = [];
  state.moves = [];
  state.clock = initialClock();
  resetPosHashes();                    // 🔴 新局必须重置 superko 集合，否则沿用上一局的历史局面
  state.over = false;
  state.endReason = null;
  state.resignArmed = false;
  state.endScheduled = false;
  state.reviewAt = null;
  state.showSituation = false;          // 关闭形势叠加层
  state.showScorePanel = false;         // 关闭点目面板
  ghost = -1;
  moveToken++;
  metaSizeEl.textContent = `${state.size}×${state.size}`;
  metaModeEl.textContent = state.mode === 'ai'
    ? `${t('bg.bg_go_vs', 'vs AI')} · ${state.level}`
    : state.mode === 'ranked'
      ? t('bj.ranked_online', 'Ranked online')
      : t('bj.pass_play', 'Pass & Play');
  resignBtn.textContent = t('bg.bg_go_resign', 'Resign');
  // ranked 模式下保留 roomCode/myIdx/ws；其余模式隐藏聊天/邀请面板
  if (state.mode !== 'ranked') {
    chatEl.hidden = true;
    chatToggleBtn.hidden = true;
    inviteEl.hidden = true;
  }
  showScreen('match');
  startClockLoop();
  renderBoard();
  armBackGuard();
}

function doUndo(): void {
  cancelAiMove();
  // 🔴 2026-10-04：原守卫缺 state.counting —— 玩家可在数目阶段悔棋退掉双 pass，
  // 此时 counting 仍 true 但 passes 已退回 1，局面与数目阶段脱节、canHumanMove 永久 false。
  if (state.over || state.reviewAt !== null || state.counting || !state.history.length) return;
  if (state.mode === 'ranked') {
    sendWs({ type: 'takeback_request' });
    toast(t('bj.takeback_requested', 'Takeback requested'));
    return;
  }
  applyLocalUndo();
}

function applyLocalUndo(): void {
  let guard = 0;
  while (state.history.length > 0 && guard < state.size * state.size + 2) {
    state.go = state.history.pop()!;
    state.moves.pop();
    guard++;
    if (state.mode !== 'ai' || state.go.toPlay === HUMAN) break;
  }
  // 🔴 2026-10-04 原实现把棋钟`initialClock()` 全额重建 = 双方时间与读秒段全部返还。
  //   后果：玩家在读秒最后 5s 时悔棋一次就回到 600s/5 段 → 可无限悔棋续命，
  //   计时器对人类形同虚设（30s 时代只是小作弊，10min 棋钟下是彻底无限制）。
  //   改为：只轮转toPlay（谁走表），**不动任何剩余时间**。
  //   走完的AI 思考时间也不退还 —— 那是真实消耗。
  state.clock = { ...state.clock, toPlay: state.go.toPlay };
  // 局面哈希也要跟着回退：悔棋后历史被丢弃，但已出现过的局面必须重���登记，
  // 否则玩家可以悔棋重走一个「当时被判superko 非法」的点。
  rebuildPosHashes();
  ghost = -1;
  moveToken++;
  renderBoard();
}

/** 按state.moves 从初始局面重放，重建 posHashes（悔棋后调用） */
function rebuildPosHashes(): void {
  state.posHashes = new Set<string>();
  const s0 = initialState(state.size);
  registerHash(s0);
  const h = new Set<string>(state.posHashes);
  let cur = s0;
  for (const m of state.moves) {
    if (m < 0) { cur = pass(cur); }
    else {
      const r = play(cur, m, { superko: true, history: h });
      if (!r.ok || !r.state) break;          // 历史里不该有非法手；保险起见停止
      cur = r.state;
    }
    h.add(hashPosition(cur.board, cur.toPlay));
  }
  state.posHashes = h;
}

/* ══════════════════════════════════════════════════════════════
   联机房间（WS）—— 参考 gomoku 实现
   ══════════════════════════════════════════════════════════════ */
function wsUrl(code: string, name: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`;
}

function enterRankedRoom(code: string): void {
  state.roomCode = code;
  state.mode = 'ranked';
  chatEl.hidden = false;
  chatToggleBtn.hidden = false;
  chatRoom.textContent = code;
  chatLog.innerHTML = '';
  toast('Room ' + code + ' — waiting for opponent');
  let ws: WebSocket;
  try { ws = new WebSocket(wsUrl(code, myName())); }
  catch (e) { toast('Could not open room'); return; }
  state.ws = ws;
  ws.addEventListener('open', () => { chatRoom.textContent = code + ' · live'; });
  ws.addEventListener('message', (ev) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    handleWs(msg);
  });
  ws.addEventListener('close', () => {
    chatRoom.textContent = code + ' · offline';
    state.rankedLive = false;
    if (state.screen === 'match' && !state.over) toast('Connection lost');
  });
  ws.addEventListener('error', () => { toast('Room unavailable'); });
}

async function startFriendRoom(): Promise<void> {
  showScreen('match');
  renderBoard();
  const fail = () => {
    toast('Could not open a friend room');
    window.setTimeout(() => location.replace(MODE_PAGE), 900);
  };
  try {
    const r = await fetch(API + '/api/gp/room?name=' + encodeURIComponent(myName()) + '&game=go', { credentials: 'include' });
    const j = (await r.json()) as { ok?: boolean; code?: string };
    const code = String((j && j.code) || '').toUpperCase();
    if (!r.ok || !/^[A-Z2-9]{6}$/.test(code)) { fail(); return; }
    enterRankedRoom(code);
    // 2026-10-06：改弹全屏邀请卡片（范式抄 MathDuel 24-game share-overlay）。
    // 原 .go-invite 是侧栏内联面板，移动端 .bd-side 是 display:contents
    // 会被摊平成裸流 —— 二维码直接铺在棋盘下方、房码被挤出视口。
    if (inviteEl) inviteEl.hidden = true;
    showInviteCard('go', 'go', code);
  } catch (e) { fail(); }
}

function sendWs(obj: Record<string, unknown>): void {
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
}

/** 联机再战回声闸：armed=true 表示本方刚发过 restart，等着吞掉自己那份 restart_notify */
let restartEchoArmed = false;

/**
 * 服务端拒了刚落的那一手（错回合 / 非法点）→ 退回到落子之前。
 * 之前只弹 toast：本地子已经落在盘上并轮了表，而对手那边没有这一步，
 * 于是双方棋盘从此分叉，且 canHumanMove 的轮次判断再也对不回来。
 * 棋钟按 applyLocalUndo 的同一口径处理：只轮转 toPlay，不返还任何时间。
 */
function rollbackRejected(): void {
  cancelAiMove();
  const prev = state.history.pop();
  if (prev) {
    state.go = prev;
    state.clock = { ...state.clock, toPlay: prev.toPlay };
  }
  state.moves.pop();
  state.over = false;
  state.sawGameOver = false;
  // 🔴 必须重建 posHashes —— 与 applyLocalUndo:901 同一处漏网。
  // playWithKo 已经把「被回滚掉的那个局面」的哈希登记进去了，不清掉的话它会永远
  // 留在集合里；之后对手的合法着法一旦复现该局面，computePlay 判 superko 拒绝，
  // 而接收分支没有 else —— 对手那一手被静默丢弃，toPlay 也不再推进，整盘就此错位。
  rebuildPosHashes();
  renderBoard();
  updateInfo();
  toast(t('bg.bg_common_move_rejected', 'Move rejected'));
}

function handleWs(msg: Record<string, unknown>): void {
  const ty = String(msg.type || '');
  if (ty === 'state' || ty === 'start') {
    const inner = (msg.state && typeof msg.state === 'object') ? (msg.state as Record<string, unknown>) : null;
    if (typeof msg.you === 'number') state.myIdx = msg.you;
    else if (inner && typeof inner.you === 'number') state.myIdx = inner.you;
    const code = typeof msg.code === 'string' ? msg.code : (inner && typeof inner.code === 'string' ? inner.code : '');
    if (code && state.roomCode !== code) {
      state.roomCode = code;
      chatRoom.textContent = code;
    }
    // 对局真正开始：'start' 广播或 state.roomStatus==='playing'
    const roomStatus = inner ? String(inner.roomStatus || '') : '';
    if (ty === 'start' || roomStatus === 'playing') state.rankedLive = true;
    // 对手昵称：players 随 state/start 帧下来（start 广播新增字段），人数不足时 helper 返回 null
    const nm = opponentNameFromState(msg, state.myIdx);
    if (nm) state.oppName = nm;
    if (!state.rankedLive) state.oppName = null;
    // 2026-10-06：对手进房 → 邀请卡片自动收起（延迟 9s，给对方扫码留时间）
    if (ty === 'start' || roomStatus === 'playing') onOpponentJoined('go');
    // 🔴 2026-10-05：state 快照若带着法历史（服务端 relayGoMoves），按历史重放恢复棋盘，
    //   而不是无脑 newGame() 清盘 —— 否则刷新/重连后棋盘直接清空（实测异常根因）。
    //   moves 为空（未开局/刚开局）→ 正常 newGame()；已终局则不动。
    if (state.over) return;
    const mv = (inner && Array.isArray(inner.moves) ? inner.moves : (Array.isArray(msg.moves) ? msg.moves : null)) as number[] | null;
    if (mv && mv.length) rebuildFromServer(mv);
    else newGame();
    return;
  }
  if (ty === 'opponent_move') {
    // 终局/数目确认/回放中不再受理对手着法（防乱序消息污染棋盘）
    if (state.over || state.counting || state.reviewAt !== null) return;
    const i = typeof msg.i === 'number' ? msg.i : -1;
    if (i >= 0) {
      const before = state.go;
      const r = playWithKo(before, i);
      if (r.ok && r.state) {
        const oppC: Player = opponent(before.toPlay);
        state.history.push(before);
        const captured = diffCaptures(before.board, r.state.board, oppC);
        state.go = r.state;
        state.moves.push(i);
        state.clock = afterMoveClock(state.clock, before.toPlay);
        playSfx('place');
        renderBoard({ placed: i, captured, capturedColor: oppC });
        afterMove();
      }
    } else {
      // pass
      const before = state.go;
      state.history.push(before);
      state.go = pass(before);
      registerHash(state.go);
      state.moves.push(-1);
      state.clock = afterMoveClock(state.clock, before.toPlay);
      playSfx('place');
      renderBoard();
      afterMove();
    }
    return;
  }
  if (ty === 'move_ack') {
    if (msg.clock) syncServerClock(msg.clock as Record<string, number>);
    return;
  }
  if (ty === 'clock_state') {
    if (msg.clock) syncServerClock(msg.clock as Record<string, number>);
    return;
  }
  if (ty === 'chat') {
    addChat(String(msg.name || '—'), String(msg.text || ''), !!msg.emoji);
    return;
  }
  if (ty === 'game_over') {
    // 🔴 2026-10-05：服务端 game_over 实际字段是 { winner: 座位号|'draw', reason }，
    //   没有 you_lost/kind 字段 —— 旧代码读 you_lost 永远 undefined，胜负全靠
    //   sawGameOver 碰运气（刷新过页面的一方胜负显示必错）。改为 winner 对比 myIdx。
    state.over = true;
    state.sawGameOver = true;
    stopClockLoop();
    const reason = String(msg.reason || 'resign');
    const w = msg.winner;
    if (w === 'draw') {
      endVerdict.textContent = t('bi.draw', 'Draw');
      endVerdict.className = 'go-end-verdict is-draw';
      endLine.textContent = t('bj.draw_agreed', 'Draw agreed');
    } else {
      const iLost = (typeof w === 'number' && state.myIdx !== null)
        ? w !== state.myIdx
        : !!msg.you_lost;
      const line = reason === 'timeout'
        ? t('bg.bg_go_byoyomi', 'by time (byoyomi)')
        : reason === 'opponent_left'
          ? t('bj.opp_left', 'Opponent left')
          : t('bj.by_resignation', 'by resignation');
      if (reason === 'resign') {
        endVerdict.textContent = iLost ? t('bj.you_resigned', 'You resigned') : t('bj.opp_resigned', 'Opponent resigned');
      } else if (reason === 'timeout') {
        endVerdict.textContent = iLost ? t('bg.bg_go_timeout_you', 'You ran out of time') : t('bg.bg_go_you_win', 'You win');
      } else {
        endVerdict.textContent = iLost ? t('bg.bg_go_opp_wins', 'You lose') : t('bg.bg_go_you_win', 'You win');
      }
      endVerdict.className = 'go-end-verdict ' + (iLost ? 'is-loss' : 'is-win');
      endLine.textContent = line;
    }
    showScreen('end');
    return;
  }
  if (ty === 'resign') {
    state.over = true;
    stopClockLoop();
    endVerdict.textContent = t('bj.opp_resigned', 'Opponent resigned');
    endVerdict.className = 'go-end-verdict is-win';
    endLine.textContent = t('bj.by_resignation', 'by resignation');
    showScreen('end');
    return;
  }
  if (ty === 'takeback_request') { toast(t('bj.takeback_request', 'Opponent asks to take back')); return; }
  if (ty === 'takeback_done') {
    applyLocalUndo();
    if (msg.clock) syncServerClock(msg.clock as Record<string, number>);
    toast(t('bj.takeback_accepted', 'Takeback accepted'));
    return;
  }
  if (ty === 'takeback_declined') { toast(t('bj.takeback_declined', 'Takeback declined')); return; }
  // go 自带 WS、不走 online-core 的 sendWs，再战回声闸自己上闩。
  // 服务端 restart 无差别广播，发起方也会收到自己那份；不吞的话回声会
  // 把往返窗口内刚落下的一子擦掉。
  // go 终局数目：双方标记都到齐 → 取并集结算（两端各自算，结果必然一致）
  if (ty === 'count_ready') {
    const d = Array.isArray(msg.dead) ? msg.dead : null;
    if (!d || !Array.isArray(d[0]) || !Array.isArray(d[1])) return;
    if (state.over) return;
    const union = new Set<number>();
    for (const n of [...d[0], ...d[1]]) if (typeof n === 'number') union.add(n);
    state.dead = union;
    finishCounting(union);
    return;
  }
  if (ty === 'restart_notify') { if (restartEchoArmed) { restartEchoArmed = false; return; } state.over = false; newGame(); return; }
  // 对手离开后必须锁盘（canHumanMove 靠 rankedLive 判）。不锁的话玩家还能继续落子，
  // 而这些子投不出去 —— 宽限期内变成对手永远看不到的幽灵子。
  if (ty === 'opponent_leave') {
    state.rankedLive = false;
    state.oppName = null;
    toast(t('bj.opp_left', 'Opponent left'));
    renderBoard();
    updateInfo();
    return;
  }
  if (ty === 'error') { if (isMoveRejected(msg)) rollbackRejected(); toast(String(msg.message || 'Room error')); return; }
}

function syncServerClock(_c: Record<string, number>): void {
  // 本地 clock 结构与服务端不同：本地用 me/opp，服务端用 w/b。
  // 简单处理：只更新剩余秒数的大致比例（go 本地棋钟独立运行，这里仅做参考）。
  // 如需精确同步，可后续扩展。
}

/**
 * 🔴 2026-10-05：按服务端着法历史重放恢复棋盘（刷新/重连后调用）。
 * 先 newGame() 清盘，再逐手重放（不转发、不出声）；最后把棋钟轮到当前行棋方。
 */
function rebuildFromServer(moves: number[]): void {
  newGame();
  for (const m of moves) {
    if (m < 0) {
      state.history.push(state.go);
      state.go = pass(state.go);
      registerHash(state.go);
      state.moves.push(-1);
    } else {
      const r = playWithKo(state.go, m);
      if (r.ok && r.state) {
        state.history.push(state.go);
        state.go = r.state;
        state.moves.push(m);
      }
      // 历史里的非法手（理论不该有）：跳过，保持后续重放尽力对齐
    }
  }
  state.clock = { ...state.clock, toPlay: state.go.toPlay };
  ghost = -1;
  renderBoard();
  updateInfo();
}

function addChat(who: string, text: string, emoji: boolean): void {
  const li = document.createElement('li');
  li.className = 'go-chat-row';
  li.innerHTML = `<b>${escapeHtml(who)}</b><span${emoji ? ' class="is-emoji"' : ''}>${escapeHtml(text)}</span>`;
  chatLog.appendChild(li);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function leaveRoom(): void {
  if (state.ws) {
    try { state.ws.close(); } catch (e) { /* ignore */ }
    state.ws = null;
  }
  state.roomCode = null;
  state.myIdx = null;
  state.sawGameOver = false;
  state.rankedLive = false;
  chatEl.hidden = true;
  chatEl.classList.remove('is-open');
  chatToggleBtn.hidden = true;
  inviteEl.hidden = true;
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
  if (state.mode === 'ranked') {
    state.sawGameOver = true;
    sendWs({ type: 'resign' });
    // 服务端不回显时也要给玩家终局画面
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      window.setTimeout(() => {
        if (state.over) return;
        state.over = true;
        stopClockLoop();
        endVerdict.textContent = t('bj.you_resigned', 'You resigned');
        endVerdict.className = 'go-end-verdict is-loss';
        endLine.textContent = t('bj.by_resignation', 'by resignation');
        showScreen('end');
      }, 1500);
    } else {
      finishByResign();
    }
    return;
  }
  finishByResign();
}

/* ══════════════════════════════════════════════════════════════
   形势 / 点目（玩家主动触发的叠加层 + 精算面板）

   - 「形势」：把每个空点按归属染色（黑/白独占），中立空点不画。
   - 「点目」：任意时刻展示精算目数（活子 + 围空 + KOMI），与终局的
     死子确认逻辑共用 engine.scoreWithDead / territoryByColor。
   - 两者都是「视图层」功能，不动 state.go，不算手，不触发 i18n。
   ══════════════════════════════════════════════════════════════ */
function toggleSituation(): void {
  // 终局后强制关闭 —— 双方已确认死子，再染色反而误导
  if (state.over) return;
  state.showSituation = !state.showSituation;
  situationBtn.setAttribute('aria-pressed', String(state.showSituation));
  renderBoard();
}

function toggleScorePanel(): void {
  state.showScorePanel = !state.showScorePanel;
  scorePanel.hidden = !state.showScorePanel;
  scorePanelBtn.setAttribute('aria-pressed', String(state.showScorePanel));
  if (state.showScorePanel) renderScorePanel();
}

function renderScorePanel(): void {
  // 用 scoreWithDead 而不是 scoreChinese —— 玩家若已标了死子（counting），
  // 面板数值必须与「终局结算」保持一致，否则「点目」与「确认结算」对不上。
  // 🔴 2026-10-04 round3 修复：回放期间用 viewBoard(state.moves, reviewAt) 的局面，
  // 否则数字属于「最后一手」而不属于「回放位置」，与棋盘显示脱节。
  const reviewSt = state.reviewAt !== null
    ? viewBoard(state.moves, state.reviewAt)
    : state.go;
  const sc = scoreWithDead(reviewSt, state.dead);
  const sign = (n: number) => n > 0 ? '+' + n.toFixed(1) : n.toFixed(1);
  // 行：黑 / 白 / 差（已含 KOMI；scoreWithDead 把 +7.5 加到白上）
  const diff = sc.black - sc.white;
  // 🔴 2026-10-06 P1 修复（round3 审计 P1-1）：侧栏三格用 data-i18n，不用 JS 字符串拼接。
  //   原因：i18n.js 的 applyLiterals() 扫描叶子节点做 LITERALS 精确文本匹配，
  //   而 LITERALS 表里有裸中文 "差" → coins.deficit。日语下 coins.deficit =「不足額」，
  //   于是 renderScorePanel 注入的「差」被 MutationObserver 改写成「不足額」
  //   （日语用户 = 意义完全错误，且每次重渲染复发）。
  //   改走 data-i18n 路径后由 applyToDOM 主动翻译，绕开 applyLiterals 的字面量表。
  scorePanelBody.innerHTML = `
    <tr>
      <td class="go-scorepanel-side go-scorepanel-b" data-i18n="bj.black_p1">Black</td>
      <td>${sc.blackStones}</td>
      <td>${sc.blackTerritory}</td>
      <td><b>${sc.black.toFixed(1)}</b></td>
    </tr>
    <tr>
      <td class="go-scorepanel-side go-scorepanel-w" data-i18n="bj.white_p2">White</td>
      <td>${sc.whiteStones}</td>
      <td>${sc.whiteTerritory}</td>
      <td><b>${sc.white.toFixed(1)}</b></td>
    </tr>
    <tr>
      <td class="go-scorepanel-side" data-i18n="bg.bg_go_score_diff" data-i18n-skip>Diff</td>
      <td></td>
      <td></td>
      <td><b class="${diff > 0 ? 'go-scorepanel-b' : diff < 0 ? 'go-scorepanel-w' : ''}">${sign(diff)}</b></td>
    </tr>
  `;
  // innerHTML 直接赋值会新增 data-i18n 节点，主动触发一次翻译（否则要等下一轮 observer）
  try { window.i18n?.applyToDOM?.(scorePanelBody); } catch (e) { /* i18n 未就绪则保留英文 fallback */ }
  // KOMI 提示：白 +7.5 贴目已在 score.white 里算进，这里只解释给玩家看。
  scorePanelKomi.textContent = `${t('bg.bg_go_komi', 'komi')} 7.5`;
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
  // 🔴 2026-10-04：对局已结束时（end 屏点 Review 进回放），退出回放必须回到 end 屏，
  // 不能留在 match 屏（match 屏 over=true 时全部控件失效，Rematch/End Lobby 都不可见）。
  if (state.over) {
    showScreen('end');
  } else {
    if (state.screen !== 'match') showScreen('match');
    startClockLoop();
  }
  renderBoard();
  updateInfo();
  // 🔴 2026-10-04：进回放期间可能轮到 AI，scheduleAi 的 setTimeout 被 cancelAiMove 清掉，
  // KataGo 的 await 返回时由 reviewAt 守卫丢弃。退出回放后必须重新调度，
  // 否则 < 1300ms 进回放就会卡死（AI 表持续走约 5 分钟后判超时，玩家看着引擎超时结束）。
  if (!state.over && !state.counting && state.screen === 'match'
      && state.mode === 'ai' && state.go.toPlay === AI && !state.aiThinking) {
    scheduleAi();
  }
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
  leaveRoom();                    // 关 WS，避免离开后服务端还以为在线
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

// 形势叠加 / 点目面板
situationBtn.addEventListener('click', toggleSituation);
scorePanelBtn.addEventListener('click', toggleScorePanel);
$<HTMLButtonElement>('go-scorepanel-close').addEventListener('click', () => {
  state.showScorePanel = false;
  scorePanel.hidden = true;
  scorePanelBtn.setAttribute('aria-pressed', 'false');
});

/* ── 终局数目确认 ── */
$<HTMLButtonElement>('go-count-ok').addEventListener('click', confirmCount);
$<HTMLButtonElement>('go-count-clear').addEventListener('click', () => {
  state.dead = new Set();
  syncCount();
  renderBoard();
});

/* 让子棋已下线（2026-10-04：用户决策）。原 #go-handicap 区块保留但隐藏以兼容旧 HTML 引用。 */

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
  // 神经网络档：先在后台把 TF.js + 权重拉起来，5 MB 下载不占用玩家的思考时间。
  if (isNeural(state.level)) startKatagoWarmup();
  newGame();
});
$<HTMLButtonElement>('go-level-close').addEventListener('click', () => { levelCard.hidden = true; });

$<HTMLButtonElement>('go-leave-close').addEventListener('click', stayInGame);
$<HTMLButtonElement>('go-leave-stay').addEventListener('click', stayInGame);
$<HTMLButtonElement>('go-leave-yes').addEventListener('click', exitMatchToLobby);
$<HTMLButtonElement>('go-back-lobby').addEventListener('click', exitMatchToLobby);
$<HTMLButtonElement>('go-end-lobby').addEventListener('click', exitMatchToLobby);
$<HTMLButtonElement>('go-rematch').addEventListener('click', () => {
  if (state.mode === 'ranked') { restartEchoArmed = true; sendWs({ type: 'restart' }); state.over = false; newGame(); return; }
  newGame();
});
// ── 联机：聊天 / 邀请 / 再战 ──
chatToggleBtn.addEventListener('click', () => {
  const open = chatEl.classList.toggle('is-open');
  chatToggleBtn.setAttribute('aria-expanded', String(open));
});
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  sendWs({ type: 'chat', text });
  chatInput.value = '';
});
inviteCopyBtn.addEventListener('click', () => {
  const code = state.roomCode || '';
  const link = location.origin + '/b/go/' + code;
  const done = () => toast(t('bj.link_copied', 'Invite link copied'));
  const fail = () => toast('Copy failed — code ' + code);
  try { navigator.clipboard.writeText(link).then(done, fail); } catch { fail(); }
});
// 🔴 2026-10-04：原代码 `showScreen('match'); enterReplay();` ——
// review 从 end 屏跳到 match 屏进回放，但退出回放时 state.screen 仍是 'match'，
// 而 state.over=true 使 match 屏所有控件失效，end 屏又因 showScreen('match')
// 被 hide。Rematch / go-end-lobby / go-review 都不可见，玩家无法重开或退房。
// 修法：从 end 屏 Review 专用路径，进回放不切屏，退出回放时显式回到 end 屏。
$<HTMLButtonElement>('go-review').addEventListener('click', () => { enterReplay(); });

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
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) unlockSfx();
  // 🔴 回前台：重取棋钟基准点。否则冻结期间累积的 dt 会在下一帧一次性灌进表里
  // → 玩家切个回来就被判超时（实测 setInterval 后台被节流到 1s+，回来就是 60s+ 的 dt）。
  clockLast = performance.now();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  levelCard.hidden = true;
  leaveCard.hidden = true;
});

/* ══════════════════════════════════════════════════════════════
   深链 / 启动
   ══════════════════════════════════════════════════════════════ */
let pendingFriend = false;   // 深链 ?mode=friend：进好友房（异步建房，boot 里消费）
function readMode(): void {
  const q = new URLSearchParams(location.search);
  const m = (q.get('mode') || '').toLowerCase();
  if (m === 'pass') { state.mode = 'pass'; return; }
  if (m === 'friend') { state.mode = 'ranked'; pendingFriend = true; return; }
  // 默认 AI 模式（含 engine / ai / 留空）
  state.mode = 'ai';
  // 三档 AI：medium（默认）/ hard / katago。旧深链 ?level=easy 不再被承认。
  const lv = q.get('level');
  if (lv === 'medium' || lv === 'hard' || lv === 'katago') state.level = lv;
  // 9/13 路已永久下线，所有对局都是 19 路。
}

function boot(): void {
  readMode();
  levelBtn.hidden = state.mode !== 'ai';
  // 🔴 2026-10-04：go-resign 已移走 data-i18n（i18n MutationObserver 会把动态文案重置回 fallback，
  // 导致二次确认「Confirm resign?」被 60ms 后还原）。JS 在 boot 时填充一次，i18n:ready/change
  // 时仅在「未二次确认」状态下同步，避免认输流程误重置。
  resignBtn.textContent = t('bg.bg_go_resign', 'Resign');
  syncSound();
  // 神经网络档：进页面就预热（5 MB 弱网下要几秒，越早开始越好），
  // 不要等玩家走完第一手才加载。
  if (state.mode === 'ai') startKatagoWarmup();

  // 深链优先级：?c= 邀请房 > ?mode=friend（gomoku 同款范式）。
  // 两者都走 relay 模式：进房后服务端在双方到齐时回 'start'，handleWs 再 newGame 重置。
  const code = inviteCode();
  if (code) {
    state.mode = 'ranked';
    clearInviteParam();
    showScreen('match');
    renderBoard();                 // 先画空盘，等 WS 'start' 接管
    enterRankedRoom(code);
    toast(inviteIsHost() ? 'Room ' + code + ' created — waiting for your opponent' : 'Joining room ' + code);
  } else if (pendingFriend) {
    void startFriendRoom();        // 内部 showScreen + renderBoard + fetch 建房 + enterRankedRoom
  } else {
    newGame();                     // ai / pass → 本地开局
  }
  // i18n 字典异步 fetch：ready/change 后重渲染，避免首帧裸 key（gomoku 同款坑）
  // 🔴 2026-10-04：go-resign 二次确认态由 JS 管，i18n:change 时仅当未 armed 才刷新文案。
  window.addEventListener('i18n:ready', () => { updateInfo(); syncSound(); if (!state.resignArmed) resignBtn.textContent = t('bg.bg_go_resign', 'Resign'); });
  window.addEventListener('i18n:change', () => { updateInfo(); syncSound(); if (!state.resignArmed) resignBtn.textContent = t('bg.bg_go_resign', 'Resign'); });
  setTimeout(() => { updateInfo(); syncSound(); if (!state.resignArmed) resignBtn.textContent = t('bg.bg_go_resign', 'Resign'); }, 250);
}

// 残留2（2026-10-05）：字典异步到位后重绘 HUD——棋钟/轮次行文案不再以 key 名滞留
window.addEventListener('i18n:change', () => { try { updateInfo(); } catch (e) { /* noop */ } });

// 🔴 2026-10-05 残留4修复：裸访问守卫必须在 boot() 之前执行！
// 此前放在模块末尾（boot 派发之后），而 boot 进房分支的 clearInviteParam()
// 会先删掉 URL 上的 ?code=/?room=，守卫随后看到"裸 URL"误判为裸访问 →
// location.replace 弹回大厅。实测 ?code=/?room= 深链 100% 复现（gomoku 的
// 守卫在 init 顶部所以没事 —— 教训：守卫必须先于一切会改 URL 的逻辑）。
(function redirectBare(): void {
  const q = new URLSearchParams(location.search);
  if (q.get('mode') || q.get('c') || q.get('room') || q.get('code')) return;
  const sz = q.get('size');
  location.replace(sz ? `${MODE_PAGE}?size=${sz}` : MODE_PAGE);
})();

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
