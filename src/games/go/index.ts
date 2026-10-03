/**
 * BoardDuel · Go（围棋）演示页（W2.2 · pass-and-play）
 *
 * 范围：把 W1 引擎 + W2.2 渲染层接成可玩的"两人轮流落子"演示。
 *   · 落子（引擎判定占用/打劫/自杀，非法忽略）
 *   · 提子（引擎算 captures，diffCaptures 找出被提点 → 播提子动画）
 *   · 最后一手标记 + 坐标尺 + 星位 + 9/13/19 切换
 *   · 悔棋（history 栈）/ Pass（双 pass 终局）/ New game
 *   · 桌面 hover 幽灵预览，移动端点击落子
 *
 * 下一步(W2.3)：把"对方"换成 ai.ts 的 easy/medium；W3 接入 arena 范式
 *   （棋钟 / 难度选择 / 退出守卫 / 结算页 / 6 语言 i18n）。本文件届时整体
 *   迁移进 arena 三段式，布局类(.go-demo-*) 由 arena 类替换。
 */
import { setupNav } from '../game-core';
import { wireLobbyChrome } from '../../lobby-chrome';
import {
  initialState, play, pass, notation, opponent,
  type GoState, type Player,
} from './engine';
import { renderGoBoardSVG, diffCaptures } from './render';

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

const turnEl = $<HTMLElement>('go-turn');
const moveEl = $<HTMLElement>('go-move');
const capBEl = $<HTMLElement>('go-cap-b');
const capWEl = $<HTMLElement>('go-cap-w');
const lastEl = $<HTMLElement>('go-last');
const metaSizeEl = $<HTMLElement>('go-meta-size');

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

function updateInfo(): void {
  const over = state.passes >= 2;
  turnEl.textContent = over ? '—' : (state.toPlay === 1 ? 'Black' : 'White');
  moveEl.textContent = String(state.moveNumber);
  capBEl.textContent = String(state.captures[0]);
  capWEl.textContent = String(state.captures[1]);
  lastEl.textContent = over ? 'two passes' : (state.lastMove >= 0 ? notation(size, state.lastMove) : '—');
}

function onCell(i: number): void {
  if (state.passes >= 2) return;
  const before = state;
  const r = play(before, i);
  if (!r.ok) return;                       // 非法手（占用 / 打劫 / 自杀）静默忽略
  history.push(before);
  const opp: Player = opponent(before.toPlay);   // 被提掉的都是对手的棋子
  const captured = diffCaptures(before.board, r.state!.board, opp);
  state = r.state!;
  const token = ++moveToken;
  renderBoard({ placed: i, captured, capturedColor: opp });
  // 提子动画播完(~300ms)后清掉 phantom，露出已被清空的盘面
  if (captured.length) {
    window.setTimeout(() => { if (token === moveToken) renderBoard(); }, 300);
  }
}

function doPass(): void {
  if (state.passes >= 2) return;
  history.push(state);
  state = pass(state);
  renderBoard();
}

function doUndo(): void {
  const prev = history.pop();
  if (!prev) return;
  state = prev;
  moveToken++;
  ghost = -1;
  renderBoard();
}

function newGame(s?: Size): void {
  if (s) size = s;
  state = initialState(size);
  history = [];
  moveToken++;
  ghost = -1;
  renderBoard();
  metaSizeEl.textContent = `${size}×${size}`;
  document.querySelectorAll<HTMLButtonElement>('#go-sizes button').forEach((b) => {
    b.classList.toggle('is-cur', Number(b.dataset.size) === size);
  });
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
    if (i !== ghost) { ghost = i; renderBoard(); }
  });
  boardEl.addEventListener('mouseleave', () => {
    if (ghost !== -1) { ghost = -1; renderBoard(); }
  });
}

$<HTMLButtonElement>('go-pass').addEventListener('click', doPass);
$<HTMLButtonElement>('go-undo').addEventListener('click', doUndo);
$<HTMLButtonElement>('go-new').addEventListener('click', () => newGame());
$<HTMLElement>('go-sizes').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest?.('button[data-size]') as HTMLButtonElement | null;
  if (b) newGame(Number(b.dataset.size) as Size);
});

newGame(19);
