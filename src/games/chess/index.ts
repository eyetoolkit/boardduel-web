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
  initialState, cloneState, legalMoves, applyMove, bestMove, inCheck,
  type GameState as CS, type Side as CSide, type Move as CMove, type Piece as CPiece,
} from './engine';
import {
  enterRoom, sendWs, inviteCode, clearInviteParam,
  isMoveRejected,  roomLiveFromState, opponentNameFromState,
  type OnlineState, type OnlineMsg,
} from '../online-core';
import { modeFromUrl, levelFromUrl } from '../shared';
import { openFriendRoom } from '../friend-room';
import { reportRound, isClassroom, urlRoomCode, ensureStudentCode } from '../../shared/teacher-track';
import { parseGameOver } from '../../shared/game-over';
import { diffCellAnims, animClassSuffix, animDelayStyle } from '../../shared/board-anim';
import { mountExportButton } from '../../shared/export-ui';
import { buildPgn } from './export';
import { playSfx, sfxOn, setSfx, unlockSfx } from '../../shared/sfx';
import { runAiSearch } from '../../shared/ai-worker';
// Vite `?worker` 导入：产出独立 worker chunk（默认导出是 Worker 构造函数）。
// 不要改成 new URL('./ai-worker.ts', import.meta.url) —— <4KB 会被内联成
// base64 data URI，module worker 不接受 data: URI（详见 ai-worker.ts 注释）。
import ChessAiWorker from './ai-worker.ts?worker';

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
const promoCard = document.getElementById('ch-promocard') as HTMLElement;
const promoClose = document.getElementById('ch-promo-close') as HTMLButtonElement;
const promoOpts = document.getElementById('ch-promo-opts') as HTMLElement;
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
const clockMeWho = document.getElementById('go-clock-me-who') as HTMLElement;
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
  /** 终局类型：'checkmate' | 'stalemate' | 'fifty' | 'insufficient' | 'resign'。
   *  null = 进行中。finish() 据此选择文案与 is-draw 类。 */
  result: string | null;
  /** 每步快照：用于 Undo */
  history: CS[];
  /** 完整走子序列（每手一个 CMove；回放时按顺序 applyMove） */
  moves: CMove[];
  timer: ReturnType<typeof createTimer>;
  aiThinking: boolean;
  reviewAt: number | null;
  /** 升变选择器是否打开。打开期间棋盘不可点，避免在选子未定时误落。 */
  promoOpen: boolean;
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
  // 大厅「vs AI Master」卡深链 ?level=hard（2026-10-23 接线，曾不读）
  level: levelFromUrl('medium', ['easy', 'medium', 'hard'] as const),
  gs: initialState() as CS,
  selected: -1,
  lastMove: null,
  over: false,
  result: null,
  history: [],
  moves: [],
  timer: createTimer(),
  aiThinking: false,
  reviewAt: null,
  promoOpen: false,
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

/**
 * 局面哈希（含 castling / en passant / 走子方）。
 * 用于三次重复判和：不记 halfmove（同一 halfmove 值允许重复计数——
 * 标准 FEN 重复计数惯例），也不记 fullmove。
 * 🔴 这是纯函数，不改传入的 state.gs。
 */
function positionKey(gs: CS): string {
  return (gs.board as string[]).join('') + '|'
    + (gs.castling.K ? 'K' : '') + (gs.castling.Q ? 'Q' : '')
    + (gs.castling.k ? 'k' : '') + (gs.castling.q ? 'q' : '')
    + '|' + (gs.enpassant ?? '-') + '|' + gs.turn;
}

/**
 * 子力不足判定（简化版，覆盖最常见的无将杀残局）：
 *   · K vs K（纯王对王）
 *   · K+B vs K（单象孤注）
 *   · K+N vs K（单马孤注）
 *   · 同色双象（K+B+B vs K，两象同色格）
 * 🔴 不覆盖 K+B+N vs K（实战极罕见，漏判影响小）；R/Q 任何方持有都非不足。
 * 调用时 gs.board 是 64 格棋子字符数组，'K'/'k' 是大写/小写表示王。
 */
