/**
 * BoardDuel · Go（围棋）演示页（W2.3 · human vs AI）
 *
 * 范围：在 W2.2 pass-and-play 基础上，把"对方"接成 ai.ts 的 easy/medium。
 *   · 模式：2 Players（pass-and-play）/ vs AI（你执黑先手，AI 执白）
 *   · 难度：Easy（随机优先吃子）/ Medium（1-ply 启发式）
 *   · AI 思考态：turn 行显示 "AI · thinking…" + 呼吸动画；落子节奏 AI_THINK_MS + ±12% 抖动
 *   · 取消挂起 AI 步：悔棋 / 新局 / 切模式 / 切尺寸 时清掉挂起的 setTimeout（否则凭空多子）
 *   · 终局：双 pass 触发中国规则数目 → 结果横幅（胜方 + 净胜目数）
 *   · 落子/提子动画、悔棋、9/13/19 切换、hover 幽灵（仅人类回合）沿用 W2.2
 *
 * 下一步(W3)：接入 arena 范式（中日棋钟 / 难度选择 / 退出守卫 / 结算页 / 6 语言 i18n）。
 *   本文件届时整体迁移进 arena 三段式，布局类(.go-demo-*) 由 arena 类替换。
 */
import { setupNav } from '../game-core';
import { wireLobbyChrome } from '../../lobby-chrome';
import {
  initialState, play, pass, notation, opponent, scoreChinese,
  type GoState, type Player,
} from './engine';
import { renderGoBoardSVG, diffCaptures } from './render';
import { bestMove, type Difficulty } from './ai';

setupNav('go');
wireLobbyChrome();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const boardEl = $<HTMLDivElement>('bd-board');

const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

type Size = 9 | 13 | 19;
let size: Size = 19;
let state: GoState = initialState(size);
let history: GoState[] = [];
let ghost = -1;
let moveToken = 0;

/* ── W2.3 新增：模式 / 难度 / AI 思考态 ── */
type Mode = 'pass' | 'ai';
let mode: Mode = 'pass';
let difficulty: Difficulty = 'medium';
const humanColor: Player = 1;                 // 人类执黑先手
const aiColor: Player = opponent(humanColor);  // AI 执白
let aiThinking = false;
let aiTimer: number | null = null;
let aiHasMoved = false;                         // 用于"开局 AI 思考加时"
let gameOver = false;

const AI_THINK_MS: Record<Difficulty, number> = { easy: 480, medium: 760 };

const turnEl = $<HTMLElement>('go-turn');
const moveEl = $<HTMLElement>('go-move');
const capBEl = $<HTMLElement>('go-cap-b');
const capWEl = $<HTMLElement>('go-cap-w');
const lastEl = $<HTMLElement>('go-last');
const metaSizeEl = $<HTMLElement>('go-meta-size');
const resultEl = $<HTMLElement>('go-result');

function clearAiTimer(): void {
  if (aiTimer !== null) { window.clearTimeout(aiTimer); aiTimer = null; }
  aiThinking = false;
}

function renderBoard(opts?: { placed?: number; captured?: number[]; capturedColor?: Player }): void {
  boardEl.innerHTML = renderGoBoardSVG({
    size,
    board: state.board,
    lastMove: state.lastMove,
    placed: opts?.placed ?? -1,
    captured: opts?.captured ?? [],
    capturedColor: opts?.capturedColor ?? 2,
    ghost,
    interactive: true,
  });
  updateInfo();
}

function turnLabel(): string {
  if (gameOver || state.passes >= 2) return '—';
  if (mode === 'ai') {
    if (state.toPlay === humanColor) return 'You · Black';
    return aiThinking ? 'AI · thinking…' : 'AI · White';
  }
  return state.toPlay === 1 ? 'Black' : 'White';
}

