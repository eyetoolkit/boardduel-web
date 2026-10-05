/**
 * BoardDuel · Xiangqi (中国象棋, 9×10) · arena 范式拷贝（2026-10-04）
 * ------------------------------------------------------------
 * 镜像 chess 的 11 项范式（三屏 / 双棋钟 / AI 难度 / 退出守卫 / 终局延迟 /
 * 音效 / 棋谱回放 / 链接房），仅替换规则引擎与棋盘渲染。
 *
 * 差异：
 *   · 棋盘 9×10，含河界 + 九宫斜线，棋子为汉字圆牌
 *   · 红方先走（= human in AI 模式），黑方为引擎
 *   · 着法用 0-89 索引（非代数记号）；评估函数 evaluate() 可插拔
 *
 * 引擎：src/games/xiangqi/engine.ts（自研规则 + αβ + 子力位置表 + 静态搜索，MIT 干净）
 */
import {
  setupNav, startTimer, stopTimer, createTimer, fmtClock,
  toast, type Mode, type Difficulty,
} from '../game-core';
import { wireLobbyChrome } from '../../lobby-chrome';
import {
  createGame, cloneState, legalMoves, applyMove, search, isOver, isKingSafe,
  newArbiter, arbiterPush, arbiterVerdict,
  type GameState, type Side, type Move, type Arbiter,
} from './engine';
import {
  enterRoom, sendWs, inviteCode, clearInviteParam,
  type OnlineState, type OnlineMsg,
} from '../online-core';
import { modeFromUrl, syncModeCardUI } from '../shared';
import { openFriendRoom } from '../friend-room';
import { reportRound, isClassroom, urlRoomCode, ensureStudentCode } from '../../shared/teacher-track';
import { playSfx, sfxOn, setSfx, unlockSfx } from '../../shared/sfx';

/* ======================
 * 棋盘常量（9×10 交叉点）
 * ====================== */
const PAD = 24;
const CELL = 50;
const COLS = 9, ROWS = 10;
const BW = 2 * PAD + (COLS - 1) * CELL;
const BH = 2 * PAD + (ROWS - 1) * CELL;

const GLYPH: Record<number, [string, string]> = {
  // typeRank -> [red, black]
  [7]: ['帅', '将'],
  [6]: ['仕', '士'],
  [5]: ['相', '象'],
  [4]: ['马', '马'],
  [3]: ['车', '车'],
  [2]: ['炮', '炮'],
  [1]: ['兵', '卒'],
};

/* ======================
 * DOM 引用
 * ====================== */
const boardEl = document.getElementById('bd-board') as HTMLDivElement;
const turnEl = document.getElementById('xq-turn') as HTMLElement;
const lastEl = document.getElementById('xq-last') as HTMLElement;
const modeEl = document.getElementById('xq-mode-v') as HTMLElement;
const undoBtn = document.getElementById('xq-undo') as HTMLButtonElement;
const resignBtn = document.getElementById('xq-resign') as HTMLButtonElement;
const levelBtn = document.getElementById('xq-level') as HTMLButtonElement;
const levelCard = document.getElementById('xq-levelcard') as HTMLElement;
const levelClose = document.getElementById('xq-level-close') as HTMLButtonElement;
const replayBtn = document.getElementById('xq-replay') as HTMLButtonElement;
const soundBtn = document.getElementById('xq-sound') as HTMLButtonElement;
const replayBar = document.getElementById('xq-replaybar') as HTMLElement;
const rpFirst = document.getElementById('xq-rp-first') as HTMLButtonElement;
const rpPrev = document.getElementById('xq-rp-prev') as HTMLButtonElement;
const rpPlay = document.getElementById('xq-rp-play') as HTMLButtonElement;
const rpNext = document.getElementById('xq-rp-next') as HTMLButtonElement;
const rpLast = document.getElementById('xq-rp-last') as HTMLButtonElement;
const rpExit = document.getElementById('xq-rp-exit') as HTMLButtonElement;
const rpRange = document.getElementById('xq-rp-range') as HTMLInputElement;
const rpPos = document.getElementById('xq-rp-pos') as HTMLElement;
const matchEl = document.getElementById('xq-match') as HTMLElement;
const endEl = document.getElementById('xq-end') as HTMLElement;
const endVerdict = document.getElementById('xq-end-verdict') as HTMLElement;
const endLine = document.getElementById('xq-end-line') as HTMLElement;
const rematchBtn = document.getElementById('xq-rematch') as HTMLButtonElement;
const reviewBtn = document.getElementById('xq-review') as HTMLButtonElement;
const endLobbyBtn = document.getElementById('xq-end-lobby') as HTMLButtonElement;
const leaveCard = document.getElementById('xq-leavecard') as HTMLElement;
const leaveClose = document.getElementById('xq-leave-close') as HTMLButtonElement;
const leaveStay = document.getElementById('xq-leave-stay') as HTMLButtonElement;
const leaveYes = document.getElementById('xq-leave-yes') as HTMLButtonElement;
const backLobbyBtn = document.getElementById('xq-back-lobby') as HTMLButtonElement;
const clockMeTime = document.getElementById('go-clock-me-time') as HTMLElement;
const clockMeCard = document.getElementById('go-clock-me') as HTMLElement;
const clockOppCard = document.getElementById('go-clock-opp') as HTMLElement;

