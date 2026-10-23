/**
 * BoardDuel · Checkers (English Draughts, 8×8) · arena 范式
 * ------------------------------------------------------------
 * 范围：AI 三档 + Pass & Play + 在线好友房（回放后置）。
 * 联机：大厅「Friend Room」/「Create a room」→ ?mode=friend 建房，
 *       邀请短链 /b/checkers/<CODE> → ?c=<CODE> 进房，
 *       走子以 {from,target,caps,kinged} 结构化转发（games-room.js relay 模式）。
 * 交互：点己方棋子 → 高亮其所有合法落点（含连跳最终落点）→ 点落点执行整条连跳。
 * 规则由 ./engine.ts 保证（强制吃子 / 连跳 / 升变 / 无步判负）。
 */
import {
  setupNav, startTimer, stopTimer, createTimer, fmtClock,
  toast, type Mode,
} from '../game-core';
import { wireLobbyChrome } from '../../lobby-chrome';
import {
  initialBoard, cloneBoard, moves, applyMove, bestMove, countPieces,
  type Board as CBoard, type Player as CPlayer, type Difficulty as CDifficulty, type Move,
  EMPTY, colorOf, isKing, SIZE, RED_MAN, BLACK_MAN,
} from './engine';
import { modeFromUrl, levelFromUrl } from '../shared';
import { playSfx, sfxOn, setSfx, unlockSfx } from '../../shared/sfx';
import { parseGameOver } from '../../shared/game-over';
import { diffCellAnims, animClassSuffix, animDelayStyle } from '../../shared/board-anim';
import { buildMoveList } from '../../shared/export-record';
import { mountExportButton } from '../../shared/export-ui';
import {
  enterRoom, sendWs, inviteCode, clearInviteParam,
  roomLiveFromState, opponentNameFromState,
  type OnlineState, type OnlineMsg,
  isMoveRejected,
} from '../online-core';
import { openFriendRoom } from '../friend-room';
import { reportRound, isClassroom, urlRoomCode, ensureStudentCode } from '../../shared/teacher-track';

/* ====================== 棋盘常量 ====================== */
const SLOT = 540;
const PAD = 16;
const CELL = (SLOT - 2 * PAD) / SIZE;

/* ====================== DOM 引用 ====================== */
const boardEl = document.getElementById('bd-board') as HTMLDivElement;
const turnEl = document.getElementById('ck-turn') as HTMLElement;
const scoreEl = document.getElementById('ck-score') as HTMLElement;
const modeEl = document.getElementById('ck-mode-v') as HTMLElement;
const undoBtn = document.getElementById('ck-undo') as HTMLButtonElement;
const resignBtn = document.getElementById('ck-resign') as HTMLButtonElement;
const levelBtn = document.getElementById('ck-level') as HTMLButtonElement;
const levelCard = document.getElementById('ck-levelcard') as HTMLElement;
const levelClose = document.getElementById('ck-level-close') as HTMLButtonElement;
const soundBtn = document.getElementById('ck-sound') as HTMLButtonElement;
const matchEl = document.getElementById('ck-match') as HTMLElement;
const endEl = document.getElementById('ck-end') as HTMLElement;
const endVerdict = document.getElementById('ck-end-verdict') as HTMLElement;
const endLine = document.getElementById('ck-end-line') as HTMLElement;
const rematchBtn = document.getElementById('ck-rematch') as HTMLButtonElement;
const endLobbyBtn = document.getElementById('ck-end-lobby') as HTMLButtonElement;
const leaveCard = document.getElementById('ck-leavecard') as HTMLElement;
const leaveClose = document.getElementById('ck-leave-close') as HTMLButtonElement;
const leaveStay = document.getElementById('ck-leave-stay') as HTMLButtonElement;
const leaveYes = document.getElementById('ck-leave-yes') as HTMLButtonElement;
const backLobbyBtn = document.getElementById('ck-back-lobby') as HTMLButtonElement;
const clockMeTime = document.getElementById('ck-clock-me-time') as HTMLElement;
const clockMeWho = document.getElementById('go-clock-me-who') as HTMLElement;
const clockOppWho = document.getElementById('go-clock-opp-who') as HTMLElement;
const clockMeCard = document.getElementById('go-clock-me') as HTMLElement;
const clockOppCard = document.getElementById('go-clock-opp') as HTMLElement;

setupNav('checkers');

/* ====================== 状态 ====================== */
type UIState = {
  screen: 'match' | 'end';
  mode: Mode;
  level: CDifficulty;
  board: CBoard;
  player: CPlayer;     // 当前轮到谁（1 红 / 2 黑）
  lastMove: number;    // 最后落点（琥珀高亮）
  over: boolean;
  selected: number;    // 已选中的己方棋子（-1 无）
  legal: Move[];       // 当前 player 的全部合法走法（含强制吃子约束）
  history: { board: CBoard; player: CPlayer; lastMove: number }[];
  /** 走子日志（from→to），仅供棋谱导出；悔棋/新局与 history 同步回滚 */
  moveLog: { from: number; to: number }[];
  sinceCapture: number; // 连续无吃子步数（达 40 判和）
  timer: ReturnType<typeof createTimer>;
  aiThinking: boolean;
  ws: WebSocket | null;
  roomCode: string | null;
  myIdx: number | null;
  /** 对手已进房（2026-10-06）：false 时棋盘锁定、计时不走、对手侧显示「等待中」 */
  roomLive: boolean;
  /** 对手昵称，服务端 start/state 广播带来 */
  oppName: string | null;
};
const HUMAN: CPlayer = 1;   // 玩家执红（先手）
const ENGINE: CPlayer = 2;  // 引擎执黑

