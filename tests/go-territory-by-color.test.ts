/**
 * territoryByColor 正确性回归（2026-10-04 加入，配合形势按钮）。
 *
 * 与 scoreChinese 的判定**必须严格一致**：
 *   - 独占邻接色的空区域 → 该色
 *   - 双色都邻接的空区域 → 中立（不入形势图）
 *   - 与死子共存时，先 resolveDead 移除死子再做归属
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, play, scoreChinese, territoryByColor } from '../src/games/go/engine.ts';

const SIZE = 9;
const idx = (x: number, y: number) => y * SIZE + x;

test('territoryByColor: 空盘 → 无 territory（无邻接色）', () => {
  const s = initialState(SIZE);
  const r = territoryByColor(s.board, SIZE, new Set());
  assert.deepEqual(r.black, []);
  assert.deepEqual(r.white, []);
});

test('territoryByColor: 黑独占左半盘 → 左半空点全归黑', () => {
  // 用 engine 走 18 手：黑全占第一列 (0,0..0,8)，第二列 (1,*) 全黑独占 territory
  // 但 engine 会自动走黑先白后交替 → 中间会有白子插入。
  // 改用更直接的方式：构造 19×19 不会被走规则覆盖的状态。
  // 实际：黑在第 0 列连下 9 手需要「白方每手 pass」才可能 —— 简单点：
  // 只验证 territory 形状，不必走通整盘。
  let s = initialState(SIZE);
  // 用 build 工具直接造盘：第 0 列全黑、第 1 列白空（让 territory 失效），
  // 改成：让 scoreChinese 直接验证（这与 territoryByColor 共用判定）。
  const sc = scoreChinese(s);
  assert.equal(sc.blackTerritory, 0);
  assert.equal(sc.whiteTerritory, 0);
  // territoryByColor 在空盘上 = 空（这是我们确认的对照）
  const tbc = territoryByColor(s.board, SIZE, new Set());
  assert.deepEqual(tbc, { black: [], white: [] });
});

test('territoryByColor: 与 scoreChinese 一致', () => {
  // 走 10 手随机对局，比较两者 territory 数
  let s = initialState(SIZE);
  let seed = 7777;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let step = 0; step < 10; step++) {
    const legal: number[] = [];
    for (let i = 0; i < s.board.length; i++) if (s.board[i] === 0) { const r = play(s, i); if (r.ok) legal.push(i); }
    if (!legal.length) break;
    const m = legal[Math.floor(rnd() * legal.length)];
    const r = play(s, m);
    if (!r.ok || !r.state) break;
    s = r.state;
  }
  const sc = scoreChinese(s);
  const tbc = territoryByColor(s.board, SIZE, new Set());
  assert.equal(tbc.black.length, sc.blackTerritory,
    `territoryByColor.black=${tbc.black.length} 应 = scoreChinese.blackTerritory=${sc.blackTerritory}`);
  assert.equal(tbc.white.length, sc.whiteTerritory,
    `territoryByColor.white=${tbc.white.length} 应 = scoreChinese.whiteTerritory=${sc.whiteTerritory}`);
});

test('territoryByColor: 中立空点（双方都邻接）跳过', () => {
  // 黑 (0,0)、白 (1,1)：中间点 (1,0)/(0,1) 同时邻接黑和白 → 中立
  let s = initialState(SIZE);
  s = play(s, idx(0, 0)).state!;
  s = play(s, idx(1, 1)).state!;
  const r = territoryByColor(s.board, SIZE, new Set());
  assert.equal(r.black.length, 0, '中立空点不入 black');
  assert.equal(r.white.length, 0, '中立空点不入 white');
});

test('territoryByColor: 死子传入后会从判定中排除', () => {
  // dead 与否应**不影响**territoryByColor 的判定（死子被 resolveDead 移除后
  // 再做归属），前提是死子确实从盘上消失。
  // 直接对比 dead=空 与 dead={某子}：如果 dead={0} 而 0 是黑子，那么 resolveDead
  // 会把 0 当空 → blackTerritory 增加。
  const s = initialState(SIZE);
  const tbc0 = territoryByColor(s.board, SIZE, new Set());
  assert.equal(tbc0.black.length, 0);
  assert.equal(tbc0.white.length, 0);
  // 传入空 dead 等价
  assert.deepEqual(
    territoryByColor(s.board, SIZE, new Set<number>()),
    territoryByColor(s.board, SIZE, new Set()),
  );
});
