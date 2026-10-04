/**
 * Go（围棋）棋盘 SVG 渲染器 —— 9 / 13 / 19 路，纯函数产出 SVG 字符串。
 *
 * 设计对齐 gomoku 的棋盘语言：复用其 --go-* 木盘皮肤变量与
 *   .go-stone / .go-coord / .go-last-ring / .go-ghost / .go-cell 类名；
 * 新增落子(.is-new) 与 提子(.is-captured) 动画类（CSS 在 go-paper.css）。
 *
 * 该模块只负责"把局面画成 SVG"，不持有任何 DOM / 状态；调用方决定何时
 * 传入 placed / captured 以触发动画（详见 index.ts 的落子流程）。
 */
import type { Board, Player } from './engine';

/** 围棋记谱列字母（跳过 I，避免与 J 混淆）：A..H, J..T */
const COLS = 'ABCDEFGHJKLMNOPQRST';

/** SVG viewBox 边长（固定，CSS 负责自适应缩放） */
export const GO_SLOT = 760;
const MARGIN = 16;   // 外留白（容纳外框描边）
const FRAME = 12;    // 棋盘外框厚度
const LABEL = 24;    // 坐标带到棋面的距离
const PAD = MARGIN + FRAME + LABEL; // 52：网格起点，四边对称

/** 网格交点像素坐标（gx/gy 为 0..size-1） */
function cellXY(size: number, gx: number, gy: number): [number, number] {
  const inner = GO_SLOT - 2 * PAD;
  const cell = inner / (size - 1);
  return [PAD + gx * cell, PAD + gy * cell];
}

/** 星位（hoshi）：9/13 取四角 + 天元；19 取九星 */
function hoshi(size: number): Array<[number, number]> {
  if (size === 9) return [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]];
  if (size === 13) return [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]];
  // 19（以及任何 ≥15 的兜底）
  const e = size - 1 - 3;       // 15
  const m = (size - 1) / 2;     // 9
  return [[3, 3], [3, e], [e, 3], [e, e], [3, m], [m, 3], [m, e], [e, m], [m, m]];
}

export interface GoRenderInput {
  size: number;
  board: Board;
  /** 最后一手点（-1 或省略表示无） */
  lastMove?: number;
  /** 刚落下的点：加上 .is-new 触发落子动画 */
  placed?: number;
  /** 刚被提掉的点列表：以 phantom 形式画出并播提子动画（这些点在新 board 中已为空） */
  captured?: number[];
  /** 被提子的颜色（用于 phantom 渐变） */
  capturedColor?: Player;
  /** 幽灵预览点（-1 或省略表示无） */
  ghost?: number;
  /** 终局确认：被标为「死子」的点（画 ✕ 标记，仍显示棋子） */
  dead?: number[];
  /** 终局确认：己方 territory（画小方块标记，用于数目预览） */
  territory?: number[];
  /** 是否绘制四面坐标尺（默认 true） */
  showCoords?: boolean;
  /** 是否渲染命中区（可落点 <g class="go-cell">，默认 false） */
  interactive?: boolean;
  /**
   * 命中区模式：'play' = 只在空点（默认）；'count' = 终局数目阶段，覆盖敌色子
   * （点整块切换死活），空点也保留以避免视觉跳变。
   * 🔴 2026-10-04 修复：原 'play' 模式只覆盖空点，但终局确认时点击的是**棋子**，
   * 两边直接矛盾 ⇒ 标死子功能 100% 不可用，toast 只会提示「只能标对方的子为死子」。
   */
  hitMode?: 'play' | 'count';
  /** count 模式下哪些颜色算「敌」（用于生成命中区） */
  countEnemy?: Player;
  /**
   * 「形势」叠加层：把每个空点按归属染成浅黑/浅白，仅在玩家主动打开时传入。
   * 不传或 undefined 时不渲染 —— 棋盘外观与之前一致。
   */
  situation?: { black: number[]; white: number[] };
}

/**
 * 计算一手棋提掉的棋子下标：对比落子前后盘面，找出"旧为敌色、新为空"的点。
 * 调用方在落子后传入 before/after 即可，无需引擎额外暴露内部提子列表。
 */
export function diffCaptures(before: Board, after: Board, opp: Player): number[] {
  const out: number[] = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i] === opp && after[i] === 0) out.push(i);
  }
  return out;
}