setupNav('xiangqi');

/* ======================
 * 状态
 * ====================== */
type UIState = {
  screen: 'match' | 'end';
  mode: Mode;
  level: Difficulty;
  gs: GameState;
  selected: number;
  lastMove: Move | null;
  over: boolean;
  history: GameState[];
  moves: Move[];
  timer: ReturnType<typeof createTimer>;
  aiThinking: boolean;
  reviewAt: number | null;
  replayPlaying: boolean;
  ws: WebSocket | null;
  roomCode: string | null;
  myIdx: number | null;
  sawGameOver: boolean;
  arb: Arbiter;
};

const state: UIState = {
  screen: 'match',
  mode: 'ai',
  level: 'medium',
  gs: createGame(),
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
  myIdx: null,
  sawGameOver: false,
  arb: newArbiter(),
};

const MODE_PAGE = '/games/xiangqi/lobby/';

/* ======================
 * 工具
 * ====================== */
function pointXY(sq: number): [number, number] {
  const c = sq % COLS;
  const r = (sq / COLS) | 0;
  return [PAD + c * CELL, PAD + r * CELL];
}
function myColor(): Side { return state.mode === 'ai' ? 1 : (state.myIdx === 0 ? 1 : -1); }
function humanSide(): Side {
  return state.mode === 'ai' ? 1 : state.gs.side;
}
function pieceChar(code: number): string {
  const t = Math.abs(code);
  const g = GLYPH[t];
  return g ? g[code > 0 ? 0 : 1] : '';  // 空格(0)无字形：返回空串，不要抛异常
}
function coord(sq: number): string {
  const c = sq % COLS;
  const r = (sq / COLS) | 0;
  const file = String.fromCharCode(97 + c);   // a..i
  const rank = ROWS - r;                       // red perspective 1..10
  return file + rank;
}
/**
 * 着法文字（如 "兵 a7→a6"）。
 * ⚠️ 不能用 `state.gs.board[m.from]` 取子：走完子后 from 格已空(=0)，
 *    GLYPH[0] 是 undefined → TypeError 抛在 render() 里 →
 *    afterMove() 在调用 aiMove() 之前就中断 → 黑方永远不动、红方计时继续。
 *    必须回放到"这一步之前"的局面再取子。
 */
function moveLabel(m: Move): string {
  const i = state.reviewAt !== null ? state.reviewAt : state.moves.length - 1;
  let g = createGame();
  for (let k = 0; k < Math.max(0, i); k++) g = applyMove(g, state.moves[k]);
  const ch = pieceChar(g.board[m.from]);
  return (ch ? ch + ' ' : '') + coord(m.from) + '→' + coord(m.to);
}
function legalFor(s: GameState): Move[] { return legalMoves(s.board, s.side); }

