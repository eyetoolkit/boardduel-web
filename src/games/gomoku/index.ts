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
// M2（2026-10-01）：教师端房间码归因（?tid=1 + ?c= 同时存在 → classroom）
import { isClassroom, reportRound, ensureStudentCode, urlRoomCode } from '../../shared/teacher-track';
// 2026-10-03：落子音效（WebAudio 合成，跨页记住开关）
import { playSfx, sfxOn, setSfx, unlockSfx } from '../../shared/sfx';
// 2026-10-05：持久随机昵称（防止匿名玩家同名被服务端分进同一座位）
import { myName as ocMyName, isMoveRejected } from '../online-core';
// 2026-10-06：好友房邀请卡片（全屏遮罩弹窗，范式抄 MathDuel 24-game share-overlay）
import { mountInviteCard, showInviteCard, onOpponentJoined } from '../invite-card';
import '../../styles/invite-card.css';

const SLOT = 600;                 // SVG viewBox 边长
const MARGIN = 4;                 // 外留白（仅容纳外框描边 + 阴影，尽量贴边）
const FRAME = 6;                  // 棋盘外框厚度
const LABEL = 14;                 // 坐标带到棋面的距离
const PAD = MARGIN + FRAME + LABEL;   // 24：网格起点，四边对称；落子区占 SVG ~92%（贴容器）
const CELL = (SLOT - 2 * PAD) / (SIZE - 1); // 34.29：15 条线 = 14 格（线上落子），网格恰好铺满 PAD..SLOT-PAD，四边对称闭合
const STONE_R = CELL * 0.42;
const COLS = 'ABCDEFGHIJKLMNO';

/* ─── DOM ─── */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const matchEl = $('go-match');
const endEl = $('go-end');

const boardEl = $<HTMLDivElement>('bd-board');
const legendEl = $<HTMLDivElement>('go-legend');

const queueEl = $<HTMLDivElement>('go-queue');
const queueTitle = $<HTMLElement>('go-queue-title');
const queueSub = $<HTMLElement>('go-queue-sub');

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
const levelBtn = $<HTMLButtonElement>('go-level');
const levelCard = $<HTMLDivElement>('go-levelcard');
const levelClose = $<HTMLButtonElement>('go-level-close');
const replayBtn = $<HTMLButtonElement>('go-replay');
const soundBtn = $<HTMLButtonElement>('go-sound');

const leaveCard = $<HTMLDivElement>('go-leavecard');
// 悔棋应答（2026-10-06）：此前对手请求悔棋时只弹一句 toast，他没有任何回应的入口
const takebackCard = $<HTMLDivElement>('go-takebackcard');
const takebackYes = $<HTMLButtonElement>('go-takeback-yes');
const takebackNo = $<HTMLButtonElement>('go-takeback-no');
const takebackClose = $<HTMLButtonElement>('go-takeback-close');

/** 关掉悔棋应答弹层（不发送任何消息——× 与拒绝一样都算 decline） */
function closeTakebackCard(): void {
  takebackCard.hidden = true;
}
takebackYes.addEventListener('click', () => { closeTakebackCard(); sendWs({ type: 'takeback_accept' }); });
takebackNo.addEventListener('click', () => { closeTakebackCard(); sendWs({ type: 'takeback_decline' }); toast('Takeback declined'); });
takebackClose.addEventListener('click', closeTakebackCard);
takebackCard.addEventListener('click', (e) => { if (e.target === takebackCard) closeTakebackCard(); });
const rpBar = $<HTMLDivElement>('go-replaybar');
const rpPlay = $<HTMLButtonElement>('go-rp-play');
const rpRange = $<HTMLInputElement>('go-rp-range');
const rpPos = $<HTMLElement>('go-rp-pos');

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
const chatToggleBtn = $<HTMLButtonElement>('go-chat-toggle');
const chatLog = $<HTMLUListElement>('go-chat-log');
const chatForm = $<HTMLFormElement>('go-chat-form');
const chatInput = $<HTMLInputElement>('go-chat-input');
const chatRoom = $<HTMLElement>('go-chat-room');
// 2026-10-06：邀请面板改为全屏遮罩弹窗卡片（原 .go-invite 侧栏内联，
// 移动端 .bd-side 是 display:contents → 被摊平，扫码图铺在棋盘下方）。
// 范式抄 MathDuel 24-game 的 .share-overlay。
const inviteCard = mountInviteCard('go', 'gomoku', 'Gomoku · 15×15');
const inviteEl = $<HTMLElement>('go-invite');
const inviteCopyBtn = $<HTMLButtonElement>('go-invite-copy');
void inviteCard; // 卡片已挂载（幂等），此处仅持引用防止 tree-shake 掉挂载调用

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
  /** 对手已进房（2026-10-06）：false 时棋盘锁定、棋钟不走、对手侧显示「等待中」 */
  roomLive: boolean;
  /** 对手昵称，服务端 start/state 广播带来 */
  oppName: string | null;
  myIdx: number | null;          // ranked: 0/1
  pollTimer: number | null;
  matchId: string | null;
  /** 收到过对局的 game_over（服务端终局），用于区分“我方认输”与“对手认输” */
  sawGameOver: boolean;
  /** 引擎正在思考（延迟落子期间）—— 用于轮次行显示"思考中"并挡住玩家点击 */
  aiThinking: boolean;
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
  roomLive: false,
  oppName: null,
  myIdx: null,
  pollTimer: null,
  matchId: null,
  sawGameOver: false,
  aiThinking: false,
  clock: null,
};

const API = (() => {
  const w = window as unknown as { API_BASE?: string };
  if (w.API_BASE) return w.API_BASE;
  // 同源：boardduel.com 的 /api/* 由 worker 处理
  return '';
})();