const state: UIState = {
  screen: 'match',
  mode: 'ai',
  // 大厅「vs AI Master」卡深链 ?level=hard（2026-10-23 接线，曾不读）
  level: levelFromUrl('medium', ['easy', 'medium', 'hard'] as const),
  board: initialBoard(),
  player: HUMAN,
  lastMove: -1,
  over: false,
  selected: -1,
  legal: [],
  history: [],
  moveLog: [],
  sinceCapture: 0,
  timer: createTimer(),
  aiThinking: false,
  ws: null,
  roomCode: null,
  myIdx: null,
  roomLive: false,
  oppName: null,
};

const MODE_PAGE = '/games/checkers/lobby/';
const AI_THINK_MS: Record<CDifficulty, number> = { easy: 360, medium: 560, hard: 760 };

/* ====================== 工具 ====================== */
function rowCol(i: number): [number, number] { return [Math.floor(i / SIZE), i % SIZE]; }
function cx(i: number): number { const [, c] = rowCol(i); return PAD + c * CELL + CELL / 2; }
function cy(i: number): number { const [r] = rowCol(i); return PAD + r * CELL + CELL / 2; }

/* ====================== 渲染 ====================== */
/** 上一帧盘面快照：落子动画按 diff 注入（见 shared/board-anim.ts）。
 *  跳棋无回放，故 live 恒真；首帧 prev=null 不播（进页面不乱pop）。 */
let animPrevBoard: number[] | null = null;