/** viewBoard：按 reviewAt 重放 moves */
function viewBoard(moves: Move[], reviewAt: number | null): { gs: GameState; lastMove: Move | null } {
  let g = createGame();
  const n = reviewAt === null ? moves.length : reviewAt + 1;
  let last: Move | null = null;
  for (let k = 0; k < Math.min(n, moves.length); k++) {
    g = applyMove(g, moves[k]);
    last = moves[k];
  }
  return { gs: g, lastMove: last };
}

/* ======================
 * 渲染
 * ====================== */
function render(): void {
  const { gs: viewGs, lastMove } = viewBoard(state.moves, state.reviewAt);
  const renderGs = state.reviewAt !== null ? viewGs : state.gs;
  const lm = state.reviewAt !== null ? lastMove : state.lastMove;

  const canInteract = !state.over &&
    (state.mode === 'ai' ? humanSide() === state.gs.side
      : state.mode === 'online' ? state.gs.side === myColor()
        : true)
    && state.reviewAt === null
    && !state.aiThinking;

  // ── 棋盘线（木纹底 + 横竖线 + 河界 + 九宫斜线）──
  const line = '#6B4F2A';
  const lw = 1.4;
  let grid = `<rect x="0" y="0" width="${BW}" height="${BH}" fill="#EFD9A8"/>`;
  // 横线 10 条
  for (let r = 0; r < ROWS; r++) {
    const y = PAD + r * CELL;
    grid += `<line x1="${PAD}" y1="${y}" x2="${PAD + (COLS - 1) * CELL}" y2="${y}" stroke="${line}" stroke-width="${lw}"/>`;
  }
  // 竖线：外两条贯通，内七条在河界断开
  for (let c = 0; c < COLS; c++) {
    const x = PAD + c * CELL;
    if (c === 0 || c === COLS - 1) {
      grid += `<line x1="${x}" y1="${PAD}" x2="${x}" y2="${PAD + (ROWS - 1) * CELL}" stroke="${line}" stroke-width="${lw}"/>`;
    } else {
      grid += `<line x1="${x}" y1="${PAD}" x2="${x}" y2="${PAD + 4 * CELL}" stroke="${line}" stroke-width="${lw}"/>`;
      grid += `<line x1="${x}" y1="${PAD + 5 * CELL}" x2="${x}" y2="${PAD + (ROWS - 1) * CELL}" stroke="${line}" stroke-width="${lw}"/>`;
    }
  }
  // 九宫斜线（上 0-2，下 7-9；列 3-5）
  const diag = (r0: number, r1: number) => {
    const y0 = PAD + r0 * CELL, y1 = PAD + r1 * CELL;
    const x3 = PAD + 3 * CELL, x5 = PAD + 5 * CELL;
    grid += `<line x1="${x3}" y1="${y0}" x2="${x5}" y2="${y1}" stroke="${line}" stroke-width="${lw}"/>`;
    grid += `<line x1="${x5}" y1="${y0}" x2="${x3}" y2="${y1}" stroke="${line}" stroke-width="${lw}"/>`;
  };
  diag(0, 2); diag(7, 9);
  // 河界文字
  grid += `<text x="${PAD + 1.5 * CELL}" y="${PAD + 4.5 * CELL}" fill="${line}" font-size="20" font-family="serif" opacity=".6">楚 河</text>`;
  grid += `<text x="${PAD + 5.5 * CELL}" y="${PAD + 4.5 * CELL}" fill="${line}" font-size="20" font-family="serif" opacity=".6">漢 界</text>`;

  // 上一步标记
  let lastMark = '';
  if (lm) {
    for (const sq of [lm.from, lm.to]) {
      const [x, y] = pointXY(sq);
      lastMark += `<circle cx="${x}" cy="${y}" r="6" fill="rgba(245,158,11,.5)"/>`;
    }
  }

  // 选中 + 可走目标
  let selMarks = '';
  let hitAreas = '';
  if (canInteract && state.selected >= 0) {
    const [sx, sy] = pointXY(state.selected);
    selMarks += `<rect x="${sx - CELL / 2}" y="${sy - CELL / 2}" width="${CELL}" height="${CELL}" fill="rgba(245,158,11,.28)"/>`;
    const moves = legalFor(state.gs).filter((m) => m.from === state.selected);
    for (const m of moves) {
      const [mx, my] = pointXY(m.to);
      const cap = renderGs.board[m.to] !== 0;
      selMarks += cap
        ? `<circle cx="${mx}" cy="${my}" r="${CELL / 2 - 3}" fill="none" stroke="#F59E0B" stroke-width="2.5"/>`
        : `<circle cx="${mx}" cy="${my}" r="6" fill="#F59E0B"/>`;
    }
  }

  if (canInteract) {
    const moves = legalFor(state.gs);
    if (state.selected < 0) {
      const fromSqs = new Set(moves.map((m) => m.from));
      for (const sq of fromSqs) {
        const [x, y] = pointXY(sq);
        hitAreas += `<g class="xq-pt" data-sq="${sq}" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="${CELL * 0.5}" fill="transparent"/></g>`;
      }
    } else {
      for (const m of moves.filter((m) => m.from === state.selected)) {
        const [mx, my] = pointXY(m.to);
        hitAreas += `<g class="xq-pt" data-to="${m.to}" data-from="${state.selected}" style="cursor:pointer"><circle cx="${mx}" cy="${my}" r="${CELL * 0.5}" fill="transparent"/></g>`;
      }
    }
  }

  // 棋子（汉字圆牌）
  let pieces = '';
  for (let i = 0; i < renderGs.board.length; i++) {
    const p = renderGs.board[i];
    if (p === 0) continue;
    const [x, y] = pointXY(i);
    const isRed = p > 0;
    const col = isRed ? '#C0392B' : '#1A1A1A';
    const diskR = CELL * 0.42;
    pieces += `<g class="xq-piece" pointer-events="none">
      <circle cx="${x}" cy="${y}" r="${diskR}" fill="#F7E8C8" stroke="${col}" stroke-width="2"/>
      <circle cx="${x}" cy="${y}" r="${diskR - 3}" fill="none" stroke="${col}" stroke-width="0.8"/>
      <text x="${x}" y="${y}" dy="0.36em" text-anchor="middle" font-size="${CELL * 0.6}" font-family="'KaiTi','STKaiti',serif" fill="${col}" font-weight="700">${pieceChar(p)}</text>
    </g>`;
  }

  boardEl.innerHTML = `<svg viewBox="0 0 ${BW} ${BH}" aria-label="Xiangqi board" style="max-width:${BW}px;width:100%;height:auto">
    ${grid}${lastMark}${selMarks}${pieces}${hitAreas}
  </svg>`;

  boardEl.querySelectorAll<SVGGElement>('.xq-pt').forEach((g) => {
    g.addEventListener('click', () => {
      const sq = g.dataset.sq;
      const to = g.dataset.to;
      const from = g.dataset.from;
      if (sq !== undefined) {
        state.selected = Number(sq);
        render();
      } else if (to !== undefined && from !== undefined) {
        const m = legalFor(state.gs).find((mm) => mm.from === Number(from) && mm.to === Number(to));
        if (m) doMove(m);
      }
    });
  });

  lastEl.textContent = lm ? moveLabel(lm) : '—';
  renderHud();
  renderClockHud();
}