function myName(): string {
  // 共享联机模块的持久随机昵称（防止匿名玩家同名撞座，详见 online-core.myName）
  return ocMyName();
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
    const q = new URLSearchParams(location.search);
    // 兼容多种邀请参数名：?c=（本团长链，worker 302 落地）/
    // ?room= / ?code=（第三方或手写的房间链接，评测报告 P0-2 实测被丢弃）
    const c = q.get('c') || q.get('room') || q.get('code');
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

/**
 * 回放视图：把"第 n 手时的盘面"算出来。
 *
 * 棋谱回放的成本极低，正是因为棋盘游戏的状态完全由落子序列决定 ——
 * 存一份 moves[]（每手一个 0..224 的整数，合计几十字节）就能还原任意
 * 时刻的盘面，不需要录屏、不需要服务器、不看网络。这里只在前端重放：
 *   board[moves[k]] = k 为偶数 ? 黑 : 白
 *（黑先手，逐手交替，与 placeLocal 的落子顺序一致）。
 *
 * reviewAt === null 表示"看最新"，直接返回实时盘面。
 */
function viewBoard(): { board: GBoard; last: number; win: number[] | null } {
  if (state.reviewAt === null) {
    return { board: state.board, last: state.lastMove, win: state.winLine };
  }
  const b = emptyBoard() as GBoard;
  const upto = Math.min(state.reviewAt, state.moves.length - 1);
  for (let k = 0; k <= upto; k++) {
    b[state.moves[k]] = (k % 2 === 0 ? 1 : 2) as GPlayer;
  }
  const atEnd = upto >= 0 && upto === state.moves.length - 1;
  return {
    board: b,
    last: upto >= 0 ? state.moves[upto] : -1,
    // 金环只在"看到最后一手且已终局"时出现 —— 中途回放不该提前剧透
    win: atEnd ? state.winLine : null,
  };
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
  const yTop = PAD - 8;             // 上侧字母（外框带内，贴近网格）
  const yBot = SLOT - PAD + 8;      // 下侧字母
  const xLeft = PAD - 9;            // 左侧数字
  const xRight = SLOT - PAD + 9;    // 右侧数字
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
  // ⚠️ 棋盘内容取决于"看到第几手"：复盘时用 moves 重放出那一刻的盘面，
  //    而不是直接用 state.board（那是最新盘面，回放会一动不动）。
  const view = viewBoard();
  const board = view.board;
  const winSet = new Set(view.win || []);
  let stones = '';
  let hits = '';

  for (let i = 0; i < SIZE2; i++) {
    const [px, py] = cellXY(i);
    const p = board[i];
    if (p !== 0) {
      const isWin = winSet.has(i);
      const isLast = view.last === i;
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
  const frame = `<rect x="${MARGIN}" y="${MARGIN}" width="${SLOT - 2 * MARGIN}" height="${SLOT - 2 * MARGIN}" rx="10" fill="var(--go-frame,#E9EAF4)" stroke="var(--go-frame-edge,rgba(55,48,163,.18))" stroke-width="1.5"/>`
    + `<rect x="${PAD - 4}" y="${PAD - 4}" width="${SLOT - 2 * PAD + 8}" height="${SLOT - 2 * PAD + 8}" rx="5" fill="var(--go-board-bg,#151D24)"/>`;

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
  if (state.mode === 'ai' && state.aiThinking) return 'Engine is thinking…';
  return 'Not your turn — waiting for the opponent';
}

function isTouch(): boolean {
  return window.matchMedia('(hover: none)').matches;
}

/** 吸收服务端房间状态（state / start），驱动等待态与启钟。
 *  gomoku 的 WS 是本文件自建的（enterRankedRoom），不走 online-core.enterRoom，
 *  所以这里按同样的约定就地解析。 */
function applyRoomState(msg: Record<string, unknown>, viaStart: boolean): void {
  if (state.mode !== 'ranked') return;
  const inner = (msg.state && typeof msg.state === 'object') ? msg.state as Record<string, unknown> : null;
  const status = String((inner?.roomStatus ?? msg.roomStatus) as string || '');
  const live = viaStart || status === 'playing';
  const wasLive = state.roomLive;
  state.roomLive = live;
  const players = (inner?.players ?? msg.players) as { idx?: number; name?: string }[] | undefined;
  if (Array.isArray(players) && players.length >= 2) {
    const other = players.find((p) => p && p.idx !== state.myIdx);
    if (other?.name) state.oppName = other.name;
  }
  if (live && !wasLive) startClockTick();
  render();
}

function isMyTurn(): boolean {
  if (state.over) return false;
  if (state.mode === 'ai') return state.turn === 1;
  if (state.mode === 'pass') return true;
  // ranked：由服务端转发的走子方决定
  if (state.myIdx === null) return false;
  // 2026-10-06：对手没进房时棋盘锁定。否则本地走了、服务端拒、
  // 'start' 一来又被清盘，玩家看到「子凭空消失」（与 go 的 rankedLive 同义）。
  if (!state.roomLive) return false;
  const mySide: GPlayer = state.myIdx === 0 ? 1 : 2;
  return state.turn === mySide;
}

function renderHud(): void {
  // 回放态：轮次行改成"第几手 / 共几手"，棋钟保持冻结（startClockTick 已跳过）
  if (state.reviewAt !== null) {
    const n = Math.min(state.reviewAt, Math.max(0, state.moves.length - 1));
    turnEl.textContent = window.t('bg.bg_gomoku_replay');
    turnEl.className = 'go-turn-you';
    moveNoEl.textContent = String(n + 1);
    lastEl.textContent = state.moves.length ? notation(state.moves[n]) : '—';
    return;
  }

  // 引擎思考中：轮次行改显示"Engine · Thinking…"
  // （390px 下 "Engine · White · Thinking…" 会截断 —— STATE 记录过同款坑，
  //   所以思考态里省略执色，只留 Engine + 状态）
  const thinking = !state.over && state.aiThinking;
  const label = state.mode === 'ai'
    ? (state.turn === 1 ? 'You · Black' : (thinking ? `Engine · ${window.t('status.thinking')}` : 'Engine · White'))
    : state.mode === 'pass'
      ? (state.turn === 1 ? 'Black · P1' : 'White · P2')
      : (state.turn === 1 ? 'Black' : 'White');

  turnEl.textContent = state.over ? window.t('bi.game_over') : label;
  turnEl.className = state.over
    ? ''
    : (isMyTurn() ? 'go-turn-you' : 'go-turn-opp') + (thinking ? ' is-thinking' : '');
  moveNoEl.textContent = String(state.moves.length + 1);
  lastEl.textContent = state.lastMove >= 0 ? notation(state.lastMove) : '—';

  const lvName = state.level === 'easy' ? 'Counter' : state.level === 'medium' ? 'Attacker' : 'Punisher';
  modeVEl.textContent = state.mode === 'ai'
    ? 'vs engine · ' + lvName
    : state.mode === 'pass' ? 'Pass & Play' : 'Ranked online';

  // 棋钟
  if (state.mode === 'ranked') {
    clockMeWho.textContent = (state.myIdx === 0 ? window.t('bj.you_black') : window.t('bj.you_white'));
    // 2026-10-06：没进房显示「等待中」，进房后显示真实昵称（服务端 start 带 players）
    clockOppWho.textContent = state.roomLive && state.oppName
      ? state.oppName
      : window.t('bg.bg_common_waiting_opponent');
  } else if (state.mode === 'ai') {
    clockMeWho.textContent = window.t('bj.you_black');
    clockOppWho.textContent = window.t('bj.engine_white');
  } else {
    clockMeWho.textContent = window.t('bj.black_p1');
    clockOppWho.textContent = window.t('bj.white_p2');
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
    // data-p = 该格对应的全局手数下标（点击即可跳到那一手）
    html += `<li class="go-rec-row${isCur ? ' is-cur' : ''}">
      <span class="go-rec-n">${n}</span>
      <span class="go-rec-b" data-p="${k}" role="button" tabindex="-1">${b}</span>
      <span class="go-rec-w"${w ? ` data-p="${k + 1}" role="button" tabindex="-1"` : ''}>${w}</span>
    </li>`;
  }
  recList.innerHTML = html;
  recCount.textContent = mv.length + (mv.length === 1 ? window.t('bj.ply_one') : window.t('bj.ply_many'));
  // 只滚记谱器自身（容器内 scrollTop），不用 scrollIntoView ——
  // 部分移动端浏览器的 scrollIntoView 会连带滚动窗口，
  // 表现为"每落一子整页往下挪一点"（用户实测 BUG）。
  if (state.reviewAt === null) {
    recList.scrollTop = recList.scrollHeight;
  } else {
    // 回放：把当前手滚进可视区（同样只动容器 scrollTop）
    const row = Math.floor(Math.min(state.reviewAt, mv.length - 1) / 2);
    const el = recList.children[row] as HTMLElement | undefined;
    if (el) recList.scrollTop = Math.max(0, el.offsetTop - recList.clientHeight / 2 + el.offsetHeight / 2);
  }
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

  // 触屏两步落子：第一次只在本地显幽灵，第二次才真落。
  // 桌面鼠标（pointerType==='mouse'）单击即提交，不走预选 —— P1-3（评测实测桌面也要求双击）
  if (isTouch() && state.ghost !== i && lastPointerType !== 'mouse') {
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
  // 落子音效：无论是自己下、引擎下还是联机对手下，都走这一个出口
  playSfx('place');
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

/* ------------------------------------------------------------------
   引擎落子节奏（2026-10-03 用户反馈：玩家刚落完子 AI 就落，两次落子音
   几乎重叠，听感像"一次响两下"）
   原实现固定 220ms —— 短于落子音本身的时长，必然重叠。
   现在按难度给不同的"思考时长"，并叠 ±12% 抖动（每手都卡同一个间隔
   会像节拍器，机械感很重）。难度越高想得越久，也更符合直觉。
   ------------------------------------------------------------------ */
const AI_THINK_MS: Record<GDifficulty, number> = { easy: 520, medium: 660, hard: 820 };
/** 开局（引擎先手）再多给一点，让玩家先看清空盘 */
const AI_OPENING_EXTRA_MS = 260;
let aiTimer = 0;

/** 取消挂起的引擎落子（悔棋 / 新局 / 进回放 / 退出对局时都要调） */
function cancelAiMove(): void {
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = 0; }
  state.aiThinking = false;
}

function aiMove(extraMs = 0): void {
  if (aiTimer) clearTimeout(aiTimer);
  // 先把"思考中"画出来（同步 render 会在本次任务结束后上屏，
  // 随后才轮到下面的定时器计算，所以这个状态是看得见的）
  state.aiThinking = true;
  render();
  const base = AI_THINK_MS[state.level] ?? AI_THINK_MS.medium;
  const jitter = Math.round(base * (Math.random() * 0.24 - 0.12));
  aiTimer = window.setTimeout(() => {
    aiTimer = 0;
    state.aiThinking = false;
    // 期间可能已经终局 / 离开对局 / 进回放 / 被悔棋 —— 一律不再落子
    if (state.over || state.screen !== 'match' || state.reviewAt !== null || state.turn !== 2) {
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

  // M2（2026-10-01）：仅 classroom 邀请房间上报 track（不污染 PvP）
  if (state.mode === 'ranked' && isClassroom() && state.roomCode) {
    const dur = state.timer ? Date.now() - state.timer.startedAt : 0;
    reportRound(state.roomCode, {
      round: 1,
      solved: verdict.includes('win') && !verdict.includes('lose'),
      duration_ms: dur,
      outcome: verdict.includes('win') && !verdict.includes('lose') ? 'win' : 'loss',
    });
  }

  endVerdict.textContent = verdict;
  endVerdict.className = 'go-end-verdict ' + (verdict.includes('win') && !verdict.includes('lose') ? 'is-win' : 'is-loss');
  endLine.textContent = lineText || '—';
  // 2026-10-06：把本局数据留给「分享结果」卡片（终局时快照，避免之后被悔棋改写）
  lastResult = {
    youWin: verdict.includes('win') && !verdict.includes('lose'),
    moves: state.moves.length,
    durationSec: state.timer ? Math.max(1, Math.round((Date.now() - state.timer.startedAt) / 1000)) : 0,
    mode: state.mode,
  };
  playSfx(verdict.includes('win') && !verdict.includes('lose') ? 'win' : 'lose');
  // 不再瞬间跳结算：先看 1.5s 胜局盘面（获胜连线高亮），再自动进结算页
  scheduleEndScreen();
  toast(verdict + (lineText ? ' · ' + lineText : ''));
}

/** 上一局的战果（终局时快照），供 share-card 取用 */
let lastResult: { youWin: boolean; moves: number; durationSec: number; mode: string } | null = null;

/** 终局后先停在棋盘上 1.5s，让玩家看清最后一手和获胜连线，再进结算页
 *  （此前 AI 落完最后一子瞬间跳结算，最后一手根本看不到 —— 用户反馈）。
 *  期间若玩家主动离开对局/进入回放，则不再跳。 */
let endScreenTimer = 0;
function scheduleEndScreen(): void {
  if (endScreenTimer) window.clearTimeout(endScreenTimer);
  endScreenTimer = window.setTimeout(() => {
    endScreenTimer = 0;
    if (state.over && state.screen === 'match' && state.reviewAt === null) showScreen('end');
  }, 1500);
}

function finishDraw(): void {
  state.over = true;
  stopTimer(state.timer);
  endVerdict.textContent = window.t('bi.draw');
  endVerdict.className = 'go-end-verdict';
  endLine.textContent = window.t('bi.board_full');
  scheduleEndScreen();
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
  // 引擎还在想的那一步必须撤掉，否则悔棋后它会突然落下来
  cancelAiMove();
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
        endVerdict.textContent = window.t('bj.you_resigned');
        endVerdict.className = 'go-end-verdict is-loss';
        endLine.textContent = window.t('bj.by_resignation');
        showScreen('end');
      }, 1500);
    }
    return;
  }
  state.sawGameOver = true;
  state.over = true;
  stopTimer(state.timer);
  const winner = state.mode === 'ai' ? 2 : (state.turn === 1 ? 2 : 1);
  endVerdict.textContent = window.t('bj.resigned');
  endVerdict.className = 'go-end-verdict is-loss';
  endLine.textContent = (state.mode === 'ai' ? window.t('bj.you_resigned') : (winner === 1 ? window.t('bi.black_wins') : window.t('bi.white_wins')));
  showScreen('end');
  render();
}

/* 和棋（Draw）：同屏双人直接判和；联机发起提议；对 AI 无意义（按钮隐藏） */
function offerDraw(): void {
  if (state.over || state.reviewAt !== null) return;
  if (state.mode === 'ai') return;
  if (state.mode === 'pass') { finishDraw(); return; }
  toast('Draw proposed — waiting for opponent');
  // 服务端只认 draw_offer/draw_accept/draw_decline（games-room.js:332-345），
  // 原来发的 {type:'draw'} 没有任何处理器 → 这一帧被静默丢弃：
  // 提和方永远等不到回应，对手也压根不知道有人提和。
  try { sendWs({ type: 'draw_offer' }); } catch (e) { /* ignore */ }
}

/* ══════════════════════════════════════════════════════════════
   棋谱回放（2026-10-03）
   ------------------------------------------------------------
   棋类回放天然便宜：盘面 = 落子序列的纯函数，所以只要 moves[] 在，
   任意一手都能 O(n) 重放出来（n ≤ 225），不录屏、不上服务器、不占带宽。
   这里提供：首/上一手/播放暂停/下一手/末 + 拖动轴 + 记谱器点格跳转。
   ══════════════════════════════════════════════════════════════ */
const REPLAY_MS = 700;                 // 自动播放每手间隔
let replayPlaying = false;
let replayTimer = 0;

/** 收拾回放态（不改屏幕）：新局、回大厅、认输重开都要调它 */
function resetReplayUI(): void {
  replayPlaying = false;
  if (replayTimer) { clearTimeout(replayTimer); replayTimer = 0; }
  state.reviewAt = null;
  rpBar.hidden = true;
  document.body.classList.remove('bd-replay');
}

function enterReplay(): void {
  if (!state.moves.length) { toast(window.t('bg.bg_gomoku_no_moves')); return; }
  // 回放只演已发生的历史：引擎待落的那一步要撤掉，否则播到一半盘面会跳变
  cancelAiMove();
  // 终局浮层/大厅都要让位：回放就在对局屏上看棋盘
  if (state.screen !== 'match') showScreen('match');
  state.reviewAt = 0;
  rpBar.hidden = false;
  document.body.classList.add('bd-replay');
  syncReplayBar();
  render();
  // 点"回放"就是想看过程 —— 直接从头播，播完自动停
  startReplay();
}

function exitReplay(): void {
  resetReplayUI();
  if (state.over) showScreen('end'); else showScreen('match');
  render();
}

/** 同步回放条：拖动轴范围 / 位置文本 / 播放键图标 */
function syncReplayBar(): void {
  const total = state.moves.length;
  const at = state.reviewAt === null ? total - 1 : state.reviewAt;
  rpRange.max = String(Math.max(0, total - 1));
  rpRange.value = String(Math.max(0, at));
  rpPos.textContent = (at + 1) + ' / ' + total;
  rpPlay.classList.toggle('is-playing', replayPlaying);
  rpPlay.setAttribute('aria-label', window.t(replayPlaying ? 'bg.bg_gomoku_rp_pause' : 'bg.bg_gomoku_rp_play'));
}

function seek(n: number): void {
  if (state.reviewAt === null) return;
  const max = state.moves.length - 1;
  state.reviewAt = Math.max(0, Math.min(max, n));
  syncReplayBar();
  render();
}

function stopReplay(): void {
  replayPlaying = false;
  if (replayTimer) { clearTimeout(replayTimer); replayTimer = 0; }
  syncReplayBar();
}

function startReplay(): void {
  if (state.reviewAt === null) return;
  const max = state.moves.length - 1;
  // 已在末尾 → 从头重播（连点播放键不会"没反应"）
  if (state.reviewAt >= max) { state.reviewAt = 0; syncReplayBar(); render(); }
  replayPlaying = true;
  syncReplayBar();
  const step = (): void => {
    if (!replayPlaying) return;
    const nxt = (state.reviewAt ?? 0) + 1;
    if (nxt > max) { stopReplay(); return; }
    seek(nxt);
    playSfx('place');
    replayTimer = window.setTimeout(step, REPLAY_MS);
  };
  replayTimer = window.setTimeout(step, REPLAY_MS);
}

/* ══════════════════════════════════════════════════════════════
   退出二次确认（2026-10-03）
   ------------------------------------------------------------
   手机从屏幕边缘侧滑 = 浏览器"后退"，会直接把整页退回上一页、对局丢失；
   Android 实体/手势返回键同理。这里用历史栈把它拦下来：
     进入对局 → pushState 压一个占位条目；
     用户侧滑 → popstate 触发 → 立刻 pushState 把条目补回去（URL 不变、页面不退）
                → 弹确认框；
     点"继续下"→ 只关框，盘面原样；
     点"离开"  → 放行（真正 back 一次）+ 回大厅。
   终局（end）与大厅不拦：那时没有"未下完的棋"可丢。
   ══════════════════════════════════════════════════════════════ */
let backGuard = false;      // 占位条目是否已压
let backLeaving = false;    // 用户已确认离开 → 放行这一次的 popstate
let pendingLobbyNav = false; // 放行后要把当前条目替换成模式大厅页

function armBackGuard(): void {
  if (backGuard) return;
  try { history.pushState({ bdMatch: 1 }, ''); backGuard = true; } catch (e) { /* history 不可用则放弃拦截 */ }
}

window.addEventListener('popstate', () => {
  if (backLeaving) {
    // 已确认离开：这次 popstate 消费掉占位条目，URL 回到对局页本身；
    // 顺势把对局页这条历史也替换成模式大厅页 —— 回大厅后按"后退"不会再掉回对局。
    backLeaving = false;
    if (pendingLobbyNav) {
      pendingLobbyNav = false;
      location.replace(MODE_PAGE);
    }
    return;
  }
  if (state.screen !== 'match') return;    // 终局 / 排队外：不需要拦
  // 把被 pop 掉的占位条目补回来，页面留在原地
  try { history.pushState({ bdMatch: 1 }, ''); backGuard = true; } catch (e) { /* noop */ }
  leaveCard.hidden = false;
});

function stayInGame(): void {
  leaveCard.hidden = true;
}

/**
 * 统一的"退出对局回大厅"出口：底栏返回键、终局页返回键、Esc、
 * 以及退出确认框的"离开"都走这里。旧内嵌大厅已删除 —— 回大厅 = 真跳转模式页；
 * 占位历史条目顺势消费并把当前条目替换成大厅页，后退不会掉回对局。
 */
function exitMatchToLobby(): void {
  leaveCard.hidden = true;
  cancelAiMove();
  resetReplayUI();
  abortQueue(true);
  leaveRoom();
  if (backGuard) {
    backLeaving = true;      // 让这一次 popstate 放行
    backGuard = false;
    pendingLobbyNav = true;  // popstate 放行后 replace 成模式大厅页
    try { history.back(); } catch (e) { location.replace(MODE_PAGE); }
    // 兜底：若 back() 没有触发 popstate（没有上一页），600ms 后直接走
    setTimeout(() => {
      if (pendingLobbyNav) { pendingLobbyNav = false; backLeaving = false; location.replace(MODE_PAGE); }
    }, 600);
  } else {
    location.replace(MODE_PAGE);
  }
}

$('go-leave-close').addEventListener('click', stayInGame);
$('go-leave-stay').addEventListener('click', stayInGame);
$('go-leave-yes').addEventListener('click', exitMatchToLobby);

/* ══════════════════════════════════════════════════════════════
   屏幕切换
   ══════════════════════════════════════════════════════════════ */
function showScreen(s: UIState['screen']): void {
  state.screen = s;
  // 旧内嵌 lobby 屏已删除：'lobby' 只作为"不在对局"的状态值保留，无对应 DOM
  matchEl.hidden = s !== 'match';
  endEl.hidden = s !== 'end';
  // 移动端沉浸对局：match/end 两屏锁定视口（CSS 只在 <900px 生效，桌面不受影响）
  document.body.classList.toggle('bd-in-match', s !== 'lobby');
  // 进对局才武装"侧滑退出"守卫；回大厅/终局时不拦（没有未下完的棋可丢）
  if (s === 'match') armBackGuard();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ══════════════════════════════════════════════════════════════
   新局
   ══════════════════════════════════════════════════════════════ */
function newGame(): void {
  // 上一局挂起的引擎落子不能带进新局（否则新盘上会凭空多一子）
  cancelAiMove();
  state.board = emptyBoard() as GBoard;
  state.turn = 1;
  state.humanSide = 1;
  state.lastMove = -1;
  state.winLine = null;
  state.over = false;
  state.history = [];
  state.moves = [];
  state.ghost = -1;
  state.sawGameOver = false;
  // 新局脱离回放态（否则会带着上一局的 reviewAt 进新棋盘）
  resetReplayUI();
  state.myIdx = state.mode === 'ranked' ? state.myIdx : null;
  hintCard.hidden = true;
  legendEl.hidden = true;
  resetClock();
  clockTicker.last = performance.now();
  startTimer(state.timer, () => { /* 棋钟走 state.clock，这里不再重复计时 */ });
  // ⚠️ 必须在这里就启动棋钟：旧实现只在 afterMove() 里启动，
  //    导致新开局后第一手落子前棋钟是静止的（实测 10:00 不动）。
  // 2026-10-06 例外：ranked 模式对手没进房时不启钟，由 applyRoomState 在
  //    收到 start 后再启动（行业通行：等对手期间不计时）。
  if (state.mode !== 'ranked' || state.roomLive) startClockTick();
  // 对 AI 提和没有意义 —— 隐藏 Draw；其余模式（联机 / 同屏双人）显示
  drawBtn.hidden = state.mode === 'ai';
  // 难度键只属于 AI 对局（ranked / pass 换档无意义），离场时顺带收起浮层
  levelBtn.hidden = state.mode !== 'ai';
  if (state.mode !== 'ai') levelCard.hidden = true;
  showScreen('match');
  render();

  // AI 模式下黑方永远是本地玩家，白方是引擎；新局由黑先走，故 AI 不会即刻行动。
  // （保留显式分支以免未来改先手方时漏掉）
  if (state.mode === 'ai' && (state.turn as number) === 2) aiMove(AI_OPENING_EXTRA_MS);
}

/* ══════════════════════════════════════════════════════════════
   排位匹配（/api/match/*）
   ══════════════════════════════════════════════════════════════ */
/** Ranked 入队态：body.is-queuing（队列面板现在是对局页上的全屏遮罩） */
function setQueuingUI(on: boolean): void {
  document.body.classList.toggle('is-queuing', on);
}

async function joinQueue(): Promise<void> {
  queueEl.hidden = false;
  setQueuingUI(true);
  // 直接在对局页空盘上等匹配（旧内嵌大厅已删除）——匹配成功后棋子直接落在眼前
  showScreen('match');
  render();
  queueTitle.textContent = window.t('bj.finding_opponent');
  queueSub.textContent = window.t('bj.in_queue');

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
    toast('Matchmaking unavailable');
    cancelQueue(true);   // 取消即回模式选择页
  }
}

function pollQueue(): void {
  const started = Date.now();
  const tick = async (): Promise<void> => {
    if (!state.matchId) return;
    if (Date.now() - started > 60000) { toast('No opponent found'); cancelQueue(true); return; }
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
      if (j.status === 'closed') { toast('Queue closed'); cancelQueue(true); return; }
      const secs = Math.round((Date.now() - started) / 1000);
      queueSub.textContent = window.t('bj.waiting') + secs + window.t('bj.waiting_ai_fallback');
    } catch (e) { /* 轮询容错，下一拍重试 */ }
    state.pollTimer = window.setTimeout(tick, 1200);
  };
  state.pollTimer = window.setTimeout(tick, 800);
}

/** 纯清理：停轮询 + 撤匹配单 + 收起队列遮罩（不导航，退出对局时用） */
function abortQueue(silent = false): void {
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
  setQueuingUI(false);
  if (!silent) toast('Left the queue');
}

/** 玩家主动取消排队：清理后回模式选择页（旧内嵌大厅已删，没有别的地方可回） */
function cancelQueue(silent = false): void {
  abortQueue(silent);
  location.replace(MODE_PAGE);
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
  setQueuingUI(false);
  state.roomCode = code;
  state.mode = 'ranked';
  chatEl.hidden = false;
  chatToggleBtn.hidden = false;
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
    chatRoom.textContent = code + window.t('bj.chat_live');
  });
  ws.addEventListener('message', (ev) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    handleWs(msg);
  });
  ws.addEventListener('close', () => {
    chatRoom.textContent = code + window.t('bj.chat_offline');
    if (state.screen === 'match' && !state.over) toast('Connection lost');
  });
  ws.addEventListener('error', () => { toast('Room unavailable'); });
}

