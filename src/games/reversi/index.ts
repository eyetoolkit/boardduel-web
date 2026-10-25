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
  seatColor, turnToPlayer, lastPlacedCell,
  type Board as RBoard, type Player as RPlayer, type Difficulty as RDifficulty,
} from './engine';
import {
  enterRoom, sendWs, inviteCode, clearInviteParam,
  roomLiveFromState, opponentNameFromState,
  type OnlineState, type OnlineMsg,
  isMoveRejected, stateBody,
} from '../online-core';
import { modeFromUrl, levelFromUrl } from '../shared';
import { diffCellAnims, animClassSuffix, animDelayStyle } from '../../shared/board-anim';
import { buildMoveList } from '../../shared/export-record';
import { mountExportButton } from '../../shared/export-ui';
import { openFriendRoom } from '../friend-room';
import { reportRound, isClassroom, urlRoomCode, ensureStudentCode } from '../../shared/teacher-track';
import { parseGameOver } from '../../shared/game-over';
import { playSfx, sfxOn, setSfx, unlockSfx } from '../../shared/sfx';
import { runAiSearch } from '../../shared/ai-worker';
// Vite `?worker` 导入（理由同 chess：new URL 写法会被内联成 data URI 而失效）
import ReversiAiWorker from './ai-worker.ts?worker';

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
const clockOppWho = document.getElementById('go-clock-opp-who') as HTMLElement;

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
  roomLive: false,
  oppName: null,
  myIdx: null,
  sawGameOver: false,
};

const MODE_PAGE = '/games/reversi/lobby/';
const HUMAN = 1;       // 单机玩家 = 白（engine player 1 = 白）
const ENGINE = 2;      // 单机 AI = 黑（engine player 2 = 黑）
/** 联机 seat0 = 黑（服务端 reversi-core.js:17-18），seat1 = 白。见 engine.seatColor。 */

/* ======================
 * 工具
 * ====================== */
function counts(b: RBoard): [number, number] {
  let w = 0, k = 0;
  for (const v of b) { if (v === 1) w++; else if (v === 2) k++; }
  return [w, k];
}

/**
 * viewBoard：按 moves 序列 + reviewAt 纯函数重放；用 revPlace 自动翻转。
 * 🔴 first 参数（2026-10-23）：先手色。单机玩家执白先行，联机 seat0=黑先行
 *    （服务端 reversi-core turn=0=黑）—— 不传会按白先重放，联机回放颜色整体错。
 * ⚠️ 已知近似：着法序列不含 pass（黑白棋停招不产生落点），一次停招之后的
 *    轮换推断会失真；联机快照也不含着法历史（重连后 moves 缺期内着法）。
 *    回放仅作观演，盘面与胜负判定始终以服务端权威盘为准。
 */
function viewBoard(moves: number[], reviewAt: number | null, first: RPlayer = 1): { b: RBoard; lastMove: number } {
  const b = emptyBoard() as RBoard;
  const n = reviewAt === null ? moves.length : reviewAt + 1;
  let last = -1;
  for (let k = 0; k < Math.min(n, moves.length); k++) {
    const i = moves[k];
    if (i < 0 || i >= SIZE * SIZE) continue;
    const p = (k % 2 === 0 ? first : (first === 1 ? 2 : 1)) as RPlayer;
    revPlace(b, i, p);
    last = i;
  }
  return { b, lastMove: last };
}

/* ======================
 * 渲染
 * ====================== */
/** 上一帧盘面快照：落子/翻子动画按 diff 注入（见 shared/board-anim.ts）。
 *  退出回放时置 null——否则从历史位置跳回实时盘会误放一串动画。 */
let animPrevBoard: RBoard | null = null;

