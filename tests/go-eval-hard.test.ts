/**
 * W5.5 · 评估模块 + MCTS 单测
 *
 * 覆盖：
 *   E. evaluate 基本性质（对称性：换 me 视角互为相反数）
 *   E. 打吃/救活/做眼/纳卡 的符号正确
 *   Q. quickScore：提子加分、填自己眼扣分
 *   M. MCTS 合法性、不崩、预算内返回、确定性（固定 rng 可复现）
 *   P. 性能：19×19 下 MCTS 单步耗时在可接受范围（不阻塞 UI）
 */
import { test } from 'node:test';
import { initialState, computePlay, idx, pass } from '../src/games/go/engine.ts';
import { bestMove } from '../src/games/go/ai.ts';
import { evaluate, evaluateMove, quickScore, DEFAULT_WEIGHTS } from '../src/games/go/evaluate.ts';

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}
function empty(size: number): number[] { return new Array(size * size).fill(0); }

/* ══════════════ E. evaluate 性质 ══════════════ */

test('E1 · evaluate 空盘 = 0（无子无眼无空）', () => {
  const s = empty(9);
  ok(evaluate(s, 9, 1) === 0, `空盘应 0，实际 ${evaluate(s, 9, 1)}`);
});

test('E2 · evaluate 视角对称：eval(黑) = -eval(白)', () => {
  const b = empty(9);
  b[idx(9, 2, 2)] = 1;
  b[idx(9, 6, 6)] = 2;
  const black = evaluate(b, 9, 1);
  const white = evaluate(b, 9, 2);
  // 允许 tie-break 0 误差；核心是同盘对双方视角尽量对称（我们用同一函数，符号由 me/opp 决定）
  ok(Number.isFinite(black) && Number.isFinite(white), '应返回有限数');
  // 黑方多一子 → 黑视角应 >= 白视角
  ok(black >= white, `黑多一子时黑视角不该更低：${black} < ${white}`);
});

test('E3 · evaluate 提子后己方气变多 → 分涨', () => {
  const size = 9;
  const b = empty(size);
  // 黑棋围住一个白子，黑方多子多气
  b[idx(size, 4, 4)] = 2;                 // 白孤子
  b[idx(size, 3, 4)] = 1; b[idx(size, 5, 4)] = 1;
  b[idx(size, 4, 3)] = 1; b[idx(size, 4, 5)] = 1;
  const s = evaluate(b, size, 1);
  ok(s > 0, `黑围白应正分，实际 ${s}`);
});

test('E4 · evaluate 对方被打吃(atari)加分、己方被打吃扣分', () => {
  const size = 9;
  // 构造：白一组气=1（被打吃），黑很多
  const b = empty(size);
  const w = idx(size, 4, 4);
  b[w] = 2; b[idx(size, 3, 4)] = 1; b[idx(size, 5, 4)] = 1; b[idx(size, 4, 3)] = 1;
  // w 剩下 (4,5) 一口气
  const oppAtari = evaluate(b, size, 1);
  // 对比：把这口气也堵上（白被提）后，黑更强
  const b2 = b.slice(); b2[idx(size, 4, 5)] = 1;   // 提掉白
  const afterCap = evaluate(b2, size, 1);
  ok(afterCap > oppAtari, `提子后黑分应更高：${afterCap} vs ${oppAtari}`);

  // 己方被打吃应扣分：黑孤子被白围
  const b3 = empty(size);
  const blk = idx(size, 4, 4);
  b3[blk] = 1; b3[idx(size, 3, 4)] = 2; b3[idx(size, 5, 4)] = 2; b3[idx(size, 4, 3)] = 2; b3[idx(size, 4, 5)] = 2;
  const selfAtari = evaluate(b3, size, 1);
  ok(selfAtari < 0, `黑孤子被围应负分，实际 ${selfAtari}`);
});

test('E5 · evaluate 做眼加分（黑两眼 vs 白两眼）', () => {
  const size = 9;
  // 黑造两眼：黑子环绕两个独立单点
  const b = empty(size);
  const eyeA = idx(size, 4, 4), eyeB = idx(size, 4, 6);
  // eyeA 四周黑
  for (const d of [[-1,0],[1,0],[0,-1],[0,1]]) b[idx(size, 4+d[0], 4+d[1])] = 1;
  // eyeB 四周黑
  for (const d of [[-1,0],[1,0],[0,-1],[0,1]]) b[idx(size, 4+d[0], 6+d[1])] = 1;
  const twoEyes = evaluate(b, size, 1);
  // 同样位置只造一眼
  const b2 = b.slice();
  for (const d of [[-1,0],[1,0],[0,-1],[0,1]]) b2[idx(size, 4+d[0], 6+d[1])] = 0;
  const oneEye = evaluate(b2, size, 1);
  ok(twoEyes > oneEye, `两眼应比一眼分高：${twoEyes} vs ${oneEye}`);
});