function updateInfo(): void {
  const over = gameOver || state.passes >= 2;
  turnEl.classList.toggle('is-thinking', aiThinking);
  turnEl.textContent = turnLabel();
  moveEl.textContent = String(state.moveNumber);
  capBEl.textContent = String(state.captures[0]);
  capWEl.textContent = String(state.captures[1]);
  lastEl.textContent = over ? 'two passes' : (state.lastMove >= 0 ? notation(size, state.lastMove) : '—');
}

/** 一手落子（人类 / AI 共用）：引擎判定 → 推进历史 → 提子动画 */
function doMove(i: number): boolean {
  const before = state;
  const r = play(before, i);
  if (!r.ok) return false;
  history.push(before);
  const opp: Player = opponent(before.toPlay);
  const captured = diffCaptures(before.board, r.state!.board, opp);
  state = r.state!;
  const token = ++moveToken;
  renderBoard({ placed: i, captured, capturedColor: opp });
  if (captured.length) {
    window.setTimeout(() => { if (token === moveToken) renderBoard(); }, 300);
  }
  return true;
}

function doPass(): void {
  if (state.passes >= 2) return;
  history.push(state);
  state = pass(state);
  renderBoard();
}

/** 人类落子（桌面点击 / 移动端点击） */
function onCell(i: number): void {
  if (gameOver || state.passes >= 2) return;
  if (mode === 'ai') {
    if (aiThinking) return;
    if (state.toPlay !== humanColor) return;   // 不是你的回合
  }
  if (!doMove(i)) return;         // 非法手静默忽略
  afterHumanAction();
}

function afterHumanAction(): void {
  if (state.passes >= 2) { endGame(); return; }
  if (mode === 'ai' && state.toPlay === aiColor && !gameOver) {
    scheduleAi();
  }
}

function scheduleAi(): void {
  clearAiTimer();
  aiThinking = true;
  updateInfo();                                 // 立即显示 thinking
  const base = AI_THINK_MS[difficulty] + (aiHasMoved ? 0 : 260);  // 开局加时
  const delay = Math.round(base * (0.88 + Math.random() * 0.24)); // ±12% 抖动
  aiTimer = window.setTimeout(() => {
    aiTimer = null;
    aiThinking = false;
    if (gameOver || state.passes >= 2) return;   // 期间人类悔棋/新局了
    const m = bestMove(state, difficulty);
    if (m < 0) {
      doPass();                                  // 无合法手 → AI 停一手
    } else {
      doMove(m);
      aiHasMoved = true;
    }
    if (state.passes >= 2) { endGame(); return; }
    // AI 走完回到人类回合，无需再调度
  }, delay);
}

function doUndo(): void {
  if (aiThinking) clearAiTimer();
  // 退到"人类回合"或历史见底（vs AI 下一并撤销人类+AI 两手）
  let guard = 0;
  while (history.length > 0 && guard < size * size + 2) {
    const prev = history.pop()!;
    state = prev;
    moveToken++;
    if (mode !== 'ai' || state.toPlay === humanColor) break;
    guard++;
  }
  if (gameOver) { gameOver = false; resultEl.hidden = true; }
  ghost = -1;
  renderBoard();
}

function newGame(s?: Size): void {
  clearAiTimer();
  if (s) size = s;
  state = initialState(size);
  history = [];
  moveToken++;
  ghost = -1;
  aiHasMoved = false;
  gameOver = false;
  resultEl.hidden = true;
  renderBoard();
  metaSizeEl.textContent = `${size}×${size}`;
  document.querySelectorAll<HTMLButtonElement>('#go-sizes button').forEach((b) => {
    b.classList.toggle('is-cur', Number(b.dataset.size) === size);
  });
  updateMetaNote();
}