/* ─── 好友房：建房 → 拿码 → 以房主身份进房 ───
   房号必须由后端 /api/gp/room 生成：/ws 只认 KV 里已存在的房间，
   前端自造码会被 worker 拒掉。短链 /b/gomoku/<CODE> 由 worker 302 到 ?c=<CODE>。
   2026-10-06：改为弹全屏邀请卡片（房码 + 短链 + 二维码）。 */

function showInvite(code: string): void {
  // 兼容旧 DOM（若有）：同步隐藏侧栏内联面板，避免与卡片重复显示
  if (inviteEl) inviteEl.hidden = true;
  showInviteCard('go', 'gomoku', code);
}

inviteCopyBtn?.addEventListener('click', () => {
  // 卡片自带复制按钮；此处仅为旧 DOM 兜底
  const code = state.roomCode || '';
  const link = location.origin + '/b/gomoku/' + code;
  try {
    void navigator.clipboard.writeText(link).then(
      () => toast('Invite link copied'),
      () => toast('Copy failed — code ' + code),
    );
  } catch (e) {
    toast('Copy failed — code ' + code);
  }
});

async function startFriendRoom(): Promise<void> {
  // 直接在对局页空盘上等朋友进房（旧内嵌大厅已删除）
  showScreen('match');
  render();
  const fail = () => {
    toast('Could not open a friend room');
    window.setTimeout(() => location.replace(MODE_PAGE), 900);
  };
  try {
    const r = await fetch(API + '/api/gp/room?name=' + encodeURIComponent(myName()) + '&game=gomoku', { credentials: 'include' });
    const j = (await r.json()) as { ok?: boolean; code?: string };
    const code = String((j && j.code) || '').toUpperCase();
    if (!r.ok || !/^[A-Z2-9]{6}$/.test(code)) { fail(); return; }
    // 复用联机全链路：进自己的房间（state.mode 由 enterRankedRoom 置为 ranked）
    enterRankedRoom(code, false);
    showInvite(code);
  } catch (e) {
    fail();
  }
}

