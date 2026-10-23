/**
 * board-anim 共享 diff 注入器单测（2026-10-24 第四批）
 * 覆盖：落子/翻子判定、回放态熔断、首帧不播、stagger 距离、chess 字符串盘
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffCellAnims } from '../src/shared/board-anim.ts';

const flat = (n: number) => Array.from({ length: n }, () => 0);

test('空→有子 挂 place', () => {
  const prev = flat(9);
  const next = flat(9); next[4] = 1;
  const a = diffCellAnims(prev, next, true);
  assert.equal(a.size, 1);
  assert.equal(a.get(4)!.cls, 'bd-anim-place');
  assert.equal(a.get(4)!.delay, 0);
});

test('首帧（prev=null）不播任何动画', () => {
  const next = flat(9); next[4] = 1;
  assert.equal(diffCellAnims(null, next, true).size, 0);
});

test('回放态（live=false）不播', () => {
  const prev = flat(9);
  const next = flat(9); next[4] = 1;
  assert.equal(diffCellAnims(prev, next, false).size, 0);
});

test('有子→空格（提子/清盘）不播', () => {
  const prev = flat(9); prev[4] = 1;
  const next = flat(9);
  assert.equal(diffCellAnims(prev, next, true).size, 0);
});

test('变色翻面：allowFlip=true 挂 flip 且按 Chebyshev 距离 stagger', () => {
  const prev = flat(64);
  prev[27] = 1; prev[28] = 1; prev[35] = 1;
  const next = prev.slice();
  next[19] = 2;          // 落点（与 27/28 距离 1 → 22ms；与 35 距离 2 → 44ms）
  next[27] = 2; next[28] = 2; next[35] = 2;  // 三口被翻
  const a = diffCellAnims(prev, next, true, { lastIdx: 19, cols: 8, allowFlip: true });
  assert.equal(a.get(19)!.cls, 'bd-anim-place');
  assert.equal(a.get(27)!.cls, 'bd-anim-flip');
  assert.equal(a.get(27)!.delay, 22);
  assert.equal(a.get(28)!.cls, 'bd-anim-flip');
  assert.equal(a.get(28)!.delay, 22);
  assert.equal(a.get(35)!.cls, 'bd-anim-flip');
  assert.equal(a.get(35)!.delay, 44);
  // 远端格：距 19 两格 → 44ms（cell 3 = 0 行 3 列，与 19 = 2 行 3 列）
  const prev2 = flat(64); prev2[3] = 1;
  const next2 = prev2.slice(); next2[19] = 1; next2[3] = 2;
  const a2 = diffCellAnims(prev2, next2, true, { lastIdx: 19, cols: 8, allowFlip: true });
  assert.equal(a2.get(3)!.delay, 44);
});

test('变色但 allowFlip=false（国象/象棋）不播', () => {
  const prev = flat(9); prev[4] = 1;
  const next = flat(9); next[4] = 2;
  assert.equal(diffCellAnims(prev, next, true, { allowFlip: false }).size, 0);
});

test('chess 字符串盘：.→P 挂 place，P→Q（升变）不播', () => {
  const prev = Array.from({ length: 64 }, () => '.');
  const next = prev.slice(); next[52] = 'P';
  const a = diffCellAnims(prev, next, true, { allowFlip: false });
  assert.equal(a.get(52)!.cls, 'bd-anim-place');

  const prev2 = prev.slice(); prev2[52] = 'P';
  const next2 = prev2.slice(); next2[52] = 'Q';
  assert.equal(diffCellAnims(prev2, next2, true, { allowFlip: false }).size, 0);
});

test('无变化的同盘 diff 为空（时钟 tick / hover 重渲染不重放动画）', () => {
  const b = flat(64); b[10] = 1; b[20] = 2;
  assert.equal(diffCellAnims(b, b.slice(), true, { allowFlip: true }).size, 0);
});

test('stagger 封顶 176ms（15 列盘最远 14 格 → 308ms 截断）', () => {
  const prev = flat(225);
  prev[210] = 1;
  const next = prev.slice(); next[210] = 2; next[0] = 1;
  const a = diffCellAnims(prev, next, true, { lastIdx: 0, cols: 15, allowFlip: true });
  assert.equal(a.get(210)!.cls, 'bd-anim-flip');
  assert.equal(a.get(210)!.delay, 176);
});