function insufficientMaterial(gs: CS): boolean {
  // 收集双方除王外的子力
  const w: string[] = [], b: string[] = [];
  for (const p of gs.board as string[]) {
    if (p === '.') continue;
    if (p === 'K' || p === 'k') continue;
  if (p === p.toUpperCase()) w.push(p);
  else b.push(p);
  }
  // K vs K：双方都没有任何子
  if (w.length === 0 && b.length === 0) return true;
  // 单兵孤注（K+N vs K / K+B vs K）：一方无子，另一方只有 1 个轻子
  if (w.length === 0 && b.length === 1 && (b[0] === 'N' || b[0] === 'B')) return true;
  if (b.length === 0 && w.length === 1 && (w[0] === 'N' || w[0] === 'B')) return true;
  // 同色双象（K+B+B vs K）：一方只有两个象且同色格
  if (w.length === 0 && b.length === 2 && b[0] === 'B' && b[1] === 'B') {
    // 简化：任意两象同色格（按棋盘坐标色判）
    let colorMatch = false;
    let count = 0;
    for (let i = 0; i < 64; i++) {
      if (gs.board[i] === 'B') {
        count++;
        const f = i % 8, r = Math.floor(i / 8);
        const sqColor = (f + r) % 2; // 0 = 黑格, 1 = 白格
        if (count === 2) {
          // 比较第一象和当前象
          const firstB = gs.board.findIndex(x => x === 'B');
          if (firstB >= 0 && ((firstB % 8 + Math.floor(firstB / 8)) % 2) === sqColor) {
            colorMatch = true;
          }
        }
      }
    }
    if (colorMatch) return true;
  }
  if (b.length === 0 && w.length === 2 && w[0] === 'B' && w[1] === 'B') {
    let colorMatch = false;
    let count = 0;
    for (let i = 0; i < 64; i++) {
      if (gs.board[i] === 'B') {
        count++;
        const f = i % 8, r = Math.floor(i / 8);
        const sqColor = (f + r) % 2;
        if (count === 2) {
          const firstB = gs.board.findIndex(x => x === 'B');
          if (firstB >= 0 && ((firstB % 8 + Math.floor(firstB / 8)) % 2) === sqColor) {
            colorMatch = true;
          }
        }
      }
    }
    if (colorMatch) return true;
  }
  // 未覆盖的子力配置（双方都有子、或含 R/Q/P）→ 不算不足
  return false;
}

/**
 * 三次重复局面：走子历史里有 3 次相同位置哈希（含当前）。
 * 走子历史里存的是完整 CS 快照，逐个算 positionKey。
 */
function isThreefold(gs: CS, history: CS[]): boolean {
  const cur = positionKey(gs);
  const counts = new Map<string, number>();
  for (const snap of history) counts.set(positionKey(snap), (counts.get(positionKey(snap)) || 0) + 1);
  counts.set(cur, (counts.get(cur) || 0) + 1);
  return (counts.get(cur) ?? 0) >= 3;
}

/**
 * 终局原因检测：当前局面是否因 50-move / 子力不足 / 三次重复 自动判和。
 * 返回原因字符串，或 null（表示无自动和棋，继续走）。
 * 🔴 调用时机：`legalMoves === 0` 且 `!inCheck`（逼和）之前先查这三条。
 */