function sendWs(obj: Record<string, unknown>): void {
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
}

/** 联机再战回声闸：armed=true 表示本方刚发过 restart，等着吞掉自己那份 restart_notify */
let restartEchoArmed = false;

/**
 * 服务端拒了刚落的那一子 → 回到落子之前。
 * 之前只弹了 toast，棋盘留着那一步：自己看得见子、对手那边没有，
 * 而且 isMyTurn 之后永远为 false —— 一手错棋把整局锁死。
 */
function rollbackRejected(): void {
  const h = state.history.pop();
  if (h) {
    state.board = h.board;
    state.turn = h.turn;
    state.lastMove = h.lastMove;
    state.moves = h.moves.slice();
  }
  state.over = false;
  state.winLine = null;
  state.sawGameOver = false;
  cancelAiMove();
  render();
  toast(window.t('bg.bg_common_move_rejected'));
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
    applyRoomState(msg, false);
    return;
  }
  if (t === 'start') {
    // 2026-10-06：对手进房 → 邀请卡片自动收起（延迟 9s，给对方扫码留时间）
    onOpponentJoined('go');
    if (!state.over) newGame();
    applyRoomState(msg, true);
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
    // 🔴 服务端 settleAndBroadcast 发的是 { winner: 座位号|'draw', reason }
    //   （games-room.js:783 / :807-816），既没有 you_lost 也没有 kind。
    //   旧代码 String(msg.kind || 'resign') 永远拿到 'resign'，于是
    //   · 对手离开（reason='opponent_left'）被显示成「对手认输」
    //   · 超时判负（reason='timeout'）被显示成「胜利」—— 正好说反
    //   改为按 go 的口径：用 winner 对比 myIdx 判胜负，用 reason 判文案。
    state.over = true;
    state.sawGameOver = true;
    stopTimer(state.timer);
    const reason = String(msg.reason || 'resign');
    const w = msg.winner;
    if (w === 'draw') {
      endVerdict.textContent = window.t('bi.draw');
      endVerdict.className = 'go-end-verdict is-draw';
      endLine.textContent = window.t('bj.draw_agreed');
    } else {
      const iLost = (typeof w === 'number' && state.myIdx !== null)
        ? w !== state.myIdx
        : (state.sawGameOver && reason !== 'draw');
      if (reason === 'opponent_left') {
        endVerdict.textContent = iLost ? window.t('bj.you_resigned') : window.t('bj.opp_left');
        endLine.textContent = window.t('bj.opp_left');
      } else if (reason === 'timeout') {
        endVerdict.textContent = iLost ? window.t('bj.by_resignation') : window.t('bj.opp_resigned');
        endLine.textContent = window.t('bj.by_resignation');
      } else if (iLost) {
        endVerdict.textContent = window.t('bj.you_resigned');
        endLine.textContent = window.t('bj.by_resignation');
      } else {
        endVerdict.textContent = window.t('bj.opp_resigned');
        endLine.textContent = window.t('bj.by_resignation');
      }
      endVerdict.className = 'go-end-verdict ' + (iLost ? 'is-loss' : 'is-win');
    }
    showScreen('end');
    return;
  }
  if (t === 'resign') {
    // 兼容只发 resign 的旧帧：这一侧一定是“对手认输”
    state.over = true;
    stopTimer(state.timer);
    endVerdict.textContent = window.t('bj.opp_resigned');
    endVerdict.className = 'go-end-verdict is-win';
    endLine.textContent = window.t('bj.by_resignation');
    showScreen('end');
    return;
  }
  // 对手请求悔棋：给出可应答的弹层，不再只是弹一句 toast（对方此前无从回应）
  if (t === 'takeback_request') { takebackCard.hidden = false; return; }
  if (t === 'takeback_declined') { closeTakebackCard(); toast('Takeback declined'); return; }
  if (t === 'takeback_done') {
    if (state.history.length) {
      const h = state.history.pop()!;
      state.board = h.board; state.turn = h.turn; state.lastMove = h.lastMove; state.moves = h.moves;
      render();
    }
    toast('Takeback accepted');
    return;
  }
  // gomoku 自带 WS、不走 online-core 的 sendWs，再战回声闸得自己上闩。
  // 服务端 restart 无差别广播，发起方也会收到自己那份；不吞的话回声会把
  // 往返窗口内刚落下的一子擦掉（原来的 if (!state.over) 也拦不住——
  // rematch 上一行刚把 over 置回 false）。
  if (t === 'restart_notify') {
    if (restartEchoArmed) { restartEchoArmed = false; return; }
    if (!state.over) newGame();
    return;
  }
  // 对手离开后必须锁盘。不锁的话 roomLive 还是 true、点子照样「落」在本地，
  // 而 sendWs 投不出去 —— 宽限期内留下一堆对手永远看不到的幽灵子，
  // 服务端回的是 对方未连接 / 对局未开始（在 NON_MOVE_ERRORS 里，不会触发回滚）。
  if (t === 'opponent_leave') {
    state.roomLive = false;
    toast('Opponent left');
    render();
    return;
  }
  if (t === 'error') { if (isMoveRejected(msg)) rollbackRejected(); toast(String(msg.message || 'Room error')); return; }
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
  chatEl.classList.remove('is-open');
  chatToggleBtn.hidden = true;
}