function endGame(): void {
  if (gameOver) return;
  gameOver = true;
  clearAiTimer();
  const sc = scoreChinese(state);
  const winnerName = sc.winner === 1 ? 'Black' : 'White';
  const pts = sc.margin === 1 ? 'point' : 'points';
  const sub = `${sc.black} vs ${sc.white} (incl. ${7.5} komi)`;
  let html: string;
  if (mode === 'ai') {
    const youWon = sc.winner === humanColor;
    html = `<b>${youWon ? 'You win' : 'AI wins'}</b> · ${sc.margin} ${pts}`
      + `<span class="go-result-sub">${youWon ? 'Black (you)' : 'White (AI)'} · ${sub}</span>`;
  } else {
    html = `<b>${winnerName} wins</b> · ${sc.margin} ${pts}`
      + `<span class="go-result-sub">Black ${sub}</span>`;
  }
  resultEl.innerHTML = html;
  resultEl.hidden = false;
  updateInfo();
}

function updateMetaNote(): void {
  const m = $<HTMLElement>('go-meta-mode');
  if (m) m.textContent = mode === 'ai' ? `vs AI · ${difficulty}` : '2 players';
  const note = $<HTMLElement>('go-note');
  if (note) {
    note.textContent = mode === 'ai'
      ? 'You play Black (first). The AI replies as White — easy picks random with capture preference, medium uses a 1-ply heuristic. Two passes end the game. (Clocks + full end screen land in the next milestone.)'
      : 'Pass-and-play demo. Click any intersection to place; captured stones shrink away. Two passes end the game. (AI opponent + clocks land in the next milestone.)';
  }
}

/* ── 事件：委托到持久容器 boardEl，避免每次渲染重绑 listener ── */
boardEl.addEventListener('click', (ev) => {
  const g = (ev.target as Element).closest?.('.go-cell') as HTMLElement | null;
  if (g) onCell(Number(g.dataset.i));
});
if (!isTouch) {
  boardEl.addEventListener('mousemove', (ev) => {
    const g = (ev.target as Element).closest?.('.go-cell') as HTMLElement | null;
    const i = g ? Number(g.dataset.i) : -1;
    const canGhost = i >= 0 && !gameOver && state.passes < 2
      && (mode === 'pass' || (mode === 'ai' && state.toPlay === humanColor && !aiThinking));
    const want = canGhost ? i : -1;
    if (want !== ghost) { ghost = want; renderBoard(); }
  });
  boardEl.addEventListener('mouseleave', () => {
    if (ghost !== -1) { ghost = -1; renderBoard(); }
  });
}

$<HTMLButtonElement>('go-pass').addEventListener('click', () => {
  if (gameOver || state.passes >= 2) return;
  if (mode === 'ai' && (aiThinking || state.toPlay !== humanColor)) return;
  doPass();
  afterHumanAction();
});
$<HTMLButtonElement>('go-undo').addEventListener('click', doUndo);
$<HTMLButtonElement>('go-new').addEventListener('click', () => newGame());
$<HTMLElement>('go-sizes').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest?.('button[data-size]') as HTMLButtonElement | null;
  if (b) newGame(Number(b.dataset.size) as Size);
});

/* ── W2.3 模式 / 难度 切换 ── */
$<HTMLElement>('go-modes').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest?.('button[data-mode]') as HTMLButtonElement | null;
  if (!b) return;
  const m = b.dataset.mode as Mode;
  if (m === mode) return;
  mode = m;
  document.querySelectorAll<HTMLButtonElement>('#go-modes button').forEach((x) => x.classList.toggle('is-cur', x === b));
  $<HTMLElement>('go-diff').hidden = mode !== 'ai';
  newGame();   // 切模式重置对局（避免黑/白归属错乱）
});
$<HTMLElement>('go-diff').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest?.('button[data-diff]') as HTMLButtonElement | null;
  if (!b) return;
  difficulty = b.dataset.diff as Difficulty;
  document.querySelectorAll<HTMLButtonElement>('#go-diff button[data-diff]').forEach((x) => x.classList.toggle('is-cur', x === b));
  updateMetaNote();
});

newGame(19);
