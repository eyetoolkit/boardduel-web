/** W7 对局验收：死活模块接入后的真实强度 + 性能 */
import { initialState, computePlay, pass, scoreChinese, hashPosition } from '../src/games/go/engine.ts';
import { bestMove, type Difficulty } from '../src/games/go/ai.ts';
import { searchBest } from '../src/games/go/search.ts';
import { evaluate } from '../src/games/go/evaluate.ts';

function seeded(s: number) { let x = s >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 0x100000000; }; }

const SIZE = Number(process.argv[2] ?? 9);
const N = Number(process.argv[3] ?? 10);
const BUDGET = Number(process.argv[4] ?? 200);

function play(d1: Difficulty, d2: Difficulty, seed: number) {
  let st = initialState(SIZE);
  const hist = new Set([hashPosition(st.board, st.toPlay)]);
  for (let i = 0; i < SIZE * SIZE * 2.2; i++) {
    if (st.passes >= 2) break;
    const d: Difficulty = st.toPlay === 1 ? d1 : d2;
    const m = bestMove(st, d, { rng: seeded(seed * 31 + i * 7919), budgetMs: BUDGET });
    if (m < 0) { st = pass(st); continue; }
    const r = computePlay(st, m, { superko: true, history: hist });
    if (!r.ok || !r.state) st = pass(st); else st = r.state;
    hist.add(hashPosition(st.board, st.toPlay));
  }
  if (st.passes < 2) st = pass(pass(st));
  return scoreChinese(st).black - scoreChinese(st).white;
}

console.log(`=== W7 对局验收 · ${SIZE}路 · 每对 ${N} 局 · ${BUDGET}ms/手 ===`);
const pairs: Array<[Difficulty, Difficulty]> = [
  ['hard', 'easy'], ['hard', 'medium'], ['hard', 'hard'], ['medium', 'easy'],
];
for (const [a, b] of pairs) {
  let wins = 0;
  let sum = 0;
  for (let s = 1; s <= N; s++) {
    const d = play(a, b, s);
    if (d > 0) wins++;
    sum += d;
  }
  console.log(`${a}(黑) vs ${b}(白): ${wins}/${N} 黑胜, 平均 ${(sum / N).toFixed(1)} 目`);
}

console.log('\n--- 开局首手（应全在三/四线）---');
for (const size of [9, 13, 19]) {
  const r = searchBest(initialState(size), { timeBudgetMs: 1500 });
  const x = r.move % size;
  const y = (r.move / size) | 0;
  const d = Math.min(x, y, size - 1 - x, size - 1 - y);
  console.log(`  ${size}路: (${x},${y}) edgeDist=${d} ${d >= 2 && d <= 3 ? 'OK' : '**FAIL**'} depth=${r.depth}`);
}

console.log('\n--- evaluate 性能 ---');
for (const size of [9, 19]) {
  const st = initialState(size);
  for (let i = 0; i < 40; i++) st.board[(i * 13 + 7) % (size * size)] = (i % 2) + 1;
  evaluate(st.board, size, 1, 30);
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) evaluate(st.board, size, 1, 30);
  console.log(`  ${size}路: ${((Date.now() - t0) / 200).toFixed(3)} ms/次`);
}

console.log('\n--- 搜索最慢单手（线上预算 hard=350ms）---');
for (const size of [9, 13, 19]) {
  let worst = 0;
  const st0 = initialState(size);
  for (let i = 0; i < 30; i++) st0.board[(i * 13 + 7) % (size * size)] = (i % 2) + 1;
  st0.toPlay = 1;
  for (let k = 0; k < 6; k++) {
    const t0 = Date.now();
    bestMove(st0, 'hard', { rng: seeded(k * 17), budgetMs: 350 });
    const dt = Date.now() - t0;
    if (dt > worst) worst = dt;
  }
  console.log(`  ${size}路: 最慢 ${worst}ms ${worst > 1500 ? '**UI 会卡**' : 'OK'}`);
}