/* 事件绑定区之前的小工具：移动端聊天浮层开关（桌面端按钮被 CSS 隐藏，此监听不触发） */
chatToggleBtn.addEventListener('click', () => {
  const open = chatEl.classList.toggle('is-open');
  chatToggleBtn.setAttribute('aria-expanded', String(open));
});

/* ══════════════════════════════════════════════════════════════
   事件绑定
   ══════════════════════════════════════════════════════════════ */
/** 引擎三档的展示名（与卡片、结算文案共用一份，避免各处硬编码走样） */
const LEVEL_LABEL: Record<GDifficulty, string> = {
  easy: 'Counter',
  medium: 'Attacker',
  hard: 'Punisher',
};

/* ─── 难度选择（仅 AI 模式）：切换即用新难度重开一局 ─── */
levelBtn.addEventListener('click', () => {
  levelCard.hidden = false;
  levelCard.querySelectorAll('.go-level-opt').forEach((b) => {
    b.classList.toggle('is-cur', (b as HTMLElement).dataset.level === state.level);
  });
});
levelClose.addEventListener('click', () => { levelCard.hidden = true; });
// 点遮罩空白处同样关闭（点面板本身不关）
levelCard.addEventListener('click', (e) => { if (e.target === levelCard) levelCard.hidden = true; });
document.querySelectorAll<HTMLButtonElement>('.go-level-opt').forEach((b) => {
  b.addEventListener('click', () => {
    const lv = b.dataset.level as GDifficulty;
    levelCard.hidden = true;
    if (state.mode !== 'ai' || lv === state.level) return;
    state.level = lv;
    toast(window.t('bg.bg_gomoku_level_switched', { level: LEVEL_LABEL[lv] }));
    newGame();
  });
});

