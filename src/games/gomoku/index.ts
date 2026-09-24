/**
 * BoardDuel · Gomoku（五子棋）15×15 · 完整可玩
 *
 * 对齐设计稿（五子棋.html）：
 *   01 BOARD LANGUAGE — 坐标尺 A–O / 15→1（退到 58% 尺寸）、幽灵落子、
 *      金环标胜、记谱器、提示板（原始权重）、双棋钟、Undo/Hint/Resign、
 *      结果条（含获胜连线命名）、触屏两步落子。
 *   02/03/04 — SCREEN 1 LOBBY / SCREEN 2 MATCH / SCREEN 3 END 三段式。
 *   后端三件套 — 排位匹配（/api/match/*）、房间聊天、观战（/ws 协议）。
 *
 * 设计原则：
 *   · 棋子承载全部信息；金色**只**用于获胜连线，别处一律不用。
 *   · 每一处坐标与权重都来自真实引擎，不做装饰性假数据。
 *   · 触屏两步落子（先幽灵后确认），桌面 hover 幽灵 + 单击。
 */
import {
  setupNav,
  startTimer, stopTimer, createTimer, fmtClock,
  toast,
} from '../game-core';
import { wireLobbyChrome } from '../../lobby-chrome';
import {
  emptyBoard, cloneBoard, SIZE, SIZE2, bestMove, hasFive, notation, xy,
  candidateMoves,
  type Board as GBoard, type Player as GPlayer, type Difficulty as GDifficulty,
} from './engine';

const SLOT = 600;                 // SVG viewBox 边长
const MARGIN = 22;                // 外留白（容纳外框 + 阴影）
const FRAME = 12;                 // 棋盘外框厚度
const LABEL = 26;                 // 坐标带到棋面的距离
const PAD = MARGIN + FRAME + LABEL;   // 60：网格起点，对称（600-2*60=480=15*32）
const CELL = (SLOT - 2 * PAD) / SIZE; // 32
const STONE_R = CELL * 0.42;
const COLS = 'ABCDEFGHIJKLMNO';

/* ─── DOM ─── */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const lobbyEl = $('go-lobby');
const matchEl = $('go-match');
const endEl = $('go-end');

const boardEl = $<HTMLDivElement>('bd-board');
const legendEl = $<HTMLDivElement>('go-legend');

const queueEl = $<HTMLDivElement>('go-queue');
const queueTitle = $<HTMLElement>('go-queue-title');
const queueSub = $<HTMLElement>('go-queue-sub');
const startRow = $<HTMLDivElement>('go-start-row');
const modesEl = $<HTMLDivElement>('go-modes');
const startBtn = $<HTMLButtonElement>('go-start');
const startNote = $<HTMLElement>('go-start-note');
const rankLabel = $<HTMLElement>('go-rank-label');
const rankWait = $<HTMLElement>('go-rank-wait');

const turnEl = $<HTMLElement>('go-turn');
const moveNoEl = $<HTMLElement>('go-moveno');
const lastEl = $<HTMLElement>('go-last');
const modeVEl = $<HTMLElement>('go-mode-v');

const clockMeWho = $<HTMLElement>('go-clock-me-who');
const clockMeTime = $<HTMLElement>('go-clock-me-time');
const clockOppWho = $<HTMLElement>('go-clock-opp-who');
const clockOppTime = $<HTMLElement>('go-clock-opp-time');
const clockMeCard = $<HTMLElement>('go-clock-me');
const clockOppCard = $<HTMLElement>('go-clock-opp');

const undoBtn = $<HTMLButtonElement>('go-undo');
const hintBtn = $<HTMLButtonElement>('go-hint');
const resignBtn = $<HTMLButtonElement>('go-resign');
const drawBtn = $<HTMLButtonElement>('go-draw');
const backLobbyBtn = $<HTMLButtonElement>('go-back-lobby');

const hintCard = $<HTMLDivElement>('go-hintcard');
const hintList = $<HTMLOListElement>('go-hint-list');
const hintClose = $<HTMLButtonElement>('go-hint-close');

const recList = $<HTMLOListElement>('go-recorder-list');
const recCount = $<HTMLElement>('go-rec-count');

const endVerdict = $<HTMLElement>('go-end-verdict');
const endLine = $<HTMLElement>('go-end-line');
const rematchBtn = $<HTMLButtonElement>('go-rematch');
const reviewBtn = $<HTMLButtonElement>('go-review');
const endLobbyBtn = $<HTMLButtonElement>('go-end-lobby');

const chatEl = $<HTMLDivElement>('go-chat');
const chatLog = $<HTMLUListElement>('go-chat-log');
const chatForm = $<HTMLFormElement>('go-chat-form');
const chatInput = $<HTMLInputElement>('go-chat-input');
const chatRoom = $<HTMLElement>('go-chat-room');

setupNav('gomoku');
wireLobbyChrome();

/* ══════════════════════════════════════════════════════════════
   状态
   ══════════════════════════════════════════════════════════════ */
type UIState = {
  screen: 'lobby' | 'match' | 'end';
  mode: 'ai' | 'pass' | 'ranked';
  level: GDifficulty;
  board: GBoard;
  turn: GPlayer;                 // 当前该谁走
  humanSide: GPlayer;            // 本地玩家执色（pass 模式随走子方变）
  lastMove: number;
  winLine: number[] | null;
  over: boolean;
  /** 每步快照：用于 Undo */
  history: { board: GBoard; turn: GPlayer; lastMove: number; moves: number[] }[];
  /** 完整落子序列（记谱器数据源） */
  moves: number[];
  timer: ReturnType<typeof createTimer>;
  /** 触屏两步落子：当前预览点 */
  ghost: number;
  reviewAt: number | null;       // 复盘回看位置（null = 看最新）
  ws: WebSocket | null;          // ranked 联机
  roomCode: string | null;
  myIdx: number | null;          // ranked: 0/1
  pollTimer: number | null;
  matchId: string | null;
  /** 收到过对局的 game_over（服务端终局），用于区分“我方认输”与“对手认输” */
  sawGameOver: boolean;
  clock: { w: number; b: number; side: 'w' | 'b' | null; base: number } | null;
};