function renderHud(): void {
  const thinking = !state.over && state.aiThinking && state.mode === 'ai' && state.gs.side === -1;
  let label: string;
  if (state.reviewAt !== null) {
    label = window.t('bg.bg_xq_replay');
  } else if (state.over) {
    label = window.t('bi.game_over');
  } else if (state.mode === 'pass') {
    label = state.gs.side === 1 ? window.t('bg.bg_xq_red_turn') : window.t('bg.bg_xq_black_turn');
  } else if (state.mode === 'online') {
    label = state.gs.side === myColor() ? window.t('bg.bg_xq_you_red') : window.t('bg.bg_xq_opp_black');
  } else {
    label = state.gs.side === 1
      ? window.t('bg.bg_xq_you_red')
      : (thinking ? window.t('bg.bg_xq_engine_black') + ' · ' + window.t('status.thinking') : window.t('bg.bg_xq_engine_black'));
  }
  // 将军提示（R2）
  const inCheck = !state.over && state.reviewAt === null && !isKingSafe(state.gs.board, state.gs.side);
  turnEl.textContent = inCheck ? label + ' · ' + window.t('bg.bg_xq_check') : label;
  turnEl.className = 'go-turn-you' + (thinking ? ' is-thinking' : '') + (inCheck ? ' is-check' : '');

  const lvName = state.level === 'easy' ? window.t('bg.bg_xq_lv1') :
                  state.level === 'medium' ? window.t('bg.bg_xq_lv2') :
                  window.t('bg.bg_xq_lv3');
    modeEl.textContent = state.mode === 'ai'
    ? window.t('bi.vs_ai_prefix') + ' ' + lvName
    : state.mode === 'pass' ? window.t('bi.pass_play')
    : window.t('bi.online') + (state.roomCode ? ' · ' + state.roomCode : '');
}