/** 生成棋盘 SVG 字符串 */
export function renderGoBoardSVG(input: GoRenderInput): string {
  const { size, board } = input;
  const lastMove = input.lastMove ?? -1;
  const placed = input.placed ?? -1;
  const captured = input.captured ?? [];
  const capturedColor = input.capturedColor ?? 2;
  const ghost = input.ghost ?? -1;
  const dead = input.dead ?? [];
  const territory = input.territory ?? [];
  const showCoords = input.showCoords ?? true;
  const interactive = input.interactive ?? false;
  const hitMode = input.hitMode ?? 'play';
  const countEnemy = input.countEnemy ?? 0;
  const situation = input.situation;

  const inner = GO_SLOT - 2 * PAD;
  const cell = inner / (size - 1);
  const stoneR = cell * 0.46;
  const sw = (stoneR * 0.06).toFixed(2);

  // ── 网格线 ──
  let lines = '';
  for (let r = 0; r < size; r++) {
    const y = (PAD + r * cell).toFixed(2);
    lines += `<line x1="${PAD}" y1="${y}" x2="${GO_SLOT - PAD}" y2="${y}" stroke="var(--go-grid,#5C6B74)" stroke-width="1" stroke-opacity="0.85"/>`;
  }
  for (let c = 0; c < size; c++) {
    const x = (PAD + c * cell).toFixed(2);
    lines += `<line x1="${x}" y1="${PAD}" x2="${x}" y2="${GO_SLOT - PAD}" stroke="var(--go-grid,#5C6B74)" stroke-width="1" stroke-opacity="0.85"/>`;
  }

  // ── 星位 ──
  let stars = '';
  const dotR = (stoneR * 0.16).toFixed(2);
  for (const [sx, sy] of hoshi(size)) {
    const [px, py] = cellXY(size, sx, sy);
    stars += `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${dotR}" fill="var(--go-grid,#5C6B74)"/>`;
  }

  // ── 坐标尺：上/下字母（A–T 跳过 I），左/右数字（自下而上 1..size） ──
  let coords = '';
  if (showCoords) {
    const yTop = PAD - 9;
    const yBot = GO_SLOT - PAD + 13;
    for (let c = 0; c < size; c++) {
      const x = (PAD + c * cell).toFixed(2);
      const letter = COLS[c];
      coords += `<text class="go-coord" x="${x}" y="${yTop}" text-anchor="middle">${letter}</text>`;
      coords += `<text class="go-coord" x="${x}" y="${yBot}" text-anchor="middle">${letter}</text>`;
    }
    for (let r = 0; r < size; r++) {
      const y = (PAD + r * cell).toFixed(2);
      const num = String(size - r);
      coords += `<text class="go-coord" x="${PAD - 12}" y="${(parseFloat(y) + 4).toFixed(2)}" text-anchor="end">${num}</text>`;
      coords += `<text class="go-coord" x="${GO_SLOT - PAD + 12}" y="${(parseFloat(y) + 4).toFixed(2)}" text-anchor="start">${num}</text>`;
    }
  }

  // ── 棋子 + 最后一手标记 ──
  let stones = '';
  const lastDotR = (stoneR * 0.28).toFixed(2);
  const lastRingR = (stoneR + 2.5).toFixed(2);
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (p === 0) continue;
    const gx = i % size;
    const gy = Math.floor(i / size);
    const [px, py] = cellXY(size, gx, gy);
    const isNew = i === placed ? ' is-new' : '';
    const grad = p === 1 ? 'url(#gostone-b)' : 'url(#gostone-w)';
    const stroke = p === 1 ? 'var(--go-stone-stroke-b,#3F3A2C)' : 'var(--go-stone-stroke-w,#9A7B44)';
    stones += `<circle class="go-stone${isNew}" cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${stoneR.toFixed(2)}" fill="${grad}" stroke="${stroke}" stroke-width="${sw}"/>`;
    if (i === lastMove) {
      const dot = p === 1 ? '#F4F6F2' : '#1E1B39';
      stones += `<circle class="go-last-dot" cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${lastDotR}" fill="${dot}" fill-opacity="0.92"/>`;
      stones += `<circle class="go-last-ring" cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${lastRingR}" fill="none" stroke="var(--go-last,#B45309)" stroke-width="2"/>`;
    }
  }

  // ── 死子标记（终局确认）：在子上画 ✕ ──
  let deadMarks = '';
  const xR = stoneR * 0.52;
  for (const i of dead) {
    if (board[i] === 0) continue;
    const gx = i % size;
    const gy = Math.floor(i / size);
    const [px, py] = cellXY(size, gx, gy);
    deadMarks += `<g class="go-dead-mark"><line x1="${(px - xR).toFixed(2)}" y1="${(py - xR).toFixed(2)}" x2="${(px + xR).toFixed(2)}" y2="${(py + xR).toFixed(2)}"/><line x1="${(px + xR).toFixed(2)}" y1="${(py - xR).toFixed(2)}" x2="${(px - xR).toFixed(2)}" y2="${(py + xR).toFixed(2)}"/></g>`;
  }

  // ── territory 标记（终局数目预览）：空点画小方块 ──
  let terrMarks = '';
  const tR = cell * 0.16;
  for (const i of territory) {
    if (board[i] !== 0) continue;
    const gx = i % size;
    const gy = Math.floor(i / size);
    const [px, py] = cellXY(size, gx, gy);
    terrMarks += `<rect class="go-terr-mark" x="${(px - tR).toFixed(2)}" y="${(py - tR).toFixed(2)}" width="${(tR * 2).toFixed(2)}" height="${(tR * 2).toFixed(2)}" rx="2"/>`;
  }

  // ── 形势叠加（玩家主动点「形势」时启用）：把空点按归属染色
  // 用小三角标记每个空位的归属，浅色不干扰落子决策。
  let sitMarks = '';
  if (situation) {
    const sR = cell * 0.14;
    for (const i of situation.black) {
      if (board[i] !== 0) continue;
      const gx = i % size;
      const gy = Math.floor(i / size);
      const [px, py] = cellXY(size, gx, gy);
      sitMarks += `<rect class="go-sit-mark go-sit-b" x="${(px - sR).toFixed(2)}" y="${(py - sR).toFixed(2)}" width="${(sR * 2).toFixed(2)}" height="${(sR * 2).toFixed(2)}" rx="1"/>`;
    }
    for (const i of situation.white) {
      if (board[i] !== 0) continue;
      const gx = i % size;
      const gy = Math.floor(i / size);
      const [px, py] = cellXY(size, gx, gy);
      sitMarks += `<rect class="go-sit-mark go-sit-w" x="${(px - sR).toFixed(2)}" y="${(py - sR).toFixed(2)}" width="${(sR * 2).toFixed(2)}" height="${(sR * 2).toFixed(2)}" rx="1"/>`;
    }
  }

  // ── 提子幻影（播缩小淡出动画；这些点在 after board 中已为空） ──
  let caps = '';
  for (const i of captured) {
    const gx = i % size;
    const gy = Math.floor(i / size);
    const [px, py] = cellXY(size, gx, gy);
    const grad = capturedColor === 1 ? 'url(#gostone-b)' : 'url(#gostone-w)';
    const stroke = capturedColor === 1 ? 'var(--go-stone-stroke-b,#3F3A2C)' : 'var(--go-stone-stroke-w,#9A7B44)';
    caps += `<circle class="go-stone is-captured" cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${stoneR.toFixed(2)}" fill="${grad}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }

  // ── 幽灵预览 ──
  let ghostEl = '';
  if (ghost >= 0 && board[ghost] === 0) {
    const gx = ghost % size;
    const gy = Math.floor(ghost / size);
    const [px, py] = cellXY(size, gx, gy);
    ghostEl = `<circle class="go-ghost" cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${stoneR.toFixed(2)}" fill="none" stroke="var(--go-ghost,#8A99A3)" stroke-width="1.6" stroke-dasharray="4 4"/>`;
  }

  // ── 命中区 ──
  // play 模式（对局中）：只覆盖空点，点了落子；
  // count 模式（终局数目确认）：覆盖敌色子（点整块切换死活），
  //   且**空点也保留命中区**，否则玩家会看到棋盘所有位置都不能点（错误感强烈）。
  let hits = '';
  if (interactive) {
    for (let i = 0; i < board.length; i++) {
      const ok = hitMode === 'count'
        ? (board[i] === 0 || board[i] === countEnemy)
        : (board[i] === 0);
      if (!ok) continue;
      const gx = i % size;
      const gy = Math.floor(i / size);
      const [px, py] = cellXY(size, gx, gy);
      hits += `<g class="go-cell" data-i="${i}"><rect x="${(px - cell / 2).toFixed(2)}" y="${(py - cell / 2).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="transparent"/></g>`;
    }
  }

  const defs = `<defs>
    <radialGradient id="gostone-b" cx="35%" cy="32%" r="78%">
      <stop offset="0%" stop-color="#454c57"/>
      <stop offset="55%" stop-color="#1b212a"/>
      <stop offset="100%" stop-color="#0B0F14"/>
    </radialGradient>
    <radialGradient id="gostone-w" cx="35%" cy="32%" r="78%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="60%" stop-color="#eef1f5"/>
      <stop offset="100%" stop-color="#c7cdd6"/>
    </radialGradient>
  </defs>`;

  const frame = `<rect x="${MARGIN}" y="${MARGIN}" width="${GO_SLOT - 2 * MARGIN}" height="${GO_SLOT - 2 * MARGIN}" rx="12" fill="var(--go-frame,#C89452)" stroke="var(--go-frame-edge,rgba(94,62,24,.38))" stroke-width="1.5"/>`
    + `<rect x="${PAD - 6}" y="${PAD - 6}" width="${GO_SLOT - 2 * PAD + 12}" height="${GO_SLOT - 2 * PAD + 12}" rx="6" fill="var(--go-board-bg,#DBA859)"/>`;

  return `<svg viewBox="0 0 ${GO_SLOT} ${GO_SLOT}" role="img" aria-label="Go board, ${size} by ${size}" preserveAspectRatio="xMidYMid meet">
  ${defs}${frame}
  ${lines}${stars}${coords}${terrMarks}${sitMarks}${stones}${deadMarks}${caps}${ghostEl}${hits}
</svg>`;
}