const state: UIState = {
  screen: 'lobby',
  mode: 'ai',
  level: 'medium',
  board: emptyBoard() as GBoard,
  turn: 1,
  humanSide: 1,
  lastMove: -1,
  winLine: null,
  over: false,
  history: [],
  moves: [],
  timer: createTimer(),
  ghost: -1,
  reviewAt: null,
  ws: null,
  roomCode: null,
  myIdx: null,
  pollTimer: null,
  matchId: null,
  sawGameOver: false,
  clock: null,
};

const API = (() => {
  const w = window as unknown as { API_BASE?: string };
  if (w.API_BASE) return w.API_BASE;
  // 同源：boardduel.com 的 /api/* 由 worker 处理
  return '';
})();

/** 我的 UUID（沿用站点通用 pid cookie / Account 模块） */
function myUuid(): string {
  const m = document.cookie.match(/(?:^|;\s*)pid=([^;\s]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function myName(): string {
  return 'Player';
}

/* ─── 邀请深链 ───
   worker 的 /b/gomoku/<CODE> 会 302 到 /games/gomoku/?c=<CODE>。
   这里把 c 读出来直接进房间；带 vs=1 表示发起方（房主），
   不带则视为被邀请方 —— 两者都走同一个 enterRankedRoom，
   因为房间已经是匹配器建好的，双方只是先后连上同一间房。
   ?c= 只在首帧消费一次，消费后立刻从地址栏抹掉，
   以免刷新页面时重复入房或与“返回大厅”语义打架。 */
function inviteCode(): string {
  try {
    const c = new URLSearchParams(location.search).get('c');
    if (!c) return '';
    return /^[A-Za-z0-9]{5,8}$/.test(c) ? c.toUpperCase() : '';
  } catch (e) {
    return '';
  }
}
function inviteIsHost(): boolean {
  try {
    return new URLSearchParams(location.search).get('vs') === '1';
  } catch (e) {
    return false;
  }
}
/** 清掉 ?c= / ?vs=，保留其它查询参数（如语言） */
function clearInviteParam(): void {
  try {
    const u = new URL(location.href);
    u.searchParams.delete('c');
    u.searchParams.delete('vs');
    const q = u.searchParams.toString();
    history.replaceState(null, '', u.pathname + (q ? '?' + q : '') + u.hash);
  } catch (e) { /* 无 history 也要能玩 */ }
}

/* ══════════════════════════════════════════════════════════════
   坐标与记谱
   ══════════════════════════════════════════════════════════════ */
function cellXY(i: number): [number, number] {
  const [gx, gy] = xy(i);
  return [PAD + gx * CELL, PAD + gy * CELL];
}

/* ══════════════════════════════════════════════════════════════
   渲染
   ══════════════════════════════════════════════════════════════ */
function stoneColor(p: GPlayer): string {
  // 立体高光渐变（参考 papergames 棋子质感）：黑子亮顶 + 深底，白子暖白渐变
  return p === 1 ? 'url(#go-grad-b)' : 'url(#go-grad-w)';
}
function stoneStroke(p: GPlayer): string {
  return p === 1 ? 'var(--go-stone-stroke-b, #5C6B74)' : 'var(--go-stone-stroke-w, #8A99A3)';
}

function render(): void {
  // ── 网格 ──
  let lines = '';
  for (let r = 0; r < SIZE; r++) {
    const y = PAD + r * CELL;
    const edge = r === 0 || r === SIZE - 1;
    lines += `<line x1="${PAD}" y1="${y}" x2="${SLOT - PAD}" y2="${y}" stroke="var(--go-grid, #5C6B74)" stroke-width="${edge ? 2 : 1}" stroke-opacity="${edge ? 1 : 0.85}"/>`;
  }
  for (let c = 0; c < SIZE; c++) {
    const x = PAD + c * CELL;
    const edge = c === 0 || c === SIZE - 1;
    lines += `<line x1="${x}" y1="${PAD}" x2="${x}" y2="${SLOT - PAD}" stroke="var(--go-grid, #5C6B74)" stroke-width="${edge ? 2 : 1}" stroke-opacity="${edge ? 1 : 0.85}"/>`;
  }

  // ── 星位（15×15 天元 + 四角星）──
  const stars = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
  let starMarks = '';
  for (const [sx, sy] of stars) {
    starMarks += `<circle cx="${PAD + sx * CELL}" cy="${PAD + sy * CELL}" r="4.4" fill="var(--go-grid, #5C6B74)"/>`;
  }

  // ── 坐标尺：四面齐全（上/下 A–O、左/右 15→1），专业棋盘对称标注 ──
  let coords = '';
  const yTop = PAD - 13;            // 上侧字母（外框带内）
  const yBot = SLOT - PAD + 13;     // 下侧字母
  const xLeft = PAD - 14;           // 左侧数字
  const xRight = SLOT - PAD + 14;   // 右侧数字
  for (let c = 0; c < SIZE; c++) {
    const x = PAD + c * CELL;
    coords += `<text class="go-coord" x="${x}" y="${yTop}" text-anchor="middle">${COLS[c]}</text>`;
    coords += `<text class="go-coord" x="${x}" y="${yBot}" text-anchor="middle">${COLS[c]}</text>`;
  }
  for (let r = 0; r < SIZE; r++) {
    const y = PAD + r * CELL;
    const num = String(SIZE - r);   // 自下而上 1..15
    coords += `<text class="go-coord" x="${xLeft}" y="${y + 3.5}" text-anchor="end">${num}</text>`;
    coords += `<text class="go-coord" x="${xRight}" y="${y + 3.5}" text-anchor="start">${num}</text>`;
  }

  // ── 棋子 + 命中区 ──
  const board = state.board;
  const winSet = new Set(state.winLine || []);
  let stones = '';
  let hits = '';

  for (let i = 0; i < SIZE2; i++) {
    const [px, py] = cellXY(i);
    const p = board[i];
    if (p !== 0) {
      const isWin = winSet.has(i);
      const isLast = state.lastMove === i;
      stones += `<circle class="go-stone${isLast ? ' is-last' : ''}" cx="${px}" cy="${py}" r="${STONE_R}" fill="${stoneColor(p as GPlayer)}" stroke="${stoneStroke(p as GPlayer)}" stroke-width="0.6"/>`;
      if (isLast && !isWin) {
        // 传统记法：最后一手在棋子上点反色圆点（黑子白点 / 白子黑点）
        const dot = p === 1 ? '#F4F6F2' : '#1E1B39';
        stones += `<circle cx="${px}" cy="${py}" r="${STONE_R * 0.3}" fill="${dot}" fill-opacity=".9"/>`;
        // 琥珀细环标“最后一手”——独立元素，不占用 .go-stone 的落子投影
        stones += `<circle class="go-last-ring" cx="${px}" cy="${py}" r="${STONE_R + 2.5}" fill="none" stroke="var(--gold,#F2C14E)" stroke-width="2"/>`;
      }
      if (isWin) {
        // 金色环 —— 全站唯一使用 gold 之处
        stones += `<circle class="go-win-ring" cx="${px}" cy="${py}" r="${STONE_R + 3}" fill="none" stroke="var(--gold, #F2C14E)" stroke-width="2.4"/>`;
      }
    }
  }

  // 命中区 + 幽灵预览。
  // ⚠️ 命中区**不能**由 isMyTurn() 决定是否下发：
  //   轮不到你走时，若整片 .go-cell 都不渲染，对手侧就变成一张"死盘" ——
  //   没有 hover 幽灵、没有指针光标、连棋盘格子都不存在（实测第二人入房
  //   后 .go-cell 数从 225 掉到 0），既不像在等人，也无法在轮到自己的
  //   瞬间立刻落子。这里始终渲染命中区，把"能不能落"的判断收进 onCell()，
  //   视觉上用 .is-wait 表达"等着呢"。
  const canPlay = !state.over && state.reviewAt === null;
  const mine = isMyTurn();
  if (canPlay) {
    for (let i = 0; i < SIZE2; i++) {
      if (board[i] !== 0) continue;
      const [px, py] = cellXY(i);
      const isGhost = state.ghost === i;
      hits += `<g class="go-cell${isGhost ? ' is-ghost' : ''}${mine ? '' : ' is-wait'}" data-i="${i}">
        <rect x="${px - CELL / 2}" y="${py - CELL / 2}" width="${CELL}" height="${CELL}" fill="transparent"/>
      </g>`;
    }
    if (mine && state.ghost >= 0 && board[state.ghost] === 0) {
      const [gx2, gy2] = cellXY(state.ghost);
      stones += `<circle class="go-ghost" cx="${gx2}" cy="${gy2}" r="${STONE_R}" fill="none" stroke="var(--go-ghost, #8A99A3)" stroke-width="1.6" stroke-dasharray="4 4"/>`;
    }
  }

  // 棋子立体高光渐变（每帧重建，id 固定无副作用）
  const defs = `<defs>
    <radialGradient id="go-grad-b" cx="35%" cy="32%" r="78%">
      <stop offset="0%" stop-color="#454c57"/>
      <stop offset="55%" stop-color="#1b212a"/>
      <stop offset="100%" stop-color="#0B0F14"/>
    </radialGradient>
    <radialGradient id="go-grad-w" cx="35%" cy="32%" r="78%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="60%" stop-color="#eef1f5"/>
      <stop offset="100%" stop-color="#c7cdd6"/>
    </radialGradient>
  </defs>`;
  // 外围实框（木盘感）+ 棋面（白盘/暗盘），坐标尺落在框带内
  const frame = `<rect x="${MARGIN}" y="${MARGIN}" width="${SLOT - 2 * MARGIN}" height="${SLOT - 2 * MARGIN}" rx="14" fill="var(--go-frame,#E9EAF4)" stroke="var(--go-frame-edge,rgba(55,48,163,.18))" stroke-width="2"/>`
    + `<rect x="${PAD}" y="${PAD}" width="${SLOT - 2 * PAD}" height="${SLOT - 2 * PAD}" rx="6" fill="var(--go-board-bg,#151D24)"/>`;

  boardEl.innerHTML = `<svg viewBox="0 0 ${SLOT} ${SLOT}" role="img" aria-label="Gomoku board, 15 by 15">
    ${defs}${frame}
    ${lines}${starMarks}${coords}${stones}${hits}
  </svg>`;

  // 命中区事件用**委托**绑定到 svg 上，不逐节点挂 listener。
  // （旧写法在每个 .go-cell 上挂 mouseenter → render() → innerHTML 重建
  //    → 节点 detach → 鼠标事件再次触发，形成重建风暴，Playwright 点击
  //    会因"element was detached from the DOM"超时。）
  const svg = boardEl.querySelector('svg');
  if (svg && canPlay) {
    svg.addEventListener('click', (ev) => {
      const g = (ev.target as Element).closest?.('.go-cell') as SVGGElement | null;
      if (g) onCell(Number(g.dataset.i));
    });
    if (!isTouch()) {
      svg.addEventListener('mousemove', (ev) => {
        // 只有轮到自己时才跟手显示幽灵；等待中不画，免得误导
        if (!isMyTurn()) {
          if (state.ghost !== -1) { state.ghost = -1; render(); }
          return;
        }
        const g = (ev.target as Element).closest?.('.go-cell') as SVGGElement | null;
        const i = g ? Number(g.dataset.i) : -1;
        if (i !== state.ghost) { state.ghost = i; render(); }
      });
      svg.addEventListener('mouseleave', () => {
        if (state.ghost !== -1) { state.ghost = -1; render(); }
      });
    }
  }

  renderHud();
  renderRecorder();
}

/** 轮次提示文案（区分真人对手与引擎看门狗） */
function oppWaitHint(): string {
  return 'Not your turn — waiting for the opponent';
}

function isTouch(): boolean {
  return window.matchMedia('(hover: none)').matches;
}

function isMyTurn(): boolean {
  if (state.over) return false;
  if (state.mode === 'ai') return state.turn === 1;
  if (state.mode === 'pass') return true;
  // ranked：由服务端转发的走子方决定
  if (state.myIdx === null) return false;
  const mySide: GPlayer = state.myIdx === 0 ? 1 : 2;
  return state.turn === mySide;
}

function renderHud(): void {
  const label = state.mode === 'ai'
    ? (state.turn === 1 ? 'You · Black' : `Engine · White`)
    : state.mode === 'pass'
      ? (state.turn === 1 ? 'Black · P1' : 'White · P2')
      : (state.turn === 1 ? 'Black' : 'White');

  turnEl.textContent = state.over ? '— game over —' : label;
  turnEl.className = state.over ? '' : (isMyTurn() ? 'go-turn-you' : 'go-turn-opp');
  moveNoEl.textContent = String(state.moves.length + 1);
  lastEl.textContent = state.lastMove >= 0 ? notation(state.lastMove) : '—';

  const lvName = state.level === 'easy' ? 'Counter' : state.level === 'medium' ? 'Attacker' : 'Punisher';
  modeVEl.textContent = state.mode === 'ai'
    ? 'vs engine · ' + lvName
    : state.mode === 'pass' ? 'Pass & Play' : 'Ranked online';

  // 棋钟
  if (state.mode === 'ranked') {
    clockMeWho.textContent = 'YOU · ' + (state.myIdx === 0 ? 'BLACK' : 'WHITE');
    clockOppWho.textContent = 'OPPONENT · ' + (state.myIdx === 0 ? 'WHITE' : 'BLACK');
  } else if (state.mode === 'ai') {
    clockMeWho.textContent = 'YOU · BLACK';
    clockOppWho.textContent = 'ENGINE · WHITE';
  } else {
    clockMeWho.textContent = 'BLACK · P1';
    clockOppWho.textContent = 'WHITE · P2';
  }
  const myTurn = isMyTurn();
  clockMeCard.classList.toggle('is-active', !state.over && myTurn);
  clockOppCard.classList.toggle('is-active', !state.over && !myTurn);
}

function renderRecorder(): void {
  const mv = state.reviewAt === null ? state.moves : state.moves.slice(0, state.reviewAt + 1);
  let html = '';
  for (let k = 0; k < mv.length; k += 2) {
    const n = k / 2 + 1;
    const b = notation(mv[k]);
    const w = k + 1 < mv.length ? notation(mv[k + 1]) : '';
    const isCur = state.reviewAt !== null && (state.reviewAt === k || state.reviewAt === k + 1);
    html += `<li class="go-rec-row${isCur ? ' is-cur' : ''}">
      <span class="go-rec-n">${n}</span>
      <span class="go-rec-b">${b}</span>
      <span class="go-rec-w">${w}</span>
    </li>`;
  }
  recList.innerHTML = html;
  recCount.textContent = mv.length + (mv.length === 1 ? ' ply' : ' plies');
  // 只滚记谱器自身（容器内 scrollTop），不用 scrollIntoView ——
  // 部分移动端浏览器的 scrollIntoView 会连带滚动窗口，
  // 表现为"每落一子整页往下挪一点"（用户实测 BUG）。
  if (state.reviewAt === null) recList.scrollTop = recList.scrollHeight;
}

/* ══════════════════════════════════════════════════════════════
   落子
   ══════════════════════════════════════════════════════════════ */
function pushHistory(): void {
  state.history.push({
    board: cloneBoard(state.board),
    turn: state.turn,
    lastMove: state.lastMove,
    moves: state.moves.slice(),
  });
}

function onCell(i: number): void {
  if (state.over || state.board[i] !== 0 || state.reviewAt !== null) return;
  // 命中区现在是常驻的（见 render），所以"轮不到你"要在这里明确挡下，
  // 并给一句人话提示 —— 静默无响应会被当成卡死。
  if (!isMyTurn()) {
    if (!state.over) toast(oppWaitHint());
    return;
  }

  // 触屏两步落子：第一次只在本地显幽灵，第二次才真落
  if (isTouch() && state.ghost !== i) {
    state.ghost = i;
    legendEl.hidden = false;
    render();
    return;
  }
  state.ghost = -1;
  legendEl.hidden = true;

  pushHistory();
  placeLocal(i, state.turn);

  if (state.mode === 'ranked') {
    // 联机：只上报，等对手走子由 WS 推送
    sendWs({ type: 'move', i });
  }
  afterMove();
}

/** 本地落子（不切 turn） */
function placeLocal(i: number, p: GPlayer): void {
  state.board[i] = p;
  state.lastMove = i;
  state.moves.push(i);
}

function afterMove(): void {
  const r = hasFive(state.board);
  if (r.winner !== 0) {
    finish(r.winner as GPlayer, r.line);
    return;
  }
  if (state.moves.length >= SIZE2) {
    finishDraw();
    return;
  }
  if (state.turn === 1) state.turn = 2; else state.turn = 1;

  if (state.mode === 'ranked') {
    startClockTick();
    render();
    return;
  }

  render();

  if (state.mode === 'ai' && state.turn === 2) {
    startClockTick();
    aiMove();
  } else {
    startClockTick();
  }
}

function aiMove(): void {
  const t = setTimeout(() => {
    if (state.over || state.screen !== 'match') return;
    const m = bestMove(state.board, 2, state.level);
    if (m < 0) return;
    pushHistory();
    placeLocal(m, 2);
    afterMove();
  }, 220);
  void t;
}

function finish(winner: GPlayer, line: number[] | null): void {
  state.over = true;
  state.winLine = line;
  stopTimer(state.timer);
  state.board = cloneBoard(state.board);
  render();

  // 结果条：获胜连线命名（设计稿要求）
  const lineText = line ? line.map((i) => notation(i)).join(' – ') : '';
  let verdict: string;
  if (state.mode === 'ai') verdict = winner === 1 ? 'You win' : 'Engine wins';
  else if (state.mode === 'pass') verdict = winner === 1 ? 'Black wins' : 'White wins';
  else {
    const mySide: GPlayer = state.myIdx === 0 ? 1 : 2;
    verdict = winner === mySide ? 'You win' : 'You lose';
  }

  endVerdict.textContent = verdict;
  endVerdict.className = 'go-end-verdict ' + (verdict.includes('win') && !verdict.includes('lose') ? 'is-win' : 'is-loss');
  endLine.textContent = lineText || '—';
  showScreen('end');
  toast(verdict + (lineText ? ' · ' + lineText : ''));
}

function finishDraw(): void {
  state.over = true;
  stopTimer(state.timer);
  endVerdict.textContent = 'Draw';
  endVerdict.className = 'go-end-verdict';
  endLine.textContent = 'board full';
  showScreen('end');
  toast('Draw — board full');
}

/* ══════════════════════════════════════════════════════════════
   棋钟
   ══════════════════════════════════════════════════════════════ */
const CLOCK_BASE = 600; // 10:00
const clockTicker = { id: 0 as number, last: 0 };

function startClockTick(): void {
  if (clockTicker.id) { clockTicker.last = performance.now(); return; }
  clockTicker.last = performance.now();
  clockTicker.id = window.setInterval(() => {
    const now = performance.now();
    const dt = (now - clockTicker.last) / 1000;
    clockTicker.last = now;
    // 暂停态（复盘/终局/未开局）只推进 last，不扣时间
    if (state.over || state.reviewAt !== null || state.screen !== 'match') return;
    if (!state.clock || dt <= 0) return;
    if (isMyTurn()) state.clock.w = Math.max(0, state.clock.w - dt);
    else state.clock.b = Math.max(0, state.clock.b - dt);
    paintClock();
  }, 250);
}

function paintClock(): void {
  const c = state.clock;
  if (!c) { clockMeTime.textContent = '—'; clockOppTime.textContent = '—'; return; }
  const mySide: GPlayer = state.mode === 'ai' ? 1 : state.mode === 'pass' ? 1 : (state.myIdx === 0 ? 1 : 2);
  const mine = mySide === 1 ? c.w : c.b;
  const theirs = mySide === 1 ? c.b : c.w;
  clockMeTime.textContent = fmtClock(mine * 1000);
  clockOppTime.textContent = fmtClock(theirs * 1000);
}

function resetClock(): void {
  state.clock = { w: CLOCK_BASE, b: CLOCK_BASE, side: 'w', base: CLOCK_BASE };
  paintClock();
}

/* ══════════════════════════════════════════════════════════════
   提示板（真实引擎权重）
   ══════════════════════════════════════════════════════════════ */
function showHints(): void {
  if (state.over || state.reviewAt !== null) return;
  const me: GPlayer = state.turn;
  const opp: GPlayer = me === 1 ? 2 : 1;

  const cands = candidateMoves(state.board).slice(0, 60);
  const scored = cands.map((m) => {
    state.board[m] = me;
    const atk = rawPointScore(m, me);
    state.board[m] = opp;
    const def = rawPointScore(m, opp);
    state.board[m] = 0;
    return { m, atk, def, v: atk + def * 0.95 };
  }).sort((a, b) => b.v - a.v);

  const top = scored.slice(0, 3);
  const best = top[0] ? top[0].v : 1;

  hintList.innerHTML = top.map((t, k) => {
    const pct = Math.max(8, Math.round((t.v / best) * 100));
    return `<li class="go-hint-row">
      <span class="go-hint-rank">${k + 1}</span>
      <span class="go-hint-sq">${notation(t.m)}</span>
      <span class="go-hint-bar"><i style="width:${pct}%"></i></span>
      <span class="go-hint-w">${t.v.toLocaleString('en-US')}</span>
    </li>`;
  }).join('');

  hintCard.hidden = false;

  // 棋盘上高亮前 3 名
  highlightHints(top.map((t) => t.m));
  toast('Hint · best ' + notation(top[0].m) + ' (' + top[0].v.toLocaleString('en-US') + ')');
}

/**
 * 单点形态分（与引擎同口径）：沿四方向统计连子数 + 开放端。
 * 这里独立实现，避免把引擎内部函数暴露成公共 API。
 */
function rawPointScore(i: number, p: GPlayer): number {
  const b = state.board;
  const x = i % SIZE, y = Math.floor(i / SIZE);
  let s = 0;
  const dirs: [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dx, dy] of dirs) {
    let cnt = 1, open = 0;
    for (const sgn of [1, -1]) {
      let cx = x + dx * sgn, cy = y + dy * sgn;
      while (cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE && b[cy * SIZE + cx] === p) {
        cnt++; cx += dx * sgn; cy += dy * sgn;
      }
      if (cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE && b[cy * SIZE + cx] === 0) open++;
    }
    if (cnt >= 5) s += 1000000;
    else if (cnt === 4) s += open >= 2 ? 100000 : (open === 1 ? 15000 : 0);
    else if (cnt === 3) s += open >= 2 ? 8000 : (open === 1 ? 800 : 0);
    else if (cnt === 2) s += open >= 2 ? 400 : (open === 1 ? 60 : 0);
  }
  return s;
}

function highlightHints(list: number[]): void {
  const svg = boardEl.querySelector('svg');
  if (!svg) return;
  svg.querySelectorAll('.go-hintdot').forEach((n) => n.remove());
  for (const i of list) {
    const [px, py] = cellXY(i);
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('class', 'go-hintdot');
    c.setAttribute('cx', String(px));
    c.setAttribute('cy', String(py));
    c.setAttribute('r', '4');
    c.setAttribute('fill', 'var(--ember, #FF6A3C)');
    svg.appendChild(c);
  }
}

/* ══════════════════════════════════════════════════════════════
   Undo / Resign
   ══════════════════════════════════════════════════════════════ */
function undo(): void {
  if (state.mode === 'ranked') {
    sendWs({ type: 'takeback_request' });
    toast('Takeback requested');
    return;
  }
  if (state.over || state.history.length === 0) return;
  // AI 模式连退两步（回到自己回合）
  const steps = state.mode === 'ai' ? Math.min(2, state.history.length) : 1;
  for (let k = 0; k < steps; k++) {
    const h = state.history.pop();
    if (!h) break;
    state.board = h.board;
    state.turn = h.turn;
    state.lastMove = h.lastMove;
    state.moves = h.moves;
  }
  state.winLine = null;
  state.reviewAt = null;
  state.ghost = -1;
  render();
}

let resignArmed = false;
let resignTimer = 0;
function resign(): void {
  if (state.over) return;
  // 二次确认：papergames 同款，避免误触直接认输
  if (!resignArmed) {
    resignArmed = true;
    resignBtn.textContent = 'Confirm?';
    resignBtn.classList.add('is-confirm');
    resignTimer = window.setTimeout(() => {
      resignArmed = false;
      resignBtn.textContent = 'Resign';
      resignBtn.classList.remove('is-confirm');
    }, 2200);
    return;
  }
  clearTimeout(resignTimer);
  resignArmed = false;
  resignBtn.textContent = 'Resign';
  resignBtn.classList.remove('is-confirm');
  doResign();
}

function doResign(): void {
  if (state.over) return;
  if (state.mode === 'ranked') {
    // 先置位再发：服务端回 game_over 时要靠它区分“我方认输”
    state.sawGameOver = true;
    sendWs({ type: 'resign' });
    // 服务端不回也要给用户一个终局画面（不置 over，允许后续重开）
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      window.setTimeout(() => {
        if (state.over) return;
        state.over = true;
        stopTimer(state.timer);
        endVerdict.textContent = 'You resigned';
        endVerdict.className = 'go-end-verdict is-loss';
        endLine.textContent = 'by resignation';
        showScreen('end');
      }, 1500);
    }
    return;
  }
  state.sawGameOver = true;
  state.over = true;
  stopTimer(state.timer);
  const winner = state.mode === 'ai' ? 2 : (state.turn === 1 ? 2 : 1);
  endVerdict.textContent = 'Resigned';
  endVerdict.className = 'go-end-verdict is-loss';
  endLine.textContent = (state.mode === 'ai' ? 'You resigned' : (winner === 1 ? 'Black wins' : 'White wins'));
  showScreen('end');
  render();
}

/* 和棋（Draw）：同屏双人直接判和；联机发起提议；对 AI 无意义（按钮隐藏） */
function offerDraw(): void {
  if (state.over || state.reviewAt !== null) return;
  if (state.mode === 'engine') return;
  if (state.mode === 'pass') { finishDraw(); return; }
  toast('Draw proposed — waiting for opponent');
  try { sendWs({ type: 'draw' }); } catch (e) { /* 后端若不支持则静默 */ }
}

/* ══════════════════════════════════════════════════════════════
   屏幕切换
   ══════════════════════════════════════════════════════════════ */
function showScreen(s: UIState['screen']): void {
  state.screen = s;
  lobbyEl.hidden = s !== 'lobby';
  matchEl.hidden = s !== 'match';
  endEl.hidden = s !== 'end';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ══════════════════════════════════════════════════════════════
   新局
   ══════════════════════════════════════════════════════════════ */
function newGame(): void {
  state.board = emptyBoard() as GBoard;
  state.turn = 1;
  state.humanSide = 1;
  state.lastMove = -1;
  state.winLine = null;
  state.over = false;
  state.history = [];
  state.moves = [];
  state.ghost = -1;
  state.reviewAt = null;
  state.sawGameOver = false;
  state.myIdx = state.mode === 'ranked' ? state.myIdx : null;
  hintCard.hidden = true;
  legendEl.hidden = true;
  resetClock();
  clockTicker.last = performance.now();
  startTimer(state.timer, () => { /* 棋钟走 state.clock，这里不再重复计时 */ });
  // ⚠️ 必须在这里就启动棋钟：旧实现只在 afterMove() 里启动，
  //    导致新开局后第一手落子前棋钟是静止的（实测 10:00 不动）。
  startClockTick();
  // 对 AI 提和没有意义 —— 隐藏 Draw；其余模式（联机 / 同屏双人）显示
  drawBtn.hidden = state.mode === 'engine';
  showScreen('match');
  render();

  // AI 模式下黑方永远是本地玩家，白方是引擎；新局由黑先走，故 AI 不会即刻行动。
  // （保留显式分支以免未来改先手方时漏掉）
  if (state.mode === 'ai' && (state.turn as number) === 2) aiMove();
}

/* ══════════════════════════════════════════════════════════════
   排位匹配（/api/match/*）
   ══════════════════════════════════════════════════════════════ */
/** Ranked 入队态：模式网格让位、队列面板放大居中（否则玩家点了 Ranked 看不出页面有任何变化） */
function setQueuingUI(on: boolean): void {
  document.body.classList.toggle('is-queuing', on);
  modesEl.classList.toggle('is-queued', on);
}

async function joinQueue(): Promise<void> {
  queueEl.hidden = false;
  startRow.hidden = true;
  setQueuingUI(true);
  queueTitle.textContent = 'Finding opponent…';
  queueSub.textContent = 'In queue for Gomoku · 15×15';

  try {
    const r = await fetch(API + '/api/match/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ game: 'gomoku', name: myName() }),
    });
    const j = await r.json();
    if (j.status === 'matched') {
      enterRankedRoom(j.code, !!j.ai, j.aiName);
      return;
    }
    if (j.status === 'waiting') {
      state.matchId = j.matchId;
      pollQueue();
      return;
    }
    throw new Error('unexpected');
  } catch (e) {
    cancelQueue(true);
    toast('Matchmaking unavailable');
  }
}

function pollQueue(): void {
  const started = Date.now();
  const tick = async (): Promise<void> => {
    if (!state.matchId) return;
    if (Date.now() - started > 60000) { cancelQueue(true); toast('No opponent found'); return; }
    try {
      const r = await fetch(
        API + '/api/match/poll?matchId=' + encodeURIComponent(state.matchId) + '&game=gomoku',
        { credentials: 'include' }
      );
      const j = await r.json();
      if (j.status === 'matched') {
        enterRankedRoom(j.code, !!j.ai, j.aiName);
        return;
      }
      if (j.status === 'closed') { cancelQueue(true); toast('Queue closed'); return; }
      const secs = Math.round((Date.now() - started) / 1000);
      queueSub.textContent = 'Waiting… ' + secs + 's · AI fills in if nobody arrives';
    } catch (e) { /* 轮询容错，下一拍重试 */ }
    state.pollTimer = window.setTimeout(tick, 1200);
  };
  state.pollTimer = window.setTimeout(tick, 800);
}

function cancelQueue(silent = false): void {
  if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null; }
  if (state.matchId) {
    void fetch(API + '/api/match/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ game: 'gomoku', matchId: state.matchId }),
    }).catch(() => {});
    state.matchId = null;
  }
  queueEl.hidden = true;
  startRow.hidden = false;
  setQueuingUI(false);
  if (!silent) toast('Left the queue');
}