function render(): void {
  // 联机回放按黑先重放（seat0=黑），单机/同屏按白先（见 viewBoard 注释）
  const firstColor: RPlayer = state.mode === 'online' ? 2 : 1;
  const { b, lastMove } = viewBoard(state.moves, state.reviewAt, firstColor);
  const renderBoard = state.reviewAt !== null ? b : state.board;
  const lastIdx = state.reviewAt !== null ? lastMove : state.lastMove;

  // 动画三件套：只给相对上一帧真正变化的格子挂一次性类（翻子按距离 stagger）。
  // 回放态不播（历史盘面跳变会全盘乱pop），但快照照常更新。
  const anim = diffCellAnims(animPrevBoard, renderBoard, state.reviewAt === null, { lastIdx, cols: 8, allowFlip: true });
  animPrevBoard = renderBoard.slice();

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
  // roomLive 缺失会导致等待期就画出可点提示环（点了又被 onCell 静默丢掉）；
  // reviewAt 缺失会导致回放态照常显示可点样式。两者都跟 onCell 的实际闸门对齐。
  // 🔴 2026-10-23：联机行棋权按 seatColor 判（seat0=黑/seat1=白），不是 myIdx+1。
  const myTurnOnline = state.mode === 'online' && state.roomLive && state.myIdx !== null && state.player === seatColor(state.myIdx);
  const showHints = !state.over && state.reviewAt === null &&
    (state.mode === 'pass' || (state.mode === 'ai' ? state.player === HUMAN : myTurnOnline));
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
    pieces += `<circle class="rv-stone${isLast ? ' is-last' : ''}${animClassSuffix(anim, i)}"${animDelayStyle(anim, i)} cx="${cx}" cy="${cy}" r="${CELL * 0.42}" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>`;
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
    // 🔴 2026-10-23：联机 HUD 不能显示「你（白）/引擎（黑）」—— 对方是真人，
    //   且玩家颜色随座位变（seat0=黑/seat1=白）。按是否轮到我显示。
    const myTurnNow = state.roomLive && state.myIdx !== null && state.player === seatColor(state.myIdx);
    label = !state.roomLive
      ? window.t('bg.bg_common_waiting_opponent')
      : (myTurnNow ? window.t('othello.your_turn') : window.t('othello.opponent_turn'));
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
  } else if (state.mode === 'pass') {
    clockMeCard.classList.toggle('is-active', false);
    clockOppCard.classList.toggle('is-active', false);
  } else {
    // online：原来整个 else 都置 false，联机下永远不高亮「谁的钟在走」。
    // 🔴 2026-10-23：行棋权按 seatColor 判（seat0=黑/seat1=白），不是 myIdx+1。
    const myTurn = state.roomLive && state.myIdx !== null && state.player === seatColor(state.myIdx);
    clockMeCard.classList.toggle('is-active', !state.over && myTurn);
    clockOppCard.classList.toggle('is-active', !state.over && !myTurn && state.roomLive);
  }
  // 联机：对手侧不能一直写「引擎」。没进房显示「等待中」，进房后显示真实昵称。
  if (state.mode === 'online') {
    clockOppWho.textContent = state.roomLive && state.oppName
      ? state.oppName
      : window.t('bg.bg_common_waiting_opponent');
  } else {
    // 非联机模式：原先靠 data-i18n 兜底，摘掉属性后由 JS 显式设回
    clockOppWho.textContent = window.t('bg.bg_reversi_engine_black');
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
    // 联机落子颜色 = 本方座位颜色（seat0=黑/seat1=白），不是 myIdx+1
    state.player = seatColor(state.myIdx);
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
  // 切换回合。state.player 此刻仍是刚走完的那一方，other 才是下一手方。
  const other: RPlayer = state.player === 1 ? 2 : 1;
  // 下一手方无合法步 → 跳过
  if (legalMoves(state.board, other).length === 0) {
    // 双方都无合法步 → 终局
    if (legalMoves(state.board, state.player).length === 0) {
      state.over = true;
      stopTimer(state.timer);
      render();
      finish();
      return;
    }
    // 仅对方没子下 → 跳过，刚走完的这一方继续走（与服务端 reversi-core.js:93 同规则）。
    // 原来这里写的是 state.player = other，等于把回合判给没子可走的那方：
    // 双人同屏直接死局，联机则与服务端权威棋盘对着干。
    toast(state.mode === 'ai' ? (other === HUMAN ? 'You have no move · skip' : 'Engine has no move · skip') : 'No move · pass');
    render(); // state.player 保持不变 = 继续走
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
    // 2026-10-23 第三批：搜索搬进 Web Worker（原同步 bestMove 在 hard 档
    // 冻结主线程达秒级）。一次性通道 + 4s 超时 + 同步兜底。
    void runAiSearch(
      ReversiAiWorker,
      { board: state.board, player: ENGINE, level: state.level },
      4000,
      () => bestMove(state.board, ENGINE, state.level),
    ).then((m) => {
      // 守卫再查一次：worker 往返期间可能终局/新局/回放
      if (state.over || state.screen !== 'match' || state.reviewAt !== null || state.player !== ENGINE) {
        render();
        return;
      }
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
    });
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
    // 本方颜色按座位推（seat0=黑/seat1=白），不是 myIdx+1
    const me = seatColor(state.myIdx);
    const my = me === 1 ? w : k;
    const op = me === 1 ? k : w;
    const youWin = my > op;
    reportRound(state.roomCode, {
      round: 1, solved: youWin, duration_ms: dur,
      outcome: my === op ? 'draw' : (youWin ? 'win' : 'loss'),
    });
  }

  const [w, k] = counts(state.board);
  // 🔴 2026-10-23：联机「本方是否获胜」按座位颜色推（seat0=黑/seat1=白），
  //    不是 myIdx+1；样式/音效/分享快照统一用它，和棋单独分流。
  const meColor = seatColor(state.myIdx);
  const meWin = state.mode === 'online'
    ? (meColor === 1 ? w : k) > (meColor === 1 ? k : w)
    : w > k;
  let verdict: string;
  // 🔴 2026-10-16：结算词此前是硬编码英文，切换中文站仍显示 "You win"。
  // 改走全站共享键 bi.*（与 bi.draw / bi.black_wins 同族），不新造游戏专属键。
  if (w === k) verdict = window.t('bi.draw');
  else if (state.mode === 'ai') verdict = w > k ? window.t('bi.you_win') : window.t('bi.ai_wins');
  else if (state.mode === 'pass') verdict = w > k ? window.t('bi.white_wins') : window.t('bi.black_wins');
  else verdict = meWin ? window.t('bi.you_win') : window.t('bi.you_lose');
  const line = `${window.t('bg.bg_reversi_score')} ${w} · ${k}`;
  endVerdict.textContent = verdict;
  endLine.textContent = line;
  // 🔴 样式按「本方是否获胜」判。原实现 `w >= k` 按白黑判 ——
  //    联机坐 seat0（黑）且黑多时判 is-loss + lose 音；和棋还被算成 is-win。
  endVerdict.className = 'go-end-verdict ' + (w === k ? 'is-draw' : (meWin ? 'is-win' : 'is-loss'));
  // 终局快照给「分享结果」卡片：联机比自己的子数，AI/观战看白黑
  snapshotResult(meWin);
  playSfx(w === k ? 'place' : (meWin ? 'win' : 'lose'));
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
  // 退出回放：清空动画快照，避免从历史位置跳回实时盘时误放一串 pop/flip
  animPrevBoard = null;
  replayBar.hidden = true;
  document.body.classList.remove('bd-replay');
}