function renderClockHud(): void {
  if (state.mode === 'ai') {
    clockMeCard.classList.toggle('is-active', !state.over && state.gs.side === 1 && !state.aiThinking);
    clockOppCard.classList.toggle('is-active', !state.over && (state.gs.side === -1 || state.aiThinking));
  } else {
    clockMeCard.classList.toggle('is-active', false);
    clockOppCard.classList.toggle('is-active', false);
  }
}

/* ======================
 * 落子
 * ====================== */
function doMove(m: Move): void {
  state.history.push(cloneState(state.gs));
  state.moves.push(m);
  state.gs = applyMove(state.gs, m);
  arbiterPush(state.arb, state.gs.board, state.gs.side, m);
  state.lastMove = m;
  state.selected = -1;
  playSfx('place');
  if (state.mode === 'online' && state.ws) {
    sendWs(state as OnlineState, { type: 'move', from: m.from as unknown as string, to: m.to as unknown as string } as OnlineMsg);
  }
  afterMove();
}

/** 悔棋/回放后按当前着法序列重建仲裁器（保证重复局面与长将计数正确） */
function rebuildArbiter(): void {
  const a = newArbiter();
  let g = createGame();
  for (const m of state.moves) {
    g = applyMove(g, m);
    arbiterPush(a, g.board, g.side, m);
  }
  state.arb = a;
}

function afterMove(): void {
  const over = isOver(state.gs.board, state.gs.side);
  if (over.over) {
    state.over = true;
    stopTimer(state.timer);
    render();
    finish(over.winner);
    return;
  }
  // 和棋 / 长将判负
  const v = arbiterVerdict(state.arb);
  if (v.draw || v.loser) {
    state.over = true;
    stopTimer(state.timer);
    render();
    if (v.reason === 'perpetual_check') toast(window.t('bg.bg_xq_perp_check'));
    finish(v.loser ? ((-v.loser) as Side) : 0);
    return;
  }
  render();
  if (state.mode === 'ai' && state.gs.side === -1 && !state.aiThinking) {
    aiMove();
  }
}

/* ======================
 * AI 思考节奏
 * ====================== */
const AI_THINK_MS: Record<Difficulty, number> = { easy: 250, medium: 500, hard: 1000 };
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
    if (state.over || state.screen !== 'match' || state.reviewAt !== null || state.gs.side !== -1) {
      render();
      return;
    }
    // 用引擎自带的难度时间预算（easy 350 / medium 800 / hard 1600），不要再硬编码覆盖
    let m: Move | null = null;
    try {
      m = search(state.gs, state.level).move;
    } catch (e) {
      console.error('[xiangqi] search failed', e);
    }
    // 兜底：搜索异常或返回空时随机走一步合法着法，绝不让黑方卡住不动
    if (!m) {
      const ms2 = legalFor(state.gs);
      if (!ms2.length) { render(); return; }
      m = ms2[Math.floor(Math.random() * ms2.length)];
    }
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