/* ══════════════════════════════════════════════════════════════
   联机房间（WS）
   ══════════════════════════════════════════════════════════════ */
function wsUrl(code: string, name: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`;
}

function enterRankedRoom(code: string, isAi: boolean, aiName?: string): void {
  if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null; }
  queueEl.hidden = true;
  startRow.hidden = false;
  setQueuingUI(false);
  state.roomCode = code;
  state.mode = 'ranked';
  chatEl.hidden = false;
  chatRoom.textContent = code;
  chatLog.innerHTML = '';
  toast((isAi ? 'Matched vs ' + (aiName || 'engine') : 'Opponent found') + ' · room ' + code);

  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl(code, myName()));
  } catch (e) {
    toast('Could not open room');
    return;
  }
  state.ws = ws;

  ws.addEventListener('open', () => {
    chatRoom.textContent = code + ' · live';
  });
  ws.addEventListener('message', (ev) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    handleWs(msg);
  });
  ws.addEventListener('close', () => {
    chatRoom.textContent = code + ' · offline';
    if (state.screen === 'match' && !state.over) toast('Connection lost');
  });
  ws.addEventListener('error', () => { toast('Room unavailable'); });
}

function sendWs(obj: Record<string, unknown>): void {
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
}

function handleWs(msg: Record<string, unknown>): void {
  const t = String(msg.type || '');
  if (t === 'state') {
    // state 有两种形状：{you,code,game,roomStatus,players} 与 {state:{...}}。
    // wrapper 形不含 you，不能把老的 state.myIdx 冲成 undefined，
    // 否则“该谁走”的判断会整体失效。
    const inner = (msg.state && typeof msg.state === 'object')
      ? (msg.state as Record<string, unknown>)
      : null;
    if (typeof msg.you === 'number') state.myIdx = msg.you;
    else if (inner && typeof inner.you === 'number') state.myIdx = inner.you;
    const code = typeof msg.code === 'string' ? msg.code
      : (inner && typeof inner.code === 'string' ? inner.code : '');
    if (code && state.roomCode !== code) {
      state.roomCode = code;
      chatRoom.textContent = code;
    }
    if (!state.over) newGame();
    return;
  }
  if (t === 'start') {
    if (!state.over) newGame();
    return;
  }
  if (t === 'opponent_move') {
    const i = pickMoveIndex(msg);
    if (i >= 0 && state.board[i] === 0) {
      pushHistory();
      placeLocal(i, state.turn);
      afterMove();
    }
    return;
  }
  if (t === 'move_ack') {
    // 自己那步已被服务端确认；若带 clock 则同步
    if (msg.clock) syncClock(msg.clock as Record<string, number>);
    return;
  }
  if (t === 'chat') {
    addChat(String(msg.name || '—'), String(msg.text || ''), !!msg.emoji);
    return;
  }
  if (t === 'game_over') {
    // 双向 game_over：既是“我认输”的回显，也是“对手认输/终局”的通知。
    // 区分依据是本地是否已置 sawGameOver —— 自己认输时 resign() 会先置位。
    state.over = true;
    stopTimer(state.timer);
    const kind = String(msg.kind || 'resign');
    const iLost = !!msg.you_lost || (state.sawGameOver && kind !== 'draw');
    if (kind === 'draw') {
      endVerdict.textContent = 'Draw';
      endVerdict.className = 'go-end-verdict is-draw';
      endLine.textContent = 'agreed';
    } else if (iLost) {
      endVerdict.textContent = 'You resigned';
      endVerdict.className = 'go-end-verdict is-loss';
      endLine.textContent = 'by resignation';
    } else {
      endVerdict.textContent = 'Opponent resigned';
      endVerdict.className = 'go-end-verdict is-win';
      endLine.textContent = 'by resignation';
    }
    showScreen('end');
    return;
  }
  if (t === 'resign') {
    // 兼容只发 resign 的旧帧：这一侧一定是“对手认输”
    state.over = true;
    stopTimer(state.timer);
    endVerdict.textContent = 'Opponent resigned';
    endVerdict.className = 'go-end-verdict is-win';
    endLine.textContent = 'by resignation';
    showScreen('end');
    return;
  }
  if (t === 'takeback_request') { toast('Opponent asks to take back'); return; }
  if (t === 'takeback_done') {
    if (state.history.length) {
      const h = state.history.pop()!;
      state.board = h.board; state.turn = h.turn; state.lastMove = h.lastMove; state.moves = h.moves;
      render();
    }
    toast('Takeback accepted');
    return;
  }
  if (t === 'restart_notify') { if (!state.over) newGame(); return; }
  if (t === 'opponent_leave') { toast('Opponent left'); return; }
  if (t === 'error') { toast(String(msg.message || 'Room error')); return; }
}

function pickMoveIndex(msg: Record<string, unknown>): number {
  if (typeof msg.i === 'number') return msg.i;
  if (typeof msg.c === 'number' && typeof msg.r === 'number') return (msg.r as number) * SIZE + (msg.c as number);
  if (typeof msg.mv === 'number') return msg.mv;
  return -1;
}

function syncClock(c: Record<string, number>): void {
  if (!state.clock) return;
  if (typeof c.w === 'number') state.clock.w = c.w;
  if (typeof c.b === 'number') state.clock.b = c.b;
  paintClock();
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
  chatEl.hidden = true;
}

/* ══════════════════════════════════════════════════════════════
   事件绑定
   ══════════════════════════════════════════════════════════════ */
/** 引擎三档的展示名（与卡片、结算文案共用一份，避免各处硬编码走样） */
const LEVEL_LABEL: Record<GDifficulty, string> = {
  easy: 'Counter',
  medium: 'Attacker',
  hard: 'Punisher',
};

/** 点卡片 = 选模式 + 直接行动（与 lobby 模式页一致：点卡即玩，不留"没反应"的中间态）。
 *  深链的合成点击（pickModeCard 的 card.click()，isTrusted=false）只做选中，
 *  由 applyDeepLink 自己调 joinQueue/newGame，避免双触发。 */
document.querySelectorAll<HTMLButtonElement>('.go-mode[data-mode]').forEach((b) => {
  b.addEventListener('click', (ev) => {
    const m = b.dataset.mode as UIState['mode'];
    document.querySelectorAll('.go-mode').forEach((x) => x.classList.remove('is-cur'));
    b.classList.add('is-cur');
    state.mode = m;
    if (b.dataset.level) state.level = b.dataset.level as GDifficulty;
    if (m === 'ranked') {
      startBtn.textContent = 'Enter queue';
      startNote.textContent = 'A real opponent, roughly your level.';
    } else if (m === 'ai') {
      startBtn.textContent = 'Start game';
      startNote.textContent = `Black moves first — you are Black, engine plays ${LEVEL_LABEL[state.level]}.`;
    } else {
      startBtn.textContent = 'Start game';
      startNote.textContent = 'Black moves first, then white, same screen.';
    }
    if (ev.isTrusted) {
      if (m === 'ranked') { void joinQueue(); return; }
      newGame();
    }
  });
});

startBtn.addEventListener('click', () => {
  if (state.mode === 'ranked') { void joinQueue(); return; }
  newGame();
});
$('go-queue-cancel').addEventListener('click', () => cancelQueue(false));

undoBtn.addEventListener('click', undo);
hintBtn.addEventListener('click', showHints);
resignBtn.addEventListener('click', resign);
drawBtn.addEventListener('click', offerDraw);
hintClose.addEventListener('click', () => {
  hintCard.hidden = true;
  boardEl.querySelectorAll('.go-hintdot').forEach((n) => n.remove());
});
backLobbyBtn.addEventListener('click', () => { leaveRoom(); showScreen('lobby'); });

rematchBtn.addEventListener('click', () => {
  if (state.mode === 'ranked') { sendWs({ type: 'restart' }); state.over = false; newGame(); return; }
  newGame();
});
reviewBtn.addEventListener('click', () => {
  // 复盘：回到最后一手可见的棋盘
  showScreen('match');
  state.reviewAt = state.moves.length - 1;
  render();
  toast('Reviewing — press Hint or Undo to continue');
});
endLobbyBtn.addEventListener('click', () => { leaveRoom(); showScreen('lobby'); });

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  sendWs({ type: 'chat', text });
  chatInput.value = '';
});

// 键盘：Esc 回大厅
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.screen === 'match') {
    if (state.mode === 'ranked') { leaveRoom(); }
    showScreen('lobby');
  }
});

/* ══════════════════════════════════════════════════════════════
   启动
   ══════════════════════════════════════════════════════════════ */
/* ─── 模式深链 ───
   与 24 点同款两段式：/games/gomoku/lobby/ 选模式 → /games/gomoku/?mode=… 直接开局。
     ?mode=ranked           → 进页面即入队（省掉一次点击）
     ?mode=engine&level=…   → 直接开局，难度取 easy|medium|hard（缺省 medium）
     ?mode=pass             → 直接开同屏双人
   未知 mode 一律 replace 回模式页 —— 否则会停在一个「什么模式都没选」的半空大厅，
   玩家以为页面坏了。 */
const MODE_PAGE = '/games/gomoku/lobby/';

function pickModeCard(sel: string): boolean {
  const card = document.querySelector<HTMLButtonElement>(sel);
  if (!card) return false;
  card.click(); // 复用卡片自身的点击逻辑，选中态与 Start 文案一并就位
  return true;
}

function applyDeepLink(): void {
  const q = new URLSearchParams(location.search);
  const raw = (q.get('mode') || '').toLowerCase();
  if (!raw) return;

  if (raw === 'ranked') {
    pickModeCard('.go-mode[data-mode="ranked"]');
    void joinQueue();
    return;
  }
  if (raw === 'pass') {
    if (pickModeCard('.go-mode[data-mode="pass"]')) newGame();
    return;
  }
  if (raw === 'engine' || raw === 'ai') {
    const lv = (q.get('level') || '').toLowerCase();
    const level: GDifficulty = lv === 'easy' || lv === 'hard' ? lv : 'medium';
    if (pickModeCard(`.go-mode[data-level="${level}"]`)) newGame();
    return;
  }
  location.replace(MODE_PAGE);
}

(function init(): void {
  // 裸访问 /games/gomoku/（不带 ?mode= / ?c=）一律回模式选择页：
  // 模式选择已由 lobby 两段式负责，这里只保留深链战场，杜绝"又一个选择页"的干扰。
  {
    const q = new URLSearchParams(location.search);
    if (!q.get('mode') && !q.get('c')) {
      location.replace(MODE_PAGE);
      return;
    }
  }

  // 段位显示：用账号资料（有则显示，无则用默认文案，不编造数字）
  void (async () => {
    try {
      const r = await fetch(API + '/api/account/me', { credentials: 'include' });
      const j = await r.json();
      if (j && j.loggedIn && j.nickname) {
        rankLabel.textContent = String(j.nickname);
        rankWait.textContent = 'rating kept';
      } else {
        rankLabel.textContent = 'Guest';
        rankWait.textContent = 'unrated';
      }
    } catch (e) { /* 离线也要能玩 */ }
  })();

  // 默认停在引擎 · Attacker（原「Play the engine」的中间档）
  state.mode = 'ai';
  state.level = 'medium';
  document.querySelector('.go-mode[data-level="medium"]')?.classList.add('is-cur');
  if (myUuid()) rankWait.textContent = 'ranked queue live';

  resetClock();
  render();

  // ── 深链优先级：?c= 邀请房 > ?mode= 模式 ──
  //   邀请是点对点的具体房间，比「选个模式」更明确，所以先消费它。
  //   两者都必须放在 render() 之后：此时棋盘已画好，进房/开局能立刻接管。
  const code = inviteCode();
  if (code) {
    const host = inviteIsHost();
    state.mode = 'ranked';
    clearInviteParam();
    enterRankedRoom(code, false);
    toast(host
      ? 'Room ' + code + ' created — waiting for your opponent'
      : 'Joining room ' + code);
  } else {
    applyDeepLink();
  }
})();
