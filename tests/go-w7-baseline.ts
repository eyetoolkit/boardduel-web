/**
 * W7 方案 A · 评估短板基线（改动前的「现状记录」）
 *
 * 目的：把 STATE 记录的已知短板「深度≥2 时该提子不提/该做眼不做」转成**可复现的
 * 量化基线**。改 evaluate 之后跑同一组用例对比，才能证明是真改进而非感觉。
 *
 * 用例来源：真实围棋基本功（死活 / 征子 / 打吃），不是构造的玩具形状。
 */
import { initialState, idx, type GoState, type Stone } from '../src/games/go/engine.ts';
import { evaluate, DEFAULT_WEIGHTS as W } from '../src/games/go/evaluate.ts';
import { searchBest } from '../src/games/go/search.ts';
import { collectGroup } from '../src/games/go/engine.ts';
import { ladderEscape } from '../src/games/go/lifedeath.ts';

type Diff = [number, number, Stone];

function build(size: number, placements: Diff[], toPlay: 1 | 2 = 1, moveNumber = 30): GoState {
  const b = new Array(size * size).fill(0);
  for (const [x, y, c] of placements) b[idx(size, x, y)] = c;
  return { size, board: b, toPlay, ko: null, koFor: null, passes: 0, captures: [0, 0], lastMove: -1, moveNumber };
}

function show(board: string[]): void {
  for (const line of board) console.log('    ' + line);
}

const S = 9;
const I = (x: number, y: number) => idx(S, x, y);

/* ════════════ 基线 1：白一块两目活棋 vs 黑一块单眼濒死 ════════════
   黑棋只剩一口气（0,0）被白围；白有两眼（大空）。
   正确评估：evaluate(黑) 应显著低于 evaluate(黑) 在白有单眼时的值。
   现状问题：evaluate 不区分「两眼活」与「一口被提」，只数 eye 个数。 */
function case1() {
  console.log('\n═══ 基线 1：两目活棋 vs 一口被提 ═══');
  // 白两目：角上 (0,0) 与 (0,4) 各留一格真眼
  const whiteAlive: Diff[] = [
    [1, 0, 2], [0, 1, 2],            // 围住 (0,0)
    [1, 3, 2], [0, 2, 2], [0, 4, 2], // 围住 (0,3)
  ];
  // 白只有一目：(0,0) 真眼，但 (0,2) 处是空的大空间（可被黑打入）
  const whiteOneEye: Diff[] = [
    [1, 0, 2], [0, 1, 2],
  ];
  // 黑一子 (2,2) 两面被白围，气=1
  const black: Diff = [2, 2, 1];
  const a = evaluate(build(S, [...whiteAlive, black]).board, S, 1, 30);
  const b = evaluate(build(S, [...whiteOneEye, black]).board, S, 1, 30);
  console.log(`  白两目活 + 黑被打吃 → 黑视角 ${a.toFixed(2)}`);
  console.log(`  白一目   + 黑被打吃 → 黑视角 ${b.toFixed(2)}`);
  console.log(`  差值 ${(a - b).toFixed(2)}  ${a < b ? 'OK(白活则黑更差)' : '**FAIL(看不出活棋差别)**'}`);
}

/* ════════════ 基线 2：征子（ladder）逃气 ════════════
   🔴 第一版用例构造错误：两局黑块气数都是 3，**都不是被打吃局面**，
   征子逻辑压根不该触发 → 测出来「看不出差别」是我的锅，不是代码的锅。
   本版改为真正的「气=1 被征」场景：
     A 征子不利：黑一子被白围到只剩 (5,4) 一口气，往右下逃会被一路追到边角
     B 可以逃：黑一子气=1，但 (5,4) 方向有黑援子 (5,3) 接应，长气后可断开 */
function case2() {
  console.log('\n═══ 基线 2：征子逃气（真·气=1 被征）═══');
  // A：黑 (4,4)，白围三边留 (5,4)；白在 (5,3)(6,4)(7,3)(8,4) 布追逃梯子
  const chased: Diff[] = [
    [4, 4, 1], [3, 4, 2], [4, 3, 2], [3, 3, 2], [3, 5, 2],
    [5, 3, 2], [6, 4, 2], [7, 3, 2], [8, 4, 2], [6, 3, 2],
  ];
  // B：黑 (4,4)，同样只剩 (5,4) 一口气，但黑有援子 (5,3)
  const rescued: Diff[] = [
    [4, 4, 1], [3, 4, 2], [4, 3, 2], [3, 3, 2], [3, 5, 2],
    [5, 3, 1], [6, 3, 2], [6, 4, 2],
  ];
  const ga = build(S, chased);
  const gb = build(S, rescued);
  const ca = collectGroup(ga.board, S, I(4, 4));
  const cb = collectGroup(gb.board, S, I(4, 4));
  console.log(`  征子不利: 黑块气=${ca.liberties}  逃气=${ladderEscape(ga.board, S, I(4, 4), 1)}  → ${evaluate(ga.board, S, 1, 30).toFixed(2)}`);
  console.log(`  可逃(有援): 黑块气=${cb.liberties}  逃气=${ladderEscape(gb.board, S, I(4, 4), 1)}  → ${evaluate(gb.board, S, 1, 30).toFixed(2)}`);
  const a = evaluate(ga.board, S, 1, 30);
  const b = evaluate(gb.board, S, 1, 30);
  console.log(`  差值 ${(b - a).toFixed(2)}  ${b > a ? 'OK(能逃应更好)' : '**FAIL(看不出逃气差别)**'}`);
  if (ca.liberties > 1) console.log('  ⚠️ 用例仍非气=1，需再修');
}