function render(): void {
  const b = state.board;

  // 动画三件套：只给相对上一帧真正新落的棋子挂一次性类（连跳只标终点落点）
  const anim = diffCellAnims(animPrevBoard, b, true, { lastIdx: state.lastMove, cols: SIZE });
  animPrevBoard = b.slice();

  // 棋盘格（深浅交替）
  let cells = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const dark = (r + c) % 2 === 1;
      const x = PAD + c * CELL;
      const y = PAD + r * CELL;
      cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${dark ? 'var(--ck-board-dark, #C9A27E)' : 'var(--ck-board-light, #F3EEE2)'}"/>`;
    }
  }

  // 选中 / 目标高亮
  let hl = '';
  const myTurn = !state.over && (
    state.mode === 'pass' ||
    (state.mode === 'ai' && state.player === HUMAN) ||
    (state.mode === 'online' && onlineMyTurn())
  ) && !state.aiThinking;
  if (myTurn) {
    if (state.selected >= 0) {
      // 该子的合法落点
      hl += `<circle cx="${cx(state.selected)}" cy="${cy(state.selected)}" r="${CELL * 0.46}" fill="none" stroke="#F59E0B" stroke-width="4"/>`;
      for (const m of state.legal) {
        if (m.from !== state.selected) continue;
        hl += `<circle cx="${cx(m.to)}" cy="${cy(m.to)}" r="${CELL * 0.28}" fill="#F59E0B" opacity="0.85"/>`;
        if (m.captures.length > 0) {
          hl += `<circle cx="${cx(m.to)}" cy="${cy(m.to)}" r="${CELL * 0.40}" fill="none" stroke="#F59E0B" stroke-width="3"/>`;
        }
      }
    } else {
      // 提示有走法的己方棋子
      const froms = new Set(state.legal.map((m) => m.from));
      for (const f of froms) {
        hl += `<circle cx="${cx(f)}" cy="${cy(f)}" r="${CELL * 0.34}" fill="none" stroke="#F59E0B" stroke-width="2" opacity="0.6"/>`;
      }
    }
  }

  // 最后一手
  let last = '';
  if (state.lastMove >= 0) {
    last += `<rect x="${PAD + (state.lastMove % SIZE) * CELL}" y="${PAD + Math.floor(state.lastMove / SIZE) * CELL}" width="${CELL}" height="${CELL}" fill="none" stroke="#F59E0B" stroke-width="3" opacity="0.9"/>`;
  }

  // 棋子
  let pieces = '';
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = b[i];
    if (v === EMPTY) continue;
    const isRed = colorOf(v) === 1;
    const px = cx(i), py = cy(i);
    const fill = isRed ? 'var(--ck-piece-red, #E5484D)' : 'var(--ck-piece-black, #1E1B39)';
    const stroke = isRed ? 'var(--ck-piece-red-edge, #9B2C28)' : 'var(--ck-piece-black-edge, #000000)';
    pieces += `<circle class="ck-piece${animClassSuffix(anim, i)}"${animDelayStyle(anim, i)} cx="${px}" cy="${py}" r="${CELL * 0.40}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
    if (isKing(v)) {
      // 王：金环 + 中心金点
      pieces += `<circle cx="${px}" cy="${py}" r="${CELL * 0.40}" fill="none" stroke="var(--ck-king, #F5C518)" stroke-width="4"/>`;
      pieces += `<circle cx="${px}" cy="${py}" r="${CELL * 0.13}" fill="var(--ck-king, #F5C518)"/>`;
    }
  }

  // 命中区
  let hits = '';
  if (myTurn) {
    const targets = new Set<number>();
    // 有走法的己方棋子永远可点：负责「选中 / 改选 / 取消选中」。
    // 之前这里按 selected 二选一，选中后就再也点不到别的子，取消分支是死代码。
    // 与落点不重叠——引擎的 from 一定站着自己人、to 一定是空格或已吃掉的子。
    for (const m of state.legal) targets.add(m.from);
    if (state.selected >= 0) {
      for (const m of state.legal) if (m.from === state.selected) targets.add(m.to);
    }
    for (const t of targets) {
      const [r, c] = rowCol(t);
      hits += `<g class="ck-cell" data-i="${t}" style="cursor:pointer"><rect x="${PAD + c * CELL}" y="${PAD + r * CELL}" width="${CELL}" height="${CELL}" fill="transparent"/></g>`;
    }
  }

  boardEl.innerHTML = `<svg viewBox="0 0 ${SLOT} ${SLOT}" aria-label="Checkers board">
    <rect x="0" y="0" width="${SLOT}" height="${SLOT}" fill="var(--ck-plate, #FBF7EF)" rx="14"/>
    <rect x="${PAD}" y="${PAD}" width="${SLOT - 2 * PAD}" height="${SLOT - 2 * PAD}" fill="none" stroke="var(--ck-border, rgba(79,70,229,.25))" stroke-width="1.2"/>
    ${cells}${hl}${last}${pieces}${hits}
  </svg>`;
  boardEl.querySelectorAll<SVGGElement>('.ck-cell').forEach((g) => {
    g.addEventListener('click', () => onCell(Number(g.dataset.i)));
  });

  // 计分
  const red = countPieces(b, 1);
  const black = countPieces(b, 2);
  scoreEl.textContent = `${red} · ${black}`;
  renderHud();
  renderClockHud();
}

function renderHud(): void {
  const thinking = !state.over && state.aiThinking && state.mode === 'ai' && state.player === ENGINE;
  let label: string;
  if (state.over) label = window.t('bi.game_over');
  else if (state.mode === 'pass') label = state.player === HUMAN ? window.t('bg.bg_checkers_you_red_lc') : window.t('bg.bg_checkers_pass_black_lc');
  else if (state.mode === 'online') label = onlineMyTurn()
    ? window.t('bg.bg_checkers_online_you')
    : window.t('bg.bg_checkers_online_opp');
  else label = state.player === HUMAN
    ? window.t('bg.bg_checkers_you_red_lc')
    : (thinking ? 'Engine · ' + window.t('status.thinking') : window.t('bg.bg_checkers_engine_black_lc'));
  turnEl.textContent = label;
  turnEl.className = 'go-turn-you' + (thinking ? ' is-thinking' : '');

  const lvName = state.level === 'easy' ? window.t('bg.bg_checkers_lv1') :
    state.level === 'medium' ? window.t('bg.bg_checkers_lv2') : window.t('bg.bg_checkers_lv3');
  modeEl.textContent = state.mode === 'ai'
    ? window.t('bi.vs_ai_prefix') + ' ' + lvName
    : window.t('bi.pass_play');
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
    const myTurn = onlineMyTurn();
    clockMeCard.classList.toggle('is-active', !state.over && myTurn);
    clockOppCard.classList.toggle('is-active', !state.over && !myTurn && state.roomLive);
  }
  // 联机：对手侧不能一直写「引擎」。没进房显示「等待中」，进房后显示真实昵称。
  if (state.mode === 'online') {
    clockOppWho.textContent = state.roomLive && state.oppName
      ? state.oppName
      : window.t('bg.bg_common_waiting_opponent');
    clockMeWho.textContent = window.t('bg.bg_checkers_you_red');
  } else {
    // 非联机模式：原先靠 data-i18n 兜底，摘掉属性后由 JS 显式设回
    clockOppWho.textContent = window.t('bg.bg_checkers_engine_black');
  }
}

/* ====================== 走子交互 ====================== */
function onCell(i: number): void {
  if (state.over || state.aiThinking) return;
  if (state.mode === 'ai' && state.player !== HUMAN) return;
  if (state.mode === 'online' && !onlineMyTurn()) return;

  // 已选中且点中一个合法落点 → 执行走法
  if (state.selected >= 0) {
    const m = state.legal.find((x) => x.from === state.selected && x.to === i);
    if (m) { doMove(m); return; }
  }
  // 否则尝试选中一个己方有走法的棋子（再点同一个 = 取消选中）
  if (state.legal.some((x) => x.from === i)) {
    state.selected = state.selected === i ? -1 : i;
    render();
    return;
  }
  state.selected = -1;
  render();
}

function pushHistory(): void {
  state.history.push({ board: cloneBoard(state.board), player: state.player, lastMove: state.lastMove });
}

function doMove(m: Move): void {
  pushHistory();
  state.moveLog.push({ from: m.from, to: m.to });
  state.board = applyMove(state.board, m);
  state.lastMove = m.to;
  state.selected = -1;
  state.sinceCapture = m.captures.length > 0 ? 0 : state.sinceCapture + 1;
  playSfx('place');
  if (state.mode === 'online' && state.ws) {
    // 结构化走子原样发给服务端（games-room.js 按 {from,target,caps,kinged} 转发）
    sendWs(state as OnlineState, { type: 'move', mv: moveToWire(m), by: state.myIdx ?? 0 });
  }
  afterMove();
}

/**
 * 一步走完后的收尾。
 * @param nextPlayer 下一手方。联机收到 opponent_move 时必须显式传入：
 *   本方 state.player 早已停在「等自己走」的值上，再无条件翻转会把回合推给
 *   对手，双方同时显示「对手走」且都无子可走（2026-10-06 实测）。
 *   本地走子不传，走默认翻转。
 */
function afterMove(nextPlayer?: CPlayer): void {
  // 🔴 2026-10-15 修复：胜负判定必须查「下一手方」，不是「刚走完的那方」。
  //   修复前这里读 state.player，而 state.player 直到 :332 才翻转，于是：
  //   · 红吃掉黑最后一子 → 被检查的是红自己（还有子）→ 不判胜 → 玩家永久卡死
  //   AI 模式靠 aiMove():356-364 的 `if(!m)` 兜住了，pass / online 没有兜底。
  //   现在先算出真正的下一手方，再对它判胜负。
  const upcoming: CPlayer = nextPlayer ?? (state.player === 1 ? 2 : 1);

  // 胜负判定：下一手方无子或无合法步 → 刚走完的那方胜（即 upcoming 的对方）
  if (countPieces(state.board, upcoming) === 0 || moves(state.board, upcoming).length === 0) {
    state.over = true;
    state.selected = -1;
    stopTimer(state.timer);
    state.player = upcoming;
    render();
    finish(upcoming === HUMAN ? ENGINE : HUMAN);
    return;
  }
  // 无吃子 40 步判和
  if (state.sinceCapture >= 40) {
    state.over = true;
    state.selected = -1;
    stopTimer(state.timer);
    render();
    finish(0);
    return;
  }
  // 切换回合
  state.player = upcoming;
  state.legal = moves(state.board, state.player);
  render();
  if (state.mode === 'ai' && state.player === ENGINE && !state.over) {
    aiMove();
  }
}

/* ====================== AI ====================== */
let aiTimer = 0;
function cancelAiMove(): void {
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = 0; }
  state.aiThinking = false;
}
function aiMove(): void {
  if (aiTimer) clearTimeout(aiTimer);
  state.aiThinking = true;
  render();
  const base = AI_THINK_MS[state.level] ?? AI_THINK_MS.medium;
  const jitter = Math.round(base * (Math.random() * 0.24 - 0.12));
  aiTimer = window.setTimeout(() => {
    aiTimer = 0;
    state.aiThinking = false;
    if (state.over || state.screen !== 'match' || state.player !== ENGINE) { render(); return; }
    const m = bestMove(state.board, ENGINE, state.level);
    if (!m) {
      // 引擎无步 → 玩家胜
      state.over = true;
      stopTimer(state.timer);
      render();
      finish(HUMAN);
      return;
    }
    doMove(m);
  }, Math.max(160, base + jitter));
}

/* ====================== 终局 ====================== */
function finish(winner: CPlayer | 0): void {
  // 🔴 2026-10-23：联机下"我是否获胜"必须按本方座位换算颜色，不能假定自己是红。
  //   座位 0=红(1) / 座位 1=黑(2)（与 onlineMyTurn 同口径）；ai/pass 模式本方恒红。
  //   修复前 className/音效/分享快照全按 winner===HUMAN 判 —— 坐黑方的玩家
  //   在自己获胜时看到 is-loss 红字 + lose 音，分享卡还记成"未获胜"。
  const myColor: CPlayer = state.mode === 'online' ? (((state.myIdx ?? 0) + 1) as CPlayer) : HUMAN;
  const iWin = winner !== 0 && winner === myColor;
  // 2026-10-23 第三批：课堂联机上报（此前跳棋未接 teacher-track，课堂对局不计学情）
  if (state.mode === 'online' && isClassroom() && state.roomCode) {
    const dur = state.timer.startedAt ? Date.now() - state.timer.startedAt : 0;
    reportRound(state.roomCode, {
      round: 1, solved: iWin, duration_ms: dur,
      outcome: winner === 0 ? 'draw' : (iWin ? 'win' : 'loss'),
    });
  }
  let verdict: string;
  if (winner === 0) verdict = window.t('bi.draw');
  else if (state.mode === 'ai') verdict = iWin ? window.t('bi.you_win') : window.t('bi.ai_wins');
  else verdict = winner === HUMAN ? window.t('bg.bg_checkers_red_wins') : window.t('bg.bg_checkers_black_wins');

  const red = countPieces(state.board, 1);
  const black = countPieces(state.board, 2);
  endVerdict.textContent = verdict;
  endVerdict.className = 'go-end-verdict ' + (winner === 0 ? 'is-draw' : (iWin ? 'is-win' : 'is-loss'));
  endLine.textContent = `${window.t('bg.bg_checkers_pieces')} ${red} · ${black}`;
  snapshotResult(iWin);   // 终局快照给「分享结果」卡片
  playSfx(iWin ? 'win' : winner === 0 ? 'place' : 'lose');
  toast(verdict);
  if (endScreenTimer) window.clearTimeout(endScreenTimer);
  endScreenTimer = window.setTimeout(() => {
    if (state.over && state.screen === 'match') showScreen('end');
  }, 1200);
}

let endScreenTimer = 0;

/* ====================== 难度键 ====================== */
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

/* ====================== 音效键 ====================== */
function refreshSoundBtn(): void {
  soundBtn.classList.toggle('is-off', !sfxOn());
  soundBtn.setAttribute('aria-pressed', sfxOn() ? 'true' : 'false');
  soundBtn.setAttribute('aria-label', window.t(sfxOn() ? 'bg.bg_checkers_sound_on' : 'bg.bg_checkers_sound_off'));
  soundBtn.setAttribute('title', window.t(sfxOn() ? 'bg.bg_checkers_sound_on' : 'bg.bg_checkers_sound_off'));
}
soundBtn.addEventListener('click', () => {
  setSfx(!sfxOn());
  refreshSoundBtn();
  if (sfxOn()) playSfx('place');
});

/* ====================== 退出守卫 ====================== */
let backGuard = false;
let backLeaving = false;
let pendingLobbyNav = false;
function armBackGuard(): void {
  if (backGuard) return;
  history.pushState({ ckGuard: 1 }, '', location.href);
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
  history.pushState({ ckGuard: 1 }, '', location.href);
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

/* ====================== 结算页三键 ====================== */
// 联机再战必须先发 restart：否则只有本方重置，对手还停在结算屏，不知道又开了一局
rematchBtn.addEventListener('click', () => {
  if (state.mode === 'online') {
    if (state.ws) sendWs(state as OnlineState, { type: 'restart' });
    state.over = false; newGame(); return;
  }
  newGame();
});
endLobbyBtn.addEventListener('click', exitMatchToLobby);

/* 2026-10-06：分享结果 → Canvas 大图卡片（NumeriDuel 范式，可保存 PNG / 系统分享） */
let lastResult: { youWin: boolean; moves: number; durationSec: number } | null = null;
/** 终局时快照。跳棋没有 moves 数组，走子数取 history 长度 */
function snapshotResult(youWin: boolean): void {
  lastResult = {
    youWin,
    moves: state.history.length,
    durationSec: state.timer && state.timer.startedAt
      ? Math.max(1, Math.round((Date.now() - state.timer.startedAt) / 1000)) : 0,
  };
}
document.getElementById('ck-share')?.addEventListener('click', async () => {
  if (!lastResult) { toast(window.t('bg.bg_common_finish_first')); return; }
  const m = await import('../share-card');
  m.shareResult('Checkers', {
    youWin: lastResult.youWin,
    moves: lastResult.moves,
    durationSec: lastResult.durationSec,
    link: state.roomCode ? location.origin + '/b/checkers/' + state.roomCode : location.origin + '/games/checkers/',
    qrGame: state.roomCode ? 'checkers' : undefined,
    tone: lastResult.youWin ? 'wood' : 'indigo',
  });
});

/* ====================== 屏幕切换 ====================== */
function showScreen(s: 'match' | 'end'): void {
  state.screen = s;
  matchEl.hidden = s !== 'match';
  endEl.hidden = s !== 'end';
  if (s === 'match') document.body.classList.add('bd-in-match');
  else document.body.classList.remove('bd-in-match');
  render();
}

/* ====================== 新局 ====================== */
function newGame(): void {
  cancelAiMove();
  state.board = initialBoard();
  // 新局清空动画快照：否则从终局局面回到初始局面会全盘乱pop
  animPrevBoard = null;
  // 🔴 2026-10-23 P0/P1 修复：联机也曾按 myIdx 设开局轮次（seat 1 的黑方
  //   一开局就显示"轮到你"）。规则上红先，且服务端的先手由「首个合法走子者」
  //   确立（games-room.js relayCkTurn=-1 待定）——客户端若让黑方先走，
  //   服务端会把黑方记为先手，随后红方第一手被 not_your_turn 拒掉。
  //   与 rebuildFromServer（:621 从 HUMAN 起算）保持同一口径：永远红先。
  state.player = HUMAN;
  state.lastMove = -1;
  state.over = false;
  state.selected = -1;
  state.history = [];
  state.moveLog = [];
  state.sinceCapture = 0;
  state.aiThinking = false;
  state.legal = moves(state.board, state.player);
  // 联机：对手没进房时不启钟（2026-10-06）。由 applyRoomState 在 start 到达时再启动。
  if (state.mode !== 'online' || state.roomLive) {
    startTimer(state.timer, (ms) => { clockMeTime.textContent = fmtClock(ms); });
  }
  levelBtn.hidden = state.mode !== 'ai';
  undoBtn.hidden = state.mode === 'online';   // 联机下 undo 会污染对手棋盘（见 undo() 内注释）
  showScreen('match');
  armBackGuard();
}

/* ====================== 撤销 / 认输 ====================== */
function undo(): void {
  if (state.over) return;
  // 🔴 2026-10-15 新增：联机禁用（与 tictactoe 一致）。undo 不看是谁走的，
  //   能把对手的棋子从自己屏幕上撤掉，撤完双方回合判断分叉 → 永久卡房。
  if (state.mode === 'online') { toast(window.t('bj.undo_offline_only')); return; }
  cancelAiMove();
  if (state.history.length === 0) return;
  // AI 模式：玩家撤销后还要回退到玩家决策前（玩家 + AI 共 2 步）。
  // 修复前 AI 分支 pop 两次 history 却只重算一次 legal，语义不一致；
  // 现在统一按步数回退，最后统一重算合法步。
  const steps = state.mode === 'ai' && state.history.length >= 2 ? 2 : 1;
  for (let k = 0; k < steps; k++) {
    const last = state.history.pop()!;
    state.board = last.board;
    state.player = last.player;
    state.lastMove = last.lastMove;
    state.moveLog.pop();
  }
  state.selected = -1;
  state.legal = moves(state.board, state.player);
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
  // 🔴 2026-10-06：联机认输必须通知服务端，此前这里只 finish() 本地收尾。
  //   后果与 connect4 修掉的那个一模一样（connect4/index.ts:548 的注释记录了
  //   「那一批只补了 chess/xiangqi/tictactoe，checkers 被漏掉」）：
  //   对手永远不知情、服务端 status 停在 'playing'、**无 Elo 无金币结算**、
  //   房间不收尾，且认输后再战会被服务端的局中守卫拒掉。
  if (state.mode === 'online' && state.ws) {
    sendWs(state as OnlineState, { type: 'resign' });
  }
  state.over = true;
  cancelAiMove();
  stopTimer(state.timer);
  finish(state.mode === 'online'
    ? (state.player === 1 ? 2 : 1)
    : state.mode === 'ai' ? ENGINE : (state.player === HUMAN ? ENGINE : HUMAN));
}
undoBtn.addEventListener('click', undo);
resignBtn.addEventListener('click', resign);

/* ====================== 联机（好友房） ====================== */
/** 对手已进房才轮到本方：对手没来之前棋盘锁定（与 go 的 rankedLive 同义） */
function onlineMyTurn(): boolean {
  return state.roomLive && state.myIdx !== null && state.player === (state.myIdx + 1);
}

/**
 * 按服务端下发的着法历史重放恢复棋盘（刷新/重连后用）。
 * 着法格式与服务端 relayMoves 一致：{ mv: { from:{r,c}, target:{r,c}, caps, kinged } }。
 * sinceCapture（连续无吃子步数，达 40 判和）必须一起重算，否则重连后和棋判定会错。
 */
function rebuildFromServer(hist: { mv?: { from?: { r?: number; c?: number }; target?: { r?: number; c?: number }; caps?: number[] } }[]): void {
  cancelAiMove();
  let board = initialBoard();
  let player: CPlayer = HUMAN;
  let sinceCapture = 0;
  for (const w of hist) {
    const mv = w && w.mv;
    if (!mv || !mv.from || !mv.target) continue;
    const fr = Number(mv.from.r), fc = Number(mv.from.c);
    const tr = Number(mv.target.r), tc = Number(mv.target.c);
    if (!Number.isInteger(fr) || !Number.isInteger(tr)) continue;
    if (fr < 0 || fr >= SIZE || fc < 0 || fc >= SIZE || tr < 0 || tr >= SIZE || tc < 0 || tc >= SIZE) continue;
    const from = fr * SIZE + fc;
    const to = tr * SIZE + tc;
    if (!board[from]) continue;
    const captures = Array.isArray(mv.caps) ? mv.caps.slice() : [];
    board = applyMove(board, { from, to, captures, path: [] } as Move);
    sinceCapture = captures.length > 0 ? 0 : sinceCapture + 1;
    player = (player === RED_MAN ? BLACK_MAN : RED_MAN) as CPlayer;
  }
  state.board = board;
  state.player = player;
  state.sinceCapture = sinceCapture;
  state.lastMove = -1;
  state.selected = -1;
  state.history = [];
  state.over = false;
  state.legal = moves(board, player as CPlayer);
  render();
}

/** 从 state 帧取服务端着法历史并重放；两种 state 形状都要认。
 *  不按本地 history 设闸：服务端中继历史才是权威，且 rebuildFromServer 是幂等的。 */
function applyServerMoves(m: OnlineMsg): void {
  const inner = (m.state && typeof m.state === 'object') ? (m.state as OnlineMsg) : null;
  const mv = Array.isArray(m.moves) ? m.moves
    : (inner && Array.isArray(inner.moves) ? inner.moves : null);
  if (!mv || !mv.length) return;
  rebuildFromServer(mv as Parameters<typeof rebuildFromServer>[0]);
}

/** 本地 Move -> 服务端结构化走子（games-room.js 原样转发为 opponent_move） */
function moveToWire(m: Move): { from: { r: number; c: number }; target: { r: number; c: number }; caps: number[]; kinged: boolean } {
  const fr = Math.floor(m.from / SIZE), fc = m.from % SIZE;
  const tr = Math.floor(m.to / SIZE), tc = m.to % SIZE;
  const piece = state.board[m.from];
  const kinged = !isKing(piece) && ((piece === RED_MAN && tr === 0) || (piece === BLACK_MAN && tr === 7));
  return { from: { r: fr, c: fc }, target: { r: tr, c: tc }, caps: m.captures.slice(), kinged };
}

/** 吸收服务端的房间状态（state / start），驱动等待态与启钟。
 *  收到 start 表示对手已进房：此时才开表、才允许落子。 */
function applyRoomState(msg: OnlineMsg, viaStart: boolean): void {
  const live = viaStart || roomLiveFromState(msg);
  const wasLive = state.roomLive;
  state.roomLive = live;
  const name = opponentNameFromState(msg, state.myIdx);
  if (name) state.oppName = name;
  if (live && !wasLive) {
    // 双方到齐才启钟（chess.com 式）。此前 newGame 已把棋钟归零，这里接着走。
    startTimer(state.timer, (ms) => { clockMeTime.textContent = fmtClock(ms); });
  }
  render();
}

/** 接收对手走子 / 开局 / 终局广播（参考 tictactoe handleWs） */
function handleWs(msg: OnlineMsg): void {
  const t = String(msg.type || '');
  if (t === 'opponent_move') {
    const mv = msg.mv as { from?: { r: number; c: number }; target?: { r: number; c: number }; caps?: number[] } | undefined;
    if (mv && mv.from && mv.target) {
      const m: Move = {
        from: mv.from.r * SIZE + mv.from.c,
        to: mv.target.r * SIZE + mv.target.c,
        captures: Array.isArray(mv.caps) ? mv.caps.slice() : [],
        path: [],
      };
      // 走子前先记下对手颜色：afterMove() 的胜负判定读 state.player，
      // 不先对齐就会拿本方的子去判「无子判负」。
      // colorOf 对空格返回 0，这里兜底成黑方，保证类型与运行时都不越界。
      const oppColor = (colorOf(state.board[m.from]) === 1 ? 1 : 2) as CPlayer;
      pushHistory();
      // 把当前方对齐到刚走子的对手，判定与收尾才落在正确的一方
      state.player = oppColor;
      state.board = applyMove(state.board, m);
      state.lastMove = m.to;
      state.selected = -1;
      state.sinceCapture = m.captures.length > 0 ? 0 : state.sinceCapture + 1;
      playSfx('place');
      // 对手走完 → 轮到本方（英式跳棋黑先红后，颜色在 1/2 间交替）
      afterMove(oppColor === 1 ? 2 : 1);
    }
  } else if (t === 'start' || t === 'restart_notify') {
    newGame();
  } else if (t === 'opponent_leave') {
    toast(window.t('bg.bg_common_opponent_left'));
  } else if (t === 'game_over') {
    // 🔴 2026-10-15 修复：此前收到服务端终局帧只 state.over=true + render()，
    //   屏幕停在冻住的棋盘上 —— 没有胜负、没有「再战」按钮，结算屏从不弹。
    //   症状和对端「卡死」一模一样：对手认输后你这边永远走不下去。
    //   本页已有 finish()（能处理胜负/和棋三态并填结算屏 + 分享快照），
    //   这里只需把服务端帧归一化成胜负结果后转过去，不要另写一套结算逻辑。
    //   口径说明：服务端 relay 模式的 game_over 有两种形状 ——
    //     认输 { kind:'resign', winner:'红'|'黑', by: 座位号 }
    //     提和 { kind:'draw', reason:'双方同意' }  ← 无 winner 字段
    //   parseGameOver 同时认 winner:'draw' 与 kind:'draw'，见 shared/game-over.ts。
    state.over = true;
    stopTimer(state.timer);
    const go = parseGameOver(msg);
    render();
    // winner 是座位号，需要换算成本页的颜色（1=红 / 2=黑）。
    // 座位映射有源码依据：:609 onlineMyTurn() 判的是
    //   state.player === (state.myIdx + 1) → 座位 0 对应玩家 1（红），座位 1 对应 2（黑）。
    // 🔴 2026-10-23 P0 修复：这里曾写成 winnerSeat===0 ? 2 : 1（与注释口径相反）——
    //   座位 0（红）认输后服务端判座位 1 胜，旧代码映射成 1=红，
    //   于是认输方与自己对手两侧屏幕都显示"红方胜"，判词整体反转。
    // 拿不到座位号时不能瞎猜 —— 中性判和由 finish(0) 呈现，比猜错颜色安全。
    const winnerSeat = typeof go.winner === 'number' ? go.winner : null;
    const winner: CPlayer | 0 = go.draw
      ? 0
      : winnerSeat !== null
        ? (winnerSeat === 0 ? 1 : 2) as CPlayer
        : 0;
    finish(winner);
  }
}

/**
 * 服务端拒了刚走的那一步（not_your_turn / illegal_move …）→ 回到走之前。
 * 跳棋本来就是中继模式 + 服务端强制轮次，被拒不回滚的话：
 * 本地子已经落下、回合已翻，对手那边看不到这一步，两边从此错位。
 * （既有 onError 只弹了提示，棋盘留着那一步 —— 症状是「棋子上去了但下不动」。）
 */
function rollbackRejected(): void {
  const last = state.history.pop();
  if (last) {
    state.board = last.board;
    state.player = last.player;
    state.lastMove = last.lastMove;
  }
  state.selected = -1;
  state.over = false;
  render();
  toast(window.t('bg.bg_common_move_rejected'));
}

function roomHandlers(code: string) {
  return {
    // 重连也会再走 onConnect。清盘会让重连瞬间本地局面被抹掉、顺带重置时钟与历史。
    onConnect: () => { if (!state.history.length) newGame(); toast(window.t('bg.bg_common_connected_room', { code })); },
    onReconnect: () => { toast(window.t('bg.bg_common_reconnected')); render(); },
    // 重连次数用尽：棋盘保持锁定（服务端状态未知，不能瞎走），但必须给一句出路
    onReconnectFailed: (c: string) => { toast(window.t('bg.bg_common_reconnect_failed', { code: c }), 9000); render(); },
    onOpponentMove: handleWs,
    onStart: (m: OnlineMsg) => { newGame(); applyRoomState(m, true); },
    onState: (m: OnlineMsg) => { applyServerMoves(m); applyRoomState(m, false); },
    onOpponentLeave: () => { state.roomLive = false; toast(window.t('bg.bg_common_opponent_left')); render(); },
    // 断线：online-core 已把 roomLive 置 false，这里锁盘并给一句可见提示
    onDisconnect: () => { toast(window.t('match.disconnected')); render(); },
    onRestart: () => newGame(),
    onGameOver: handleWs,
    // 服务端在 2026-10-06 起强制轮次；被拒时回滚 + 给出可读原因，而不是静默无反应
    onError: (m: OnlineMsg) => {
      const code = String((m.code as string) || (m.message as string) || '');
      if (isMoveRejected(m)) rollbackRejected();
      if (code === 'not_your_turn') toast(window.t('bg.bg_checkers_not_your_turn'));
      else if (code) toast(code);
    },
  };
}

function startFriendRoom(): void {
  state.mode = 'online';   // 先置 online：空盘等友期间不排 AI 落子
  newGame();
  void openFriendRoom('checkers', 'ck', {
    enter: (code) => {
      enterRoom(state as OnlineState, code, roomHandlers(code));
    },
    onFail: () => { window.setTimeout(() => { location.replace(MODE_PAGE); }, 1400); },
  });
}

const ic = inviteCode();
const wantsFriend = (() => {
  try { return (new URLSearchParams(location.search).get('mode') || '').toLowerCase() === 'friend'; }
  catch { return false; }
})();

/* ====================== 模式与深链 ====================== */
const _initialMode: Mode = modeFromUrl('ai');
state.mode = ic || wantsFriend ? 'online' : _initialMode;

/* ====================== 启动 ====================== */

const keepAlive = () => { unlockSfx(); };
window.addEventListener('pointerdown', keepAlive, { capture: true, passive: true });
window.addEventListener('touchstart', keepAlive, { capture: true, passive: true });
window.addEventListener('mousedown', keepAlive, { capture: true, passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) unlockSfx(); });
refreshSoundBtn();
wireLobbyChrome();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.screen === 'match') exitMatchToLobby();
});

/* 2026-10-06 补齐：?c=/?room=/?code= 进好友房；?mode=friend 建房；否则 ai/pass 起局
   （此前 checkers 完全无在线：大厅 4 张卡是假入口，前端零 WebSocket 代码） */
if (ic) {
  state.mode = 'online';
  // 课堂房间：先进代号弹窗确保学生身份，再进房（reportRound 依赖学生代号，缺了上报会被服务端丢弃）
  const classroomHook = isClassroom() && urlRoomCode() === ic ? ensureStudentCode(ic) : Promise.resolve(null);
  void classroomHook.then(() => {
    enterRoom(state as OnlineState, ic, roomHandlers(ic));
  });
  clearInviteParam();
} else if (wantsFriend) {
  startFriendRoom();
} else {
  newGame();
}
// i18n 字典异步 fetch 兜底
setTimeout(() => render(), 250);

/** 8×8 棋盘坐标（a1 视角）：列 a-h + 行 8-1 */
const ckCoord = (i: number): string => 'abcdefgh'[i % 8] + String(8 - Math.floor(i / 8));

/* ======================
 * 棋谱导出（2026-10-24 第四批）
 * 西洋跳棋 PDN 方言众多，先导出编号着法文本（起点-终点，a1 视角坐标）。
 * ====================== */
mountExportButton({
  game: 'checkers',
  ext: 'txt',
  build: (verdict) => (state.moveLog.length
    ? buildMoveList({
        title: 'BoardDuel · Checkers',
        moves: state.moveLog.map((m) => `${ckCoord(m.from)}-${ckCoord(m.to)}`),
        result: verdict,
        meta: ['files a-h (left to right), ranks 8-1 (bottom to top)'],
      })
    : null),
});