/* ─── 声音开关：图标随状态切换，选择写 localStorage（跨页/跨局记住） ─── */
function paintSoundBtn(): void {
  const on = sfxOn();
  soundBtn.classList.toggle('is-off', !on);
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.setAttribute('aria-label', window.t(on ? 'bg.bg_gomoku_sound_on' : 'bg.bg_gomoku_sound_off'));
}
soundBtn.addEventListener('click', () => {
  const on = !sfxOn();
  setSfx(on);
  paintSoundBtn();
  // 打开时立刻给一声，让"开了/关了"可听可见（也是首次手势解锁 AudioContext 的时机）
  if (on) playSfx('place');
});

/* 真实手势里解锁/保活音频：iOS Safari / 微信内置浏览器不解锁就静音。
   🔴 不能 once —— iOS 锁屏/切后台/来电中断后会把 AudioContext 重新挂起，
   必须在之后的每次触摸里重新 resume，否则"声音时有时无"。
   unlockSfx 幂等且开销极小（多数时候只是一次 state 判断），常驻无害。 */
// capture 阶段 + passive，确保在最早的一次触摸/点击上执行。
// pointerdown/touchstart/mousedown 三种都挂：老款 Android / 微信 X5 内核
// 不一定派发 pointer events，漏挂就等于漏解锁（表现为"没声音"）。 */
const keepAudioAlive = (): void => unlockSfx();
document.addEventListener('pointerdown', keepAudioAlive, { capture: true, passive: true });
// 记录最近一次指针类型，用于 P1-3：桌面鼠标单击即落子（不走触屏预选）
let lastPointerType: string = 'mouse';
document.addEventListener('pointerdown', (e) => {
  lastPointerType = (e as PointerEvent).pointerType || 'mouse';
}, { passive: true });
document.addEventListener('touchstart', keepAudioAlive, { capture: true, passive: true });
document.addEventListener('mousedown', keepAudioAlive, { capture: true });
// 回前台也试着拉一把（Android Chrome 上 resume 无需手势，能救回切后台的场景）
document.addEventListener('visibilitychange', keepAudioAlive);