function autoDrawReason(gs: CS, history: CS[]): string | null {
  if (isThreefold(gs, history)) return 'threefold';
  if (gs.halfmove >= 100) return 'fifty';
  if (insufficientMaterial(gs)) return 'insufficient';
  return null;
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
/** 上一帧盘面快照：落子动画按 diff 注入（见 shared/board-anim.ts）。
 *  新局/退出回放时置 null——否则从终局局面回到初始局面会全盘乱pop。 */
let animPrevBoard: string[] | null = null;

function pieceSvg(p: CPiece, sq: number, animCls = '', delayStyle = ''): string {
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
  // 🔴 动画类必须挂**内层** g（2026-10-25 P0 修复）：.bd-anim-place 的 keyframes
  //    动画 CSS transform:scale()，而 SVG 的 transform 属性是优先级最低的
  //    presentation attribute —— CSS 动画（fill-mode:both，终态 scale(1)）会
  //    **整体覆盖**外层的 translate(ox oy) scale(w/40)，棋子被渲染到 SVG 原点
  //    且尺寸错，直到下一次重渲染才恢复。线上实测（duel 双 Tab + AI 单机）：
  //    走子后 3.2s 该棋子 getCTM 仍是 [0,0]，属性却写着 translate(151 151)；
  //    联机时对手屏幕每手都肉眼可见一颗棋子钉在棋盘左上角。
  //    内层 g 上的 CSS transform 只**叠加**在外层定位变换之上；弹出原点由
  //    现有 .bd-anim-place 规则的 transform-box:fill-box + center 提供
  //    （styles/boardduel.css），以棋子自身 bbox 中心缩放。其余 7 款棋子用
  //    cx/cy 定位，终态 scale(1) 是恒等变换，无此问题。
  return `<g class="ch-piece" transform="translate(${ox} ${oy}) scale(${w / 40})" fill="${body}" pointer-events="none">`
    + `<g class="ch-anim${animCls}"${delayStyle}>`
    + `<g stroke="${edge}" stroke-width="1.1" stroke-linejoin="round" fill="${body}">${glyph}</g>`
    + '</g></g>';
}

function render(): void {
  const { gs: viewGs, lastMove } = viewBoard(state.moves, state.reviewAt);
  const renderGs = state.reviewAt !== null ? viewGs : state.gs;
  const lm = state.reviewAt !== null ? lastMove : state.lastMove;

  // 动画三件套：只给相对上一帧真正新落的棋子挂一次性类（国象不翻面，
  // 升变 P→Q 也不播——allowFlip:false）。回放态不播，但快照照常更新。
  const anim = diffCellAnims(animPrevBoard, renderGs.board, state.reviewAt === null, { allowFlip: false });
  animPrevBoard = renderGs.board.slice();

  const canInteract = !state.over &&
    (state.mode === 'ai' ? humanSide() === state.gs.turn
      : state.mode === 'online' ? state.roomLive && state.gs.turn === myColor()   // 对手没进房：棋盘锁定
        : humanSide() === state.gs.turn)
    && state.reviewAt === null
    && !state.promoOpen        // 升变选择器打开时锁盘，避免选子未定时误落
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
      // bd-last-mark：与其他游戏统一的「最后一手」挂钩（样式/冒烟都靠它寻址）
      lastMark += `<circle class="bd-last-mark" cx="${cx}" cy="${cy}" r="6" fill="var(--ch-last, rgba(245,158,11,.45))"/>`;
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
    // 有合法走法的己方棋子永远可点：负责「选中 / 改选 / 再点一次取消选中」。
    // 与下面的落点区不重叠——legalMoves 只会落空点或敌子，不会吃自己的棋子。
    const fromSqs = new Set(moves.map((m) => m.from));
    for (const sq of fromSqs) {
      const [x, y] = squareXY(sq);
      hitAreas += `<g class="ch-cell" data-sq="${sq}" style="cursor:pointer">
        <rect class="hit" x="${PAD + x * CELL}" y="${PAD + y * CELL}" width="${CELL}" height="${CELL}" fill="transparent"/>
      </g>`;
    }
    if (state.selected >= 0) {
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
    if (renderGs.board[i] !== '.') pieces += pieceSvg(renderGs.board[i], i, animClassSuffix(anim, i), animDelayStyle(anim, i));
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
        const n = Number(sq);
        state.selected = state.selected === n ? -1 : n; // 再点同一个子 = 取消选中
        render();
      } else if (to !== undefined && from !== undefined) {
        // 兵到底线会一次生成 4 个候选（Q/R/B/N，见 engine.ts:293 的 for 循环）。
        // 原先 find() 取第一个 —— 永远���后，玩家无法升变为车/象/马，而棋盘上又画着
        // 四个重叠的落点圆点，看着像给了选择。改为多解时弹选择器。
        const cands = legalMoves(state.gs).filter((mm) => mm.from === Number(from) && mm.to === Number(to));
        if (cands.length === 1) doMove(cands[0]);
        else if (cands.length > 1) openPromoPicker(cands);
      }
    });
  });

  // 最后一手文本
  lastEl.textContent = lm ? notation(lm) : '—';
  renderHud();
  renderClockHud();
}

/** 兵升变选择器。关掉时恢复棋盘可点，避免弹层开着时还能落子。 */
let promoCands: CMove[] = [];

function openPromoPicker(cands: CMove[]): void {
  promoCands = cands;
  promoCard.hidden = false;
  state.promoOpen = true;
  render();
}