/* ════════════ 基线 3：搜索层「该提不提」 ════════════
   白孤子只剩一口气，黑显然该提。这是 STATE 记录的核心短板。 */
function case3() {
  console.log('\n═══ 基线 3：搜索层「该提不提」═══');
  // 白孤子 (4,4)，气=1（(4,5) 是唯一空邻）
  const s = build(S, [
    [4, 4, 2],
    [3, 4, 1], [5, 4, 1], [4, 3, 1],
  ], 1, 30);
  show([
    '9x9: 白孤子在 (4,4)，仅 (4,5) 一口气',
    '      黑 (3,4)(5,4)(4,3) 已围 → 黑应提子于 (4,5)',
    '',
    '  . B B B B B B B .',
    '  B . . . . . . . B',
    '  B . . . . . . . B',
    '  B B B B W B B B B   ← W 在 (4,4)，(4,5) 是它最后一气',
    '  B . . . . . . . B',
    '  B . . . . . . . B',
    '  B . . . . . . . B',
    '  . B B B B B B B .',
  ]);
  for (const budget of [300, 1000, 3000]) {
    const r = searchBest(s, { timeBudgetMs: budget });
    const mv = r.move < 0 ? 'pass' : `${r.move % S},${(r.move / S) | 0}`;
    const ok = r.move === I(4, 5);
    console.log(`  预算 ${String(budget).padStart(4)}ms → 落 (${mv})  ${ok ? 'OK 提子了' : '**FAIL 没提**'}  score=${r.score.toFixed(1)} depth=${r.depth}`);
  }
}

/* ════════════ 基线 4：目的大小（做大 vs 做小）═══
   同等子数下，围 9 点的空区应显著优于围 3 点的空区。 */
function case4() {
  console.log('\n═══ 基线 4：目的大小敏感度 ═══');
  // A：黑围住 3 点（眼位）  B：黑围住 9 点（地盘）
  const small: Diff[] = [
    [0, 0, 1], [0, 2, 1], [2, 0, 1], [2, 2, 1], // 四角围 (1,1)
    [1, 1, 0], [0, 1, 0], [1, 0, 0],
  ];
  const big: Diff[] = [];
  // 3x3 黑框围出 (2..6,2..6) 的 25 点
  for (let x = 1; x <= 7; x++) { big.push([x, 1, 1]); big.push([x, 7, 1]); }
  for (let y = 1; y <= 7; y++) { big.push([1, y, 1]); big.push([7, y, 1]); }
  const a = evaluate(build(S, small).board, S, 1, 50);
  const b = evaluate(build(S, big).board, S, 1, 50);
  console.log(`  黑围 3 点  → ${a.toFixed(2)}`);
  console.log(`  黑围 25 点 → ${b.toFixed(2)}`);
  console.log(`  差值 ${(b - a).toFixed(2)}  ${b > a ? 'OK(地盘大应更好)' : '**FAIL(看不出目的大小)**'}`);
}

/* ════════════ 基线 5：大块薄棋 vs 小块厚棋 ════════════
   同样 5 子：一块被包住没眼（死），一块有眼有气（活）。 */
function case5() {
  console.log('\n═══ 基线 5：死活 vs 厚薄 ═══');
  const deadBig: Diff[] = [
    [4, 3, 1], [3, 4, 1], [4, 4, 1], [5, 4, 1], [4, 5, 1], // 黑十字，无眼
    [2, 3, 2], [2, 4, 2], [2, 5, 2],                      // 白从左边包
    [3, 3, 2], [5, 3, 2], [3, 5, 2], [5, 5, 2],          // 上下
  ];
  const liveSmall: Diff[] = [
    [4, 4, 1], [3, 4, 1], [5, 4, 1], [4, 3, 1],          // 黑十字（4子）
  ];
  const a = evaluate(build(S, deadBig).board, S, 1, 50);
  const b = evaluate(build(S, liveSmall).board, S, 1, 50);
  console.log(`  黑 5 子被包无眼（死）→ ${a.toFixed(2)}`);
  console.log(`  黑 4 子有气有空间（活）→ ${b.toFixed(2)}`);
  console.log(`  差值 ${(b - a).toFixed(2)}  ${b > a ? 'OK(小活块优于大死块)' : '**FAIL(看不出死活)**'}`);
}

console.log('══════ W7 方案 A · 评估短板基线（改动前）══════');
case1();
case2();
case3();
case4();
case5();
console.log('\n══════ 基线结束 ══════');
void DEFAULT_WEIGHTS_unused();
function DEFAULT_WEIGHTS_unused() { void W; }