/* ─── 回放条 ─── */
replayBtn.addEventListener('click', enterReplay);
$('go-rp-first').addEventListener('click', () => { stopReplay(); seek(0); });
$('go-rp-prev').addEventListener('click', () => { stopReplay(); seek((state.reviewAt ?? 0) - 1); });
$('go-rp-next').addEventListener('click', () => { stopReplay(); seek((state.reviewAt ?? 0) + 1); });
$('go-rp-last').addEventListener('click', () => { stopReplay(); seek(state.moves.length - 1); });
rpPlay.addEventListener('click', () => { replayPlaying ? stopReplay() : startReplay(); });
rpRange.addEventListener('input', () => {
  // ⚠️ 必须先取值再 stopReplay()：stopReplay → syncReplayBar 会把 value 写回
  //    当前手数，若先停再读，读到的就是旧位置，拖动表现为"弹回去"（实测 BUG）。
  const v = Number(rpRange.value);
  stopReplay();
  seek(v);
});
$('go-rp-exit').addEventListener('click', exitReplay);
// 记谱器点格跳转（data-p = 全局手数下标）
recList.addEventListener('click', (e) => {
  const cell = (e.target as HTMLElement).closest?.('[data-p]') as HTMLElement | null;
  if (!cell || cell.dataset.p === undefined) return;
  if (state.reviewAt === null) enterReplay();   // 不在回放态 → 先进回放再跳
  stopReplay();
  seek(Number(cell.dataset.p));
});