function closePromoPicker(): void {
  promoCands = [];
  promoCard.hidden = true;
  state.promoOpen = false;
  render();
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
    // 联机下不能沿用「You · White / Engine · Black」那套：myColor() 取决于座位，
    // 坐在 idx 1 的玩家是黑方，却会看到「You · White」，而对手是真人却被写成 Engine。
    const you = myColor() === 'w' ? window.t('bg.bg_chess_you_white_lc') : window.t('bg.bg_chess_you_black_lc');
    const opp = state.oppName || window.t('bg.bg_common_waiting_opponent');
    label = state.gs.turn === myColor() ? you : opp;
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
  } else if (state.mode === 'pass') {
    clockMeCard.classList.toggle('is-active', false);
    clockOppCard.classList.toggle('is-active', false);
  } else {
    // online：原先整个 else 都置 false，联机下永远不高亮「谁的钟在走」。
    const myTurn = state.roomLive && state.gs.turn === myColor();
    clockMeCard.classList.toggle('is-active', !state.over && myTurn);
    clockOppCard.classList.toggle('is-active', !state.over && !myTurn && state.roomLive);
  }
  // 自己这侧的时钟卡也要跟着座位走：myColor() 是 idx 0→白 / idx 1→黑，
  // 写死在 HTML 里的 "YOU · WHITE" 会让黑方玩家一直看着「YOU · WHITE」。
  // （该节点的 data-i18n 已摘掉——否则 i18n 的 MutationObserver 会把 JS 设的文案盖回去，
  //   与 go-clock-opp-who 同款处理。）
  clockMeWho.textContent = state.mode === 'online'
    ? (myColor() === 'w' ? window.t('bg.bg_chess_you_white') : window.t('bg.bg_chess_you_black'))
    : window.t('bg.bg_chess_you_white');
  // 联机：对手侧不能一直写「引擎」。没进房显示「等待中」，进房后显示真实昵称。
  if (state.mode === 'online') {
    clockOppWho.textContent = state.roomLive && state.oppName
      ? state.oppName
      : window.t('bg.bg_common_waiting_opponent');
  } else {
    // 非联机模式：原先靠 data-i18n 兜底，摘掉属性后由 JS 显式设回
    clockOppWho.textContent = window.t('bg.bg_chess_engine_black');
  }
}

/* ======================
 * 落子
 * ====================== */
/**
 * 按服务端下发的着法历史重放恢复棋盘（刷新/重连后用）。
 * 服务端从 2026-10-06 起为 chess 维护 relayMoves 并随 join 帧下发；
 * 此前中局刷新只能拿到空盘 —— 自己这边丢就算了，问题是**没刷新的对手也会被
 * 服务端的 start 广播带着一起清盘**，对局静默回到开局。
 * 重放期间不发消息、不出声，也不动时钟。
 */
function rebuildFromServer(moves: { from?: unknown; to?: unknown; promotion?: unknown }[]): void {
  cancelAiMove();
  const gs = initialState();
  const replayed: CMove[] = [];
  for (const m of moves) {
    const from = algToSq(String(m.from));
    const to = algToSq(String(m.to));
    if (from < 0 || to < 0) continue;
    const promo = typeof m.promotion === 'string' ? (m.promotion as CPiece) : undefined;
    const piece = gs.board[from];
    if (!piece || piece === '.') continue;
    const mv: CMove = { from, to, piece, promo };
    applyMove(gs, mv);
    replayed.push(mv);
  }
  state.gs = gs;
  state.moves = replayed;
  state.history = [];
  state.selected = -1;
  state.lastMove = replayed.length ? replayed[replayed.length - 1] : null;
  state.over = false;
  state.reviewAt = null;
  resetReplayUI();
  render();
}

/**
 * 从 state 帧里取服务端着法历史并重放。
 * 帧有两种形状：中继的扁平 {type:'state',you,code,roomStatus,players,moves}
 * 与判棋模式的嵌套 {type:'state',state:{...}}，两种都要认。
 * 已有本地着法时不重放（正常对弈中 state 帧会反复下发，避免重复应用）。
 */
