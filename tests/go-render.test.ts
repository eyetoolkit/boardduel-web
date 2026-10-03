/**
 * Go 棋盘渲染层单测（W2.2）
 * 验证 renderGoBoardSVG 在 9/13/19 上产出结构正确的 SVG：
 *   网格线数 = 2×size、星位数、四面坐标数 = 4×size、空盘命中区 = size²、
 *   落子渐变引用、提子 phantom 类、showCoords 开关。
 */
import { test } from 'node:test';
import { renderGoBoardSVG, GO_SLOT, diffCaptures } from '../src/games/go/render.ts';
import {
  initialState, opponent, computePlay, makeState, idx,
} from '../src/games/go/engine.ts';
import type { Board } from '../src/games/go/engine.ts';

function count(hay: string, needle: string): number {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}

// 在空盘上放一颗指定颜色的棋子
function withStone(size: number, idx: number, color: 1 | 2): Board {
  const b = initialState(size).board;
  b[idx] = color;
  return b;
}

for (const size of [9, 13, 19] as const) {
  const expectedStars = size === 19 ? 9 : 5;
  const svg = renderGoBoardSVG({ size, board: initialState(size).board, interactive: true });

  test(`go-render ${size}: svg 外壳与 viewBox`, () => {
    if (!svg.startsWith('<svg') || !svg.trimEnd().endsWith('</svg>')) throw new Error('not wrapped in <svg>');
    if (!svg.includes(`viewBox="0 0 ${GO_SLOT} ${GO_SLOT}"`)) throw new Error('bad viewBox');
  });

  test(`go-render ${size}: 网格线 = 2×size`, () => {
    const lines = count(svg, '<line');
    if (lines !== size * 2) throw new Error(`expected ${size * 2} lines, got ${lines}`);
  });

  test(`go-render ${size}: 星位 = ${expectedStars}`, () => {
    // 星位圆用 fill="var(--go-grid...)"；网格线用的是 stroke，不计入
    const stars = count(svg, 'fill="var(--go-grid');
    if (stars !== expectedStars) throw new Error(`expected ${expectedStars} stars, got ${stars}`);
  });

  test(`go-render ${size}: 四面坐标 = 4×size`, () => {
    const coords = count(svg, 'class="go-coord"');
    if (coords !== size * 4) throw new Error(`expected ${size * 4} coords, got ${coords}`);
  });

  test(`go-render ${size}: 空盘命中区 = size²`, () => {
    const cells = count(svg, 'class="go-cell"');
    if (cells !== size * size) throw new Error(`expected ${size * size} cells, got ${cells}`);
  });
}

test('go-render: 落子含黑子渐变 + .is-new 动画类', () => {
  const svg = renderGoBoardSVG({ size: 19, board: withStone(19, 180, 1), placed: 180, interactive: false });
  if (!svg.includes('url(#gostone-b)')) throw new Error('black stone gradient missing');
  if (!svg.includes('class="go-stone is-new"')) throw new Error('placed stone should have is-new');
});

test('go-render: 白子渐变', () => {
  const svg = renderGoBoardSVG({ size: 19, board: withStone(19, 180, 2), interactive: false });
  if (!svg.includes('url(#gostone-w)')) throw new Error('white stone gradient missing');
});

test('go-render: 最后一手环 + 中心点', () => {
  const svg = renderGoBoardSVG({ size: 19, board: withStone(19, 180, 1), lastMove: 180, interactive: false });
  if (!svg.includes('class="go-last-ring"')) throw new Error('last ring missing');
  if (!svg.includes('class="go-last-dot"')) throw new Error('last dot missing');
});

test('go-render: 提子 phantom 带 .is-captured', () => {
  const svg = renderGoBoardSVG({
    size: 19, board: initialState(19).board, captured: [180], capturedColor: opponent(1),
  });
  if (!svg.includes('class="go-stone is-captured"')) throw new Error('captured phantom should have is-captured');
});

test('go-render: 幽灵预览', () => {
  const svg = renderGoBoardSVG({ size: 19, board: initialState(19).board, ghost: 180, interactive: false });
  if (!svg.includes('class="go-ghost"')) throw new Error('ghost preview missing');
});

test('go-render: showCoords=false 不画坐标', () => {
  const svg = renderGoBoardSVG({ size: 19, board: initialState(19).board, showCoords: false, interactive: false });
  if (svg.includes('class="go-coord"')) throw new Error('coords should be suppressed');
});

test('go-render: 非交互不渲染命中区', () => {
  const svg = renderGoBoardSVG({ size: 19, board: initialState(19).board, interactive: false });
  if (svg.includes('class="go-cell"')) throw new Error('hit areas should be suppressed when not interactive');
});

test('go-render: 提子链路 — play→diffCaptures→phantom 端到端', () => {
  // 复现 engine 已知提子局面（9×9）：白(4,4) 被黑三面包围，黑落(4,5) 提 1 子
  const N = 9;
  const b = initialState(N).board;
  b[idx(N, 4, 4)] = 2; b[idx(N, 3, 4)] = 1; b[idx(N, 5, 4)] = 1; b[idx(N, 4, 3)] = 1;
  const s = makeState(N, b, 1, null, null, 0, [0, 0], -1, 1);
  const r = computePlay(s, idx(N, 4, 5));
  if (!r.ok) throw new Error('capture move should be legal');
  if ((r.captured ?? 0) !== 1) throw new Error('should capture exactly 1');
  if (r.state!.board[idx(N, 4, 4)] !== 0) throw new Error('captured stone removed from board');

  // demo 的 onCell 用 diffCaptures(before, after, opponent(before.toPlay)) 找被提点
  const opp = opponent(s.toPlay);              // 2（白）
  const captured = diffCaptures(s.board, r.state!.board, opp);
  if (captured.length !== 1 || captured[0] !== idx(N, 4, 4)) {
    throw new Error('diffCaptures should report the captured white stone at (4,4)');
  }
  // 渲染：新盘面该点已空 + phantom（白子渐变）带上 is-captured
  const svg = renderGoBoardSVG({ size: N, board: r.state!.board, lastMove: idx(N, 4, 5), captured, capturedColor: opp });
  if (svg.includes('url(#gostone-w)') && !svg.includes('class="go-stone is-captured"')) {
    throw new Error('captured white phantom must be rendered with is-captured');
  }
});