/* 模式选择卡片已随旧内嵌大厅删除：入口统一在 /games/gomoku/lobby/（纯链接跳转），
   游戏页只消费 ?mode= / ?c= 深链。 */
$('go-queue-cancel').addEventListener('click', () => cancelQueue(false));

undoBtn.addEventListener('click', undo);
hintBtn.addEventListener('click', showHints);
resignBtn.addEventListener('click', resign);
drawBtn.addEventListener('click', offerDraw);
hintClose.addEventListener('click', () => {
  hintCard.hidden = true;
  boardEl.querySelectorAll('.go-hintdot').forEach((n) => n.remove());
});
backLobbyBtn.addEventListener('click', exitMatchToLobby);

rematchBtn.addEventListener('click', () => {
  if (state.mode === 'ranked') { restartEchoArmed = true; sendWs({ type: 'restart' }); state.over = false; newGame(); return; }
  newGame();
});
/* "Review moves" = 进入完整棋谱回放（从头自动播放，可暂停/拖动/逐手） */
reviewBtn.addEventListener('click', enterReplay);
endLobbyBtn.addEventListener('click', exitMatchToLobby);

/* 2026-10-06：分享结果 → Canvas 大图卡片（MathDuel 范式，可保存 PNG / 系统分享） */
$<HTMLButtonElement>('go-share')?.addEventListener('click', async () => {
  if (!lastResult) { toast('Finish a game first'); return; }
  const m = await import('../share-card');
  const link = state.roomCode
    ? location.origin + '/b/gomoku/' + state.roomCode
    : location.origin + '/games/gomoku/';
  m.shareResult('Gomoku · 15×15', {
    youWin: lastResult.youWin,
    moves: lastResult.moves,
    durationSec: lastResult.durationSec,
    link,
    qrGame: state.roomCode ? 'gomoku' : undefined,
    tone: lastResult.youWin ? 'wood' : 'indigo',
  });
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  sendWs({ type: 'chat', text });
  chatInput.value = '';
});

// 键盘：回放中 ←/→ 逐手、空格播放/暂停、Esc 退出回放（不在回放态则回大厅）
document.addEventListener('keydown', (e) => {
  if (state.reviewAt !== null) {
    if (e.key === 'ArrowLeft') { stopReplay(); seek((state.reviewAt ?? 0) - 1); return; }
    if (e.key === 'ArrowRight') { stopReplay(); seek((state.reviewAt ?? 0) + 1); return; }
    if (e.key === ' ') { e.preventDefault(); replayPlaying ? stopReplay() : startReplay(); return; }
    if (e.key === 'Escape') { exitReplay(); return; }
  }
  if (e.key === 'Escape' && state.screen === 'match') {
    exitMatchToLobby();
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

function applyDeepLink(): void {
  const q = new URLSearchParams(location.search);
  const raw = (q.get('mode') || '').toLowerCase();
  if (!raw) return;

  if (raw === 'friend') {
    void startFriendRoom();
    return;
  }
  if (raw === 'ranked') {
    state.mode = 'ranked';
    void joinQueue();
    return;
  }
  if (raw === 'pass') {
    state.mode = 'pass';
    newGame();
    return;
  }
  if (raw === 'engine' || raw === 'ai') {
    const lv = (q.get('level') || '').toLowerCase();
    state.mode = 'ai';
    state.level = lv === 'easy' || lv === 'hard' ? lv : 'medium';   // 白名单，防注入
    newGame();
    return;
  }
  location.replace(MODE_PAGE);
}

// 残留2（2026-10-05）：字典异步到位后重绘 HUD——否则 bj.you_black 等
// 以 key 名泄漏在棋钟/轮次行上且不再更新（Vela 回归实测）。
window.addEventListener('i18n:change', () => { try { renderHud(); } catch (e) { /* noop */ } });

(function init(): void {
  // 裸访问 /games/gomoku/（不带 ?mode= / ?c= / ?room= / ?code=）一律回模式选择页：
  // 模式选择已由 lobby 两段式负责，这里只保留深链战场，杜绝"又一个选择页"的干扰。
  // 2026-10-05 残留1修复：?room=/?code= 是合法邀请参数（inviteCode() 兼容），
  // 此前被这里直接弹回大厅 —— 第三方/手写房间链接全部失效（Vela 回归实测）。
  {
    const q = new URLSearchParams(location.search);
    if (!q.get('mode') && !q.get('c') && !q.get('room') && !q.get('code')) {
      location.replace(MODE_PAGE);
      return;
    }
  }

  // 默认档位（深链会覆盖；排位/邀请流程由各自入口置 mode）
  state.mode = 'ai';
  state.level = 'medium';

  resetClock();
  paintSoundBtn();   // 声音开关按 localStorage 里的选择就位（缺省开）
  render();

  // ── 深链优先级：?c= 邀请房 > ?mode= 模式 ──
  //   邀请是点对点的具体房间，比「选个模式」更明确，所以先消费它。
  //   两者都必须放在 render() 之后：此时棋盘已画好，进房/开局能立刻接管。
  const code = inviteCode();
  if (code) {
    const host = inviteIsHost();
    state.mode = 'ranked';
    clearInviteParam();
    // 旧内嵌大厅已删：进邀请房直接亮对局页空盘等对手（不再回选择页干等）
    showScreen('match');
    render();
    // M2（2026-10-01）：classroom 邀请链接（?tid=1）先弹代号输入，落 localStorage 后 reportRound 自动取
    const classroomHook = isClassroom() && urlRoomCode() === code
      ? ensureStudentCode(code)
      : Promise.resolve(null);
    (classroomHook || Promise.resolve()).then(() => {
      enterRankedRoom(code, false);
      toast(host
        ? 'Room ' + code + ' created — waiting for your opponent'
        : 'Joining room ' + code);
    });
  } else {
    applyDeepLink();
  }
})();