function applyServerMoves(m: OnlineMsg): void {
  const inner = (m.state && typeof m.state === 'object') ? (m.state as OnlineMsg) : null;
  const mv = Array.isArray(m.moves) ? m.moves
    : (inner && Array.isArray(inner.moves) ? inner.moves : null);
  if (!mv || !mv.length) return;
  // 不按本地着法数设闸：服务端中继历史才是权威，且 rebuildFromServer 是 moves 的纯函数、
  // 重复执行结果一致。反倒是本地着法数会骗人 —— 自己刚走一手还没同步完时，
  // 本地比服务端多一手，若据此跳过重放就会保留一个与对手不一致的局面。
  rebuildFromServer(mv as { from?: unknown; to?: unknown; promotion?: unknown }[]);
}

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
    // 🔴 区分三种终局：将杀（被将军）/ 逼和（未被将军）/ 自动和棋（50-move/三连/子力不足）。
    const checked = inCheck(state.gs, state.gs.turn);
    if (checked) {
      state.result = 'checkmate';
    } else {
      const autoReason = autoDrawReason(state.gs, state.history);
      state.result = autoReason || 'stalemate';
    }
    state.over = true;
    stopTimer(state.timer);
    render();
    finish();
    return;
  }
  // 走棋中也可触发 50-move / 三次重复 / 子力不足 判和（不等到无合法着法）
  const autoReason = autoDrawReason(state.gs, state.history);
  if (autoReason && state.mode !== 'online') {
    state.result = autoReason;
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
    // 2026-10-23 第三批：搜索搬进 Web Worker（原同步 bestMove 在 hard 档
    // 冻结主线程 ~1.5s）。一次性通道 + 4s 超时 + 同步兜底：worker 不可用
    // 或超时都退回原路径，AI 永远能走（只是可能卡一下）。
    void runAiSearch(
      ChessAiWorker,
      { state: state.gs, level: state.level, timeBudget: 1500 },
      4000,
      () => bestMove(state.gs, state.level, 1500),
    ).then((m) => {
      // 守卫再查一次：worker 往返期间玩家可能已认输/新局/回放
      if (state.over || state.screen !== 'match' || state.reviewAt !== null || state.gs.turn !== 'b') {
        render();
        return;
      }
      if (!m) { render(); return; }
      doMove(m);
    });
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

  // 🔴 2026-10-20：按终局类型区分文案，修掉「stalemate 误显示 Checkmate」的死三元
  //   与「将杀/逼和都判本方胜/负」的规则性错误。result 由 afterMove 检测后写入。
  const result = state.result;
  let verdict: string, line: string, cls: string;

  if (result === 'checkmate') {
    // 将杀：本方是白且黑无着法=我赢；本方是黑且白无着法=我输。pass 模式 meWon=false。
    const meWon = state.mode === 'ai' ? state.gs.turn === 'b' : (state.mode === 'online' ? state.gs.turn !== myColor() : false);
    verdict = meWon ? window.t('bi.you_win') : window.t('bi.you_lose');
    line = window.t('chess.checkmate');
    cls = meWon ? 'is-win' : 'is-loss';
  } else if (result === 'stalemate' || result === 'fifty' || result === 'insufficient' || result === 'threefold') {
    // 逼和 / 50-move / 子力不足 / 三次重复 = 和棋。
    verdict = window.t('bi.draw');
    const reasonKey = result === 'stalemate' ? 'chess.stalemate'
      : result === 'fifty' ? 'chess.fifty'
      : result === 'insufficient' ? 'chess.insufficient'
      : 'chess.threefold';
    line = window.t(reasonKey as 'chess.checkmate');
    cls = 'is-draw';
  } else {
    // result 为 null（理论上不会到这里，finish 仅在 over=true 时调用；联机由 game_over 帧渲染）。
    // 兜底走原胜负逻辑，避免空文案。
    const meWon = state.mode === 'ai' ? state.gs.turn === 'b' : (state.mode === 'online' ? state.gs.turn !== myColor() : false);
    verdict = meWon ? window.t('bi.you_win') : window.t('bi.you_lose');
    line = window.t('chess.checkmate');
    cls = meWon ? 'is-win' : 'is-loss';
  }

  endVerdict.textContent = verdict;
  endLine.textContent = line;
  endVerdict.className = 'go-end-verdict ' + cls;
  const meWonBool = cls === 'is-win';
  const isDraw = cls === 'is-draw';
  snapshotResult(meWonBool && !isDraw);   // 终局快照给「分享结果」卡片（和棋不计为 win）
  playSfx(isDraw ? 'lose' : (meWonBool ? 'win' : 'lose'));
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
  // 新局/退出回放：清空动画快照，避免终局局面→初始局面时全盘乱pop
  animPrevBoard = null;
  replayBar.hidden = true;
  document.body.classList.remove('bd-replay');
}