function finish(winner: Side | 0): void {
  if (state.mode === 'online' && isClassroom() && state.roomCode) {
    const dur = state.timer ? Date.now() - state.timer.startedAt : 0;
    const meWon = winner === myColor();
    reportRound(state.roomCode, {
      round: 1, solved: !!meWon, duration_ms: dur,
      outcome: meWon ? 'win' : 'loss',
    });
  }

  // 和棋：三次重复局面 / 自然限着
  if (winner === 0) {
    endVerdict.textContent = window.t('bg.bg_xq_draw');
    endVerdict.className = 'go-end-verdict is-draw';
    endLine.textContent = window.t('bg.bg_xq_draw_line');
    playSfx('place');
    toast(window.t('bg.bg_xq_draw'));
    scheduleEndScreen();
    return;
  }

  const meWon = winner === myColor();
  const verdict = meWon ? window.t('bg.bg_xq_you_win') : window.t('bg.bg_xq_you_lose');
  const line = window.t(meWon ? 'bg.bg_xq_win_line' : 'bg.bg_xq_lose_line');
  endVerdict.textContent = verdict;
  endLine.textContent = line;
  endVerdict.className = 'go-end-verdict ' + (meWon ? 'is-win' : 'is-loss');
  playSfx(meWon ? 'win' : 'lose');
  toast(verdict);
  scheduleEndScreen();
}

/* ======================
 * 棋谱回放
 * ====================== */
let replayTimer = 0;
const REPLAY_MS = 900;

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
  state.lastMove = state.moves.length ? state.moves[state.moves.length - 1] : null;
  state.selected = -1;
  // AI 模式：玩家撤销后还要回退到玩家回合
  if (state.mode === 'ai' && state.history.length >= 1) {
    state.gs = state.history.pop()!;
    state.moves.pop();
    state.lastMove = state.moves.length ? state.moves[state.moves.length - 1] : null;
  }
  rebuildArbiter();
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
  endVerdict.textContent = window.t('bg.bg_xq_you_resigned');
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
  soundBtn.setAttribute('aria-label', window.t(sfxOn() ? 'bg.bg_xq_sound_on' : 'bg.bg_xq_sound_off'));
  soundBtn.setAttribute('title', window.t(sfxOn() ? 'bg.bg_xq_sound_on' : 'bg.bg_xq_sound_off'));
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
  history.pushState({ xqGuard: 1 }, '', location.href);
  backGuard = true;
}
function disarmBackGuard(): void {
  if (!backGuard) return;
  backGuard = false;
  pendingLobbyNav = false;
}
function leaveRoom(): void {
  if (state.ws) { try { state.ws.close(); } catch (e) { /* ignore */ } state.ws = null; }
  state.roomCode = null;
  state.myIdx = null;
}
window.addEventListener('popstate', () => {
  if (backLeaving) { backLeaving = false; return; }
  if (!backGuard) return;
  history.pushState({ xqGuard: 1 }, '', location.href);
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
  state.gs = createGame();
  state.selected = -1;
  state.lastMove = null;
  state.over = false;
  state.history = [];
  state.moves = [];
  state.arb = newArbiter();
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
function handleWs(msg: OnlineMsg): void {
  const t = String(msg.type || '');
  if (t === 'opponent_move') {
    const from = msg.from, to = msg.to;
    if (typeof from === 'number' && typeof to === 'number') {
      const m: Move = { from, to, cap: state.gs.board[to] };
      state.history.push(cloneState(state.gs));
      state.moves.push(m);
      state.gs = applyMove(state.gs, m);
      arbiterPush(state.arb, state.gs.board, state.gs.side, m);
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
function roomHandlers(code: string) {
  return {
    onConnect: () => { newGame(); toast('Connected · room ' + code); },
    onOpponentMove: handleWs,
    onStart: () => newGame(),
    onRestart: () => newGame(),
    onOpponentLeave: () => toast('Opponent left'),
    onGameOver: handleWs,
  };
}

function startFriendRoom(): void {
  state.mode = 'online';   // 先置 online：空盘等友期间不排 AI 落子（enterRoom 会再置一次）
  newGame();
  void openFriendRoom('xiangqi', 'xq', {
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