function enterReplay(): void {
  if (!state.moves.length) { toast(window.t('bg.bg_common_no_moves_yet')); return; }
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
  // 🔴 2026-10-15 新增：联机禁用（与 tictactoe 一致）——理由同 connect4。
  if (state.mode === 'online') { toast(window.t('bj.undo_offline_only')); return; }
  cancelAiMove();
  if (state.history.length === 0) return;
  // 🔴 2026-10-15 修复：AI 模式 history 回退 2 步，修复前 moves 只 pop 1 次 → 错位。
  //   本游戏错位后果比 connect4 更重：viewBoard() 用 revPlace 重放翻转，
  //   多留一条 moves 会凭空多子并翻转一片棋（不是少一枚，是整片局面失真）。
  const steps = state.mode === 'ai' && state.history.length >= 2 ? 2 : 1;
  for (let k = 0; k < steps; k++) {
    const last = state.history.pop()!;
    state.board = last.board;
    state.player = last.player;
    state.lastMove = last.lastMove;
    state.moves.pop();
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
  // 联机必须通知服务端。connect4/reversi 此前与 chess/xiangqi/tictactoe 一样是纯本地
  // 判负（那一批只补了后者三款），后果：对手永远不知情、服务端 status 停在 'playing'、
  // 无 Elo 无金币结算、房间不收尾 —— 而且认输后再战会被服务端的局中守卫拒绝。
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
document.getElementById('rv-share')?.addEventListener('click', async () => {
  if (!lastResult) { toast(window.t('bg.bg_common_finish_first')); return; }
  const m = await import('../share-card');
  m.shareResult('Reversi · 8×8', {
    youWin: lastResult.youWin,
    moves: lastResult.moves,
    durationSec: lastResult.durationSec,
    link: state.roomCode ? location.origin + '/b/reversi/' + state.roomCode : location.origin + '/games/reversi/',
    qrGame: state.roomCode ? 'reversi' : undefined,
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
  state.board = emptyBoard() as RBoard;
  // 联机开局恒由 seat0（黑）先行 —— 服务端 reversi-core newGame turn=0（黑先）。
  // 单机保持玩家（白）先行的产品选择。seat1 玩家此时看到"黑方行棋"= 等待态。
  state.player = state.mode === 'online' ? turnToPlayer(0) : HUMAN;
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
  undoBtn.hidden = state.mode === 'online';   // 联机下 undo 会污染对手棋盘（见 undo() 内注释）
  showScreen('match');
  render();
  armBackGuard();
}

/* ======================
 * 联机
 * ====================== */
/**
 * 🔴 座位→颜色必须走 seatColor（2026-10-23）：
 *    服务端 seat0=黑(0)先手、seat1=白(1)，而 state.player 是颜色域(1白/2黑)。
 *    原实现 `player === myIdx+1` 把 seat0 当白、seat1 当白……seat0 全程被判错：
 *    权威盘每步到达棋子 visibly 变色、合法点按白色计算而实际行棋方是黑、
 *    HUD 顶着假的 "You · White"。
 */
function onlineMyTurn(): boolean {
  if (!state.roomLive) return false;   // 对手没进房：棋盘锁定（与 go 的 rankedLive 同义）
  if (state.myIdx === null) return false;
  return state.player === seatColor(state.myIdx);
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
  // 本方颜色按座位推（seat0=黑/seat1=白），不是 myIdx+1
  const me = seatColor(state.myIdx);
  if (state.player === me && legalMoves(state.board, me).length === 0) {
    sendWs(state as OnlineState, { type: 'pass' });
  }
}

function handleWs(msg: OnlineMsg): void {
  const t = String(msg.type || '');
  if (t === 'opponent_place') {
    // 🔴 2026-10-23：不再落子。服务端 doMove 的顺序是
    //    「先 broadcastState()（权威盘，已含该子+全部翻子）再广播 opponent_place」
    //    （games-room.js:881-884），且 broadcast() 无差别发给房间里所有人 ——
    //    每个客户端收到顺序恒为 state → opponent_place。原实现在权威盘上又
    //    revPlace 一次：幻影子 + 重复翻子（翻过的子被翻回），双端必然分叉。
    //    opponent_place 现在只承担「对手落子」提示音；盘面唯一来源是 state 帧。
    //    自动 pass 检测改由 onState 末尾触发（见 roomHandlers）。
    const by = typeof msg.by === 'number' ? msg.by : -1;
    if (by >= 0 && by !== state.myIdx) playSfx('place');
  } else if (t === 'pass_notify') {
    state.player = state.player === 1 ? 2 : 1;
    render();
    maybeAutoPass();
  } else if (t === 'start' || t === 'restart_notify') {
    newGame();
  } else if (t === 'opponent_leave') {
    toast(window.t('bg.bg_common_opponent_left'));
  } else if (t === 'game_over') {
    // 原先只 render()：对端收到服务端结算后没有任何结果呈现，也不会弹结算屏。
    // 与 chess/xiangqi/tictactoe 同批补上（那一批漏了 connect4/reversi）。
    // 字段口径对齐 games-room.js:1030 settleAndBroadcast：{ winner: 座位号|'draw', reason }
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
      // 🔴 2026-10-23：终局原因必须参与判词（与 connect4 同批修）。
      //    自然终局（棋盘满/双方无棋，reason:'natural_over' 或 'double_pass'）、
      //    超时（'timeout'）此前一律渲染成「认输」。按 reason 分流：
      //      resign         → 认输判词（保持原样）
      //      timeout        → 胜/负 + 时间到
      //      opponent_left  → 胜 + 对手离开
      //      natural_over 等 → 胜/负 + 棋盘上终局
      const resigned = go.reason === 'resign';
      endVerdict.textContent = resigned
        ? (iLost ? window.t('bj.you_resigned') : window.t('bj.opp_resigned'))
        : (iLost ? window.t('bi.you_lose') : window.t('bi.you_win'));
      endVerdict.className = 'go-end-verdict ' + (iLost ? 'is-loss' : 'is-win');
      endLine.textContent =
        go.reason === 'timeout' ? window.t('match.timeout')
        : go.reason === 'opponent_left' ? window.t('bj.opp_left')
        : resigned ? window.t('bj.by_resignation')
        : window.t('bj.natural_over');
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
/** 吸收服务端房间状态（state / start），驱动等待态与启钟。
 *  收到 start 表示对手已进房：此时才开表、才允许落子。 */
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
 * 服务端拒了刚落的那一子 → 回到落子之前。
 * reversi 是 judgment 模式，服务端权威校验后 err。
 * 没有这一步：本地已乐观落子并翻了盘，而服务端没这一手，
 * 双方棋盘从此分叉，且本地回合标记永久对不上 —— 房间卡死。
 */
function rollbackRejected(): void {
  const prev = state.history.pop();
  if (prev) {
    state.board = prev.board;
    state.player = prev.player;
    state.lastMove = prev.lastMove;
  }
  state.moves.pop();
  state.over = false;
  state.sawGameOver = false;
  render();
  toast(window.t('bg.bg_common_move_rejected'));
}

/**
 * 判断棋模式：从服务端权威棋盘快照恢复（每步广播 + 断线重连都用这一帧）。
 * 中继棋种靠 relayMoves 重放，而 reversi 是 judgment 模式 —— 服务端持有权威盘，
 * join 后随 broadcastState 下发，直接采用即可，不必重放。
 *
 * ⚠️ 两套编码不是一回事，不能直接赋值：
 *   服务端 reversi-core: 扁平 64，null=空 / 0=黑 / 1=白
 *   客户端 RBoard:      扁平 64，0=空  / 1=白 / 2=黑
 *
 * 🔴 2026-10-23：turn 是**座位号**（0=黑先手）不是颜色，必须过 turnToPlayer。
 *    原实现 `player = turn + 1` 把服务端 turn=0 当客户端 1(白) —— 而 seat0 实际
 *    是黑：seat0 玩家刚落黑子，下一秒权威盘把它"变回"黑（可见地变色），合法点
 *    提示按白色算（点了被服务端拒），HUD "You · White" 是假标签。
 *    另：快照不含着法序列，本地 moves 保留不清（重连后缺重连期间的着法，
 *    回放略失真；盘面与回合以本帧为权威）。
 */
function applyServerBoard(m: OnlineMsg): void {
  // 🔴 2026-10-25（P1 修复）：state 帧有两种形状，必须过共享 stateBody 解内层——
  //    broadcastState() 发 {type:'state', state:{board,...}}（嵌套）；
  //    而每次 WS 连接的首帧 joinState（games-room.js handleConnect）发的是
  //    {type:'state', you, code, ...snapshot()}（board/turn 在顶层）。
  //    原实现只认嵌套形状 → 重连/刷新进来的玩家把首帧权威盘静默丢弃：
  //    · 会话内重连：棋盘停在断线前的旧局，直到双方中任意一方下一手才自愈；
  //    · 刷新重进：onConnect 的 newGame() 已把盘重置成初始 4 子，首帧又被丢，
  //      玩家对着空盘看对手下棋。v6 全量实测复现：A 端漏一帧广播后 6 子 stale。
  const inner = stateBody(m);
  if (!Array.isArray(inner.board) || inner.board.length !== 64) return;
  if (typeof inner.turn !== 'number') return;
  const b: RBoard = [];
  for (let i = 0; i < 64; i++) {
    const v = inner.board[i] as number | null;
    b.push(v === null || v === undefined ? 0 : (v === 1 ? 1 : 2));
  }
  const prev = state.board;
  state.board = b;
  state.player = turnToPlayer(inner.turn);
  // diff 推最后落点（翻子格原非空，不会误判）；无新增（重连首帧）时保留旧值
  const diffLast = lastPlacedCell(prev, b);
  if (diffLast >= 0) state.lastMove = diffLast;
  state.over = String(inner.status || '') === 'over';
  state.sawGameOver = false;
  render();
}

function roomHandlers(code: string) {
  return {
    // 重连也会再走 onConnect。清盘会让重连瞬间本地局面被抹掉、顺带重置时钟与历史。

    onConnect: () => { if (!state.moves.length) newGame(); toast(window.t('bg.bg_common_connected_room', { code })); maybeAutoPass(); },

    onReconnect: () => { toast(window.t('bg.bg_common_reconnected')); render(); },
    // 重连次数用尽：棋盘保持锁定（服务端状态未知，不能瞎走），但必须给一句出路
    onReconnectFailed: (c: string) => { toast(window.t('bg.bg_common_reconnect_failed', { code: c }), 9000); render(); },
    onOpponentPlace: handleWs,
    onPassNotify: handleWs,
    onStart: (m: OnlineMsg) => { newGame(); applyRoomState(m, true); },
    // 🔴 2026-10-23：state 帧后必须跑 maybeAutoPass ——  opponent_place 不再落子后，
    //   「轮到我且无合法步 → 自动 pass」的唯一触发点就是这里（原流程搭在
    //   opponent_place 的 afterMove 上，已随幻影修复一起拆掉）。
    onState: (m: OnlineMsg) => { applyServerBoard(m); applyRoomState(m, false); maybeAutoPass(); },
    onRestart: () => newGame(),
    onOpponentLeave: () => { state.roomLive = false; toast(window.t('bg.bg_common_opponent_left')); render(); },
    // 断线：online-core 已把 roomLive 置 false，这里锁盘并给一句可见提示
    onDisconnect: () => { toast(window.t('match.disconnected')); render(); },
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
  newGame();
  void openFriendRoom('reversi', 'rv', {
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

/** 8×8 棋盘坐标：列 A-H + 行 1-8 */
const rvCoord = (i: number): string => 'ABCDEFGH'[i % 8] + String(Math.floor(i / 8) + 1);

/* ======================
 * 棋谱导出（2026-10-24 第四批）
 * 黑白棋用棋盘坐标（A1..H8），pass 记作 "pass"。
 * ====================== */
mountExportButton({
  game: 'reversi',
  ext: 'txt',
  build: (verdict) => (state.moves.length
    ? buildMoveList({
        title: 'BoardDuel · Reversi',
        moves: state.moves.map((i) => (i < 0 ? 'pass' : rvCoord(i))),
        result: verdict,
        meta: ['files A-H (left to right), ranks 1-8 (top to bottom)'],
      })
    : null),
});