function enterReplay(): void {
  if (!state.moves.length) { toast(window.t('bj.chess_no_moves_replay')); return; }
  // 联机中局禁回放：回放态棋盘渲染的是**重放出来的历史局面**，对手此刻走的那一手
  // 会被 apply 到真实 state 却完全看不见（要退出回放才显形）；若那一手终结了棋局，
  // 结束屏还会被 reviewAt !== null 压住 —— 玩家盯着冻住的棋盘，不知道这局已经结束。
  if (state.mode === 'online' && !state.over) { toast(window.t('bj.chess_review_after_end')); return; }
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
  // 联机禁用：undo 不看是谁走的，能把对手的棋子从自己屏幕上撤掉，
  // 而回合闸随之对双方同时打开 → 两块棋盘永久分叉，且全程没有任何报错。
  if (state.mode === 'online') { toast(window.t('bg.bg_common_undo_online')); return; }
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
  // 联机必须通知服务端。原先纯本地判负，后果有三：对手永远不知道这局结束了；
  // 没有结算（无 Elo、无金币）；房间也不清理，对手要等 60 秒断线宽限才靠
  // 「对手离开」拿到胜局 —— 而他若先点「再战」，restart 会把他自己的真实中局抹掉。
  if (state.mode === 'online' && state.ws) sendWs(state as OnlineState, { type: 'resign' });
  state.over = true;
  stopTimer(state.timer);
  endVerdict.textContent = window.t('bj.you_resigned');
  endVerdict.className = 'go-end-verdict is-loss';
  endLine.textContent = '—';
  toast(window.t('bj.resigned'));
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
 * 兵升变选择器
 * ====================== */
promoClose.addEventListener('click', closePromoPicker);
// 点遮罩空白处取消；四个选项点完即落子
promoCard.addEventListener('click', (e) => { if (e.target === promoCard) closePromoPicker(); });
promoOpts.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-promo]');
  if (!b) return;
  const want = b.dataset.promo;
  // 候选里找同兵种的那一个（Q/R/B/N 存在 Move.promo 里，用大写）
  const pick = promoCands.find((m) => String(m.promo || '').toLowerCase() === want) || promoCands[0];
  closePromoPicker();
  if (pick) doMove(pick);
});
// Esc 取消，避免弹层开着时没有出口
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.promoOpen) { e.stopPropagation(); closePromoPicker(); }
}, true);

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

/* 2026-10-06：分享结果 → Canvas 大图卡片（NumeriDuel 范式，可保存 PNG / 系统分享） */
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
  if (!lastResult) { toast(window.t('bg.bg_common_finish_first')); return; }
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
  // 再战/悔棋/退出都可能发生在升变选择器开着时，必须一并收掉，
  // 否则弹层会留在屏幕上盖住新局（这里直接清字段，不走 closePromoPicker 免得二次 render）
  promoCands = [];
  promoCard.hidden = true;
  state.promoOpen = false;
  state.gs = initialState() as CS;
  state.selected = -1;
  state.lastMove = null;
  state.over = false;
  state.result = null;
  state.history = [];
  state.moves = [];
  state.aiThinking = false;
  state.sawGameOver = false;
  // 联机：对手没进房时不启钟（2026-10-06）。由 applyRoomState 在 start 到达时再启动。
  if (state.mode !== 'online' || state.roomLive) {
    startTimer(state.timer, (ms) => { clockMeTime.textContent = fmtClock(ms); });
  }
  levelBtn.hidden = state.mode !== 'ai';
  undoBtn.hidden = state.mode === 'online';   // 联机下 undo 会污染对手的棋盘，见 undo()
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
    toast(window.t('bj.opp_left'));
  } else if (t === 'game_over') {
    // 🔴 原先只 render()：服务端判负（如断线宽限到期、超时）时玩家看到一块冻住的
    //   棋盘，没有胜负、没有「再战」按钮（结算屏是另一个默认 hidden 的 section），
    //   只能自己找路退出。改为填结算并弹屏，字段口径对齐 games-room.js:783
    //   settleAndBroadcast —— 发的是 { winner: 座位号|'draw', reason }。
    state.over = true;
    state.sawGameOver = true;
    stopTimer(state.timer);
    // 🔴 2026-10-15：口径收敛到共享解析器。修复前这里是裸读 msg.winner 且只认
    //   [w === 'draw']，而服务端 relay 模式的 drawAccept 广播的是
    //   { kind:'draw', reason:'双方同意' } —— 没有 winner 字段（见 shared/game-over.ts
    //   顶部的契约事故说明）。于是双方同意和棋被渲染成一方胜出的胜负屏。
    //   parseGameOver 同时认 winner:'draw' 与 kind:'draw' 两种形状，
    //   所以前端可以先于服务端上线，部署窗口内也不会错判。
    const go = parseGameOver(msg);
    if (go.draw) {
      endVerdict.textContent = window.t('bi.draw');
      endVerdict.className = 'go-end-verdict is-draw';
      endLine.textContent = window.t('bj.draw_agreed');
    } else {
      // 🔴 判胜负必须先确认 winner 非 null：[null !== myIdx] 会把双方同时显示成失败。
      const iLost = (typeof go.winner === 'number' && state.myIdx !== null) ? go.winner !== state.myIdx : false;
      endVerdict.textContent = iLost ? window.t('bj.you_resigned') : window.t('bj.opp_resigned');
      endVerdict.className = 'go-end-verdict ' + (iLost ? 'is-loss' : 'is-win');
      endLine.textContent = go.reason === 'opponent_left' ? window.t('bj.opp_left') : window.t('bj.by_resignation');
    }
    render();
    scheduleEndScreen();
  }
}

