/**
 * board-anim 共享 diff 注入器单测（2026-10-24 第四批）
 * 覆盖：落子/翻子判定、回放态熔断、首帧不播、stagger 距离、chess 字符串盘
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffCellAnims, resetCellAnims } from '../src/shared/board-anim.ts';

const flat = (n: number) => Array.from({ length: n }, () => 0);

test('空→有子 挂 place', () => {
  resetCellAnims();
  const prev = flat(9);
  const next = flat(9); next[4] = 1;
  const a = diffCellAnims(prev, next, true);
  assert.equal(a.size, 1);
  assert.equal(a.get(4)!.cls, 'bd-anim-place');
  assert.equal(a.get(4)!.delay, 0);
});

test('首帧（prev=null）不播任何动画', () => {
  resetCellAnims();
  const next = flat(9); next[4] = 1;
  assert.equal(diffCellAnims(null, next, true).size, 0);
});

test('回放态（live=false）不播', () => {
  resetCellAnims();
  const prev = flat(9);
  const next = flat(9); next[4] = 1;
  assert.equal(diffCellAnims(prev, next, false).size, 0);
});

test('有子→空格（提子/清盘）不播', () => {
  resetCellAnims();
  const prev = flat(9); prev[4] = 1;
  const next = flat(9);
  assert.equal(diffCellAnims(prev, next, true).size, 0);
});

test('变色翻面：allowFlip=true 挂 flip 且按 Chebyshev 距离 stagger', () => {
  resetCellAnims();
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
  resetCellAnims();
  const prev = flat(9); prev[4] = 1;
  const next = flat(9); next[4] = 2;
  assert.equal(diffCellAnims(prev, next, true, { allowFlip: false }).size, 0);
});

test('chess 字符串盘：.→P 挂 place，P→Q（升变）不播', () => {
  resetCellAnims();
  const prev = Array.from({ length: 64 }, () => '.');
  const next = prev.slice(); next[52] = 'P';
  const a = diffCellAnims(prev, next, true, { allowFlip: false });
  assert.equal(a.get(52)!.cls, 'bd-anim-place');

  // 升变：P→Q 属于"有子→变色"，allowFlip=false 时不该起 flip。
  // 这里必须 resetCellAnims()——上一条断言刚在 52 起播了 place，
  // 不隔离的话续播会把它带回来，测的就不是"升变不播"了。
  resetCellAnims();
  const prev2 = prev.slice(); prev2[52] = 'P';
  const next2 = prev2.slice(); next2[52] = 'Q';
  assert.equal(diffCellAnims(prev2, next2, true, { allowFlip: false }).size, 0);
});

test('无变化的同盘 diff 为空（时钟 tick / hover 重渲染不重放动画）', () => {
  resetCellAnims();
  const b = flat(64); b[10] = 1; b[20] = 2;
  assert.equal(diffCellAnims(b, b.slice(), true, { allowFlip: true }).size, 0);
});

test('stagger 封顶 176ms（15 列盘最远 14 格 → 308ms 截断）', () => {
  resetCellAnims();
  const prev = flat(225);
  prev[210] = 1;
  const next = prev.slice(); next[210] = 2; next[0] = 1;
  const a = diffCellAnims(prev, next, true, { lastIdx: 0, cols: 15, allowFlip: true });
  assert.equal(a.get(210)!.cls, 'bd-anim-flip');
  assert.equal(a.get(210)!.delay, 176);
});

/* ============================================================
 * 2026-10-24 P1 回归：同帧重渲染把动画抹掉
 *
 * 场景（reversi 实测链路）：落子 → afterMove() render() 切回合 →
 * 紧接着 aiMove() 里 state.aiThinking=true; render()。第二次 render 盘面
 * 没变 → 没有 diff → 动画类被新 DOM 抹掉 → 落子/翻子动画一帧都没播。
 * 修法：没播完的格子按已播时长用负 delay 续播（见 diffCellAnims 续播段）。
 * ============================================================ */

test('盘面没变的重渲染要续播，且用负 delay 从断点继续', async () => {
  resetCellAnims();
  const prev = flat(9);
  const next = prev.slice(); next[4] = 1;
  const a1 = diffCellAnims(prev, next, true);
  assert.equal(a1.get(4)!.cls, 'bd-anim-place');
  assert.equal(a1.get(4)!.delay, 0);

  await new Promise((r) => setTimeout(r, 60));
  const a2 = diffCellAnims(next, next, true);   // 同一盘面的第二次渲染
  const f = a2.get(4);
  assert.ok(f, '第二次渲染必须保住动画，否则动画活不过一帧');
  assert.equal(f!.cls, 'bd-anim-place');
  assert.ok(f!.delay < 0, `续播 delay 必须为负（从断点继续），实际 ${f!.delay}`);
  assert.ok(f!.delay >= -180, `续播 delay 应约等于 -60，实际 ${f!.delay}`);
});

test('播完就不再续播（防时钟 tick 把动画无限重播）', async () => {
  resetCellAnims();
  const prev = flat(9);
  const next = prev.slice(); next[4] = 1;
  diffCellAnims(prev, next, true);
  await new Promise((r) => setTimeout(r, 360));  // > place 280ms
  assert.equal(diffCellAnims(next, next, true).has(4), false);
});

test('prev=null（新局 / 退出回放）连续播一起清掉', async () => {
  resetCellAnims();
  const prev = flat(9);
  const next = prev.slice(); next[4] = 1;
  diffCellAnims(prev, next, true);
  assert.equal(diffCellAnims(null, next, true).size, 0);      // 新局首帧
  assert.equal(diffCellAnims(next, next, true).size, 0);      // 紧随的一帧不许再播旧的
});