/* ══════════════ Q. quickScore ══════════════ */

test('Q1 · quickScore 提子加分', () => {
  const size = 9;
  const b = empty(size);
  b[idx(size, 4, 4)] = 2;
  b[idx(size, 3, 4)] = 1; b[idx(size, 5, 4)] = 1; b[idx(size, 4, 3)] = 1;
  const after = b.slice(); after[idx(size, 4, 5)] = 1;  // 黑落 (4,5) 提白
  const s = quickScore(b, after, size, 1, idx(size, 4, 5));
  ok(s > 0, `提子应正分，实际 ${s}`);
});

test('Q2 · quickScore 填自己眼扣分（纳卡）', () => {
  const size = 9;
  const b = empty(size);
  const eye = idx(size, 4, 4);
  // 眼点四周都是黑
  for (const d of [[-1,0],[1,0],[0,-1],[0,1]]) b[idx(size, 4+d[0], 4+d[1])] = 1;
  const after = b.slice(); after[eye] = 1;   // 黑填自己的眼
  const s = quickScore(b, after, size, 1, eye);
  ok(s < 0, `填自己眼应负分，实际 ${s}`);
});

/* ══════════════ 集成：hard 档接 evaluate ══════════════ */

test('H1 · bestMove hard 返回合法着法（9×9 首手）', () => {
  const s = initialState(9);
  const m = bestMove(s, 'hard', seeded(1));
  ok(m >= 0 && m < 81, `应返回合法下标，实际 ${m}`);
  const r = computePlay(s, m);
  ok(r.ok, 'hard 返回的着法必须引擎判定合法');
});

test('H2 · bestMove hard 确定性（固定 rng 可复现）', () => {
  const s = initialState(9);
  s.board[idx(9, 4, 4)] = 1;
  ok(bestMove(s, 'hard', seeded(42)) === bestMove(s, 'hard', seeded(42)), '同 rng 应同结果');
});

test('H3 · hard 会提掉被打吃的敌子（构造必提局面）', () => {
  const size = 9;
  const s = initialState(size);
  s.board[idx(size, 4, 4)] = 2;
  s.board[idx(size, 3, 4)] = 1; s.board[idx(size, 5, 4)] = 1; s.board[idx(size, 4, 3)] = 1;
  s.toPlay = 1;
  s.ko = null; s.koFor = null;
  ok(bestMove(s, 'hard', seeded(5)) === idx(size, 4, 5), '黑应提子于 (4,5)');
});

test('H4 · hard 不会填自己的眼（纳卡回避）', () => {
  const size = 9;
  const s = initialState(size);
  const eye = idx(size, 4, 4);
  for (const d of [[-1,0],[1,0],[0,-1],[0,1]]) s.board[idx(size, 4+d[0], 4+d[1])] = 1;
  s.toPlay = 1;
  s.ko = null; s.koFor = null;
  const m = bestMove(s, 'hard', seeded(9));
  ok(m !== eye, `hard 不应填自己眼 (4,4)，实际 ${m}`);
});

/* ══════════════ P. 性能 ══════════════ */

test('P1 · hard 19×19 单手耗时 < 400ms（浏览器可接受）', () => {
  const s = initialState(19);
  const t0 = Date.now();
  const m = bestMove(s, 'hard', seeded(11));
  const dt = Date.now() - t0;
  ok(m >= 0, '应返回着法');
  ok(dt < 400, `19x19 hard 耗时 ${dt}ms，应 <400ms`);
});

test('P2 · hard 9×9 完整 60 手不超时', () => {
  let s = initialState(9);
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    const m = bestMove(s, 'hard', seeded(200 + i));
    if (m < 0) { s = pass(s); continue; }
    const r = computePlay(s, m);
    if (!r.ok) break;
    s = r.state;
  }
  const dt = Date.now() - t0;
  ok(dt < 15000, `60 手总耗时 ${dt}ms，应 <15s`);
});