/* ======================
 * 启动
 * ====================== */

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
    // 重连也会再走 onConnect（每条新连接各触发一次）。不清盘，否则重连瞬间本地局面被抹掉，
    // 紧接着 onState 的 rebuildFromServer 虽然会从服务端历史重放回来，但会闪一下空盘，
    // 且 newGame 顺带重置时钟/历史。onState 会用服务端着法把局面补齐。
    onConnect: () => { if (!state.moves.length) newGame(); toast(window.t('bg.bg_common_connected_room', { code })); },
    onReconnect: () => { toast(window.t('bg.bg_common_reconnected')); render(); },
    // 重连次数用尽：棋盘保持锁定（服务端状态未知，不能瞎走），但必须给一句出路
    onReconnectFailed: (c: string) => { toast(window.t('bg.bg_common_reconnect_failed', { code: c }), 9000); render(); },
    onOpponentMove: handleWs,
    // 服务端对「第二人加入」和「重连」广播的是同一个 start（games-room.js:267-310），
    // 无条件 newGame() 会让中途刷新把**没刷新的对手**那盘真实中局也一起清空。
    onStart: (m: OnlineMsg) => { if (!state.moves.length) newGame(); applyRoomState(m, true); },
    onState: (m: OnlineMsg) => { applyServerMoves(m); applyRoomState(m, false); },
    onRestart: () => newGame(),
    onOpponentLeave: () => { state.roomLive = false; toast(window.t('bj.opp_left')); render(); },
    // 断线：online-core 已把 roomLive 置 false，这里锁盘并给一句可见提示
    onDisconnect: () => { toast(window.t('match.disconnected')); render(); },
    // chess/xiangqi 原先没有 onError：服务端任何拒绝（对局未开始 / 对方未连接 /
    // bad_msg）都被静默丢弃 —— 玩家看着本地那步棋留在盘上，对手那边根本没有，
    // 且零反馈。接线后按 isMoveRejected 判定是否回滚。
    onError: (m: OnlineMsg) => {
      const code = String((m.code as string) || (m.message as string) || '');
      if (isMoveRejected(m)) {
        const prev = state.history.pop();
        if (prev) {
          state.gs = prev;
          state.moves.pop();
          state.lastMove = state.gs.history[state.gs.history.length - 1] || null;
          state.selected = -1;
          state.over = false;
          render();
        }
        toast(window.t('bg.bg_common_move_rejected'));
      }
      if (code && !isMoveRejected(m)) toast(code);
    },
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

/* ======================
 * 棋谱导出（2026-10-24 第四批）
 * 国际象棋 PGN：SAN 由 buildPgn 重放整局生成（含消歧 / 易位 / 升变 / +# 标记）。
 * ====================== */
mountExportButton({
  game: 'chess',
  ext: 'pgn',
  build: () => (state.moves.length ? buildPgn(state.moves.slice()) : null),
});
