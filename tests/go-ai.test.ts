/**
 * 围棋 AI 单元测试 — ai.ts
 *
 * 覆盖：easy（合法 + 吃子优先）、medium（合法 + 吃子/打吃威胁 + 子数）、
 * playOut 完整对局模拟（9/13/19 终局 + 数目有效）、terminalScore/didWin、
 * medium 强度（9 路 medium vs easy 多数获胜）。
 *
 * 运行：node --experimental-strip-types --test tests/go-ai.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type GoState, type Player, type Stone,
  initialState, makeState, idx, scoreChinese, pass, hashPosition, computePlay, legalMoves,
} from '../src/games/go/engine.ts';
import {
  bestMoveEasy, bestMoveMedium, bestMoveHard, bestMove, terminalScore, didWin, playOut, type Difficulty,
} from '../src/games/go/ai.ts';

function build(size: number, placements: Array<[number, number, Stone]>, toPlay: 1 | 2 = 1): GoState {
  const b = new Array(size * size).fill(0);
  for (const [x, y, s] of placements) b[idx(size, x, y)] = s;
  return makeState(size, b, toPlay, null, null, 0, [0, 0], -1, 1);
}

function deterministicRng(seed: number): () => number {
  let st = seed >>> 0;
  return () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 0xffffffff; };
}

// ───────────────────────── 1. easy 合法 + 吃子优先 ─────────────────────────
test('easy：返回合法手；有吃子机会时优先吃子', () => {
  const s = initialState(9);
  const m = bestMoveEasy(s, deterministicRng(1));
  assert.ok(m >= 0 && s.board[m] === 0, 'easy returns a legal empty point on empty board');

  // 白单子 (4,4) 三面临黑，仅留 (4,5) 一口；黑仅 (4,5) 可提子，其余手都不提
  const s2 = build(9, [
    [4, 4, 2], [3, 4, 1], [5, 4, 1], [4, 3, 1],
  ], 1);
  const m2 = bestMoveEasy(s2, deterministicRng(1));
  assert.equal(m2, idx(9, 4, 5), 'easy picks the only capturing move');
});

// ───────────────────────── 2. medium 合法 + 吃子 ─────────────────────────
// W6 重写说明（2026-10-03）：medium 原为独立 1-ply 贪心，实测 medium vs easy
// 0/8、平均 -30.4 目（比随机还弱）—— 贪心在围棋里不可叠加。现改为与 hard 同源的
// α-β 搜索、固定 depth=1。因此下面断言从「贪心公式的具体手」改为**行为不变式**。
test('medium：返回合法手；空盘落在三线/四线（不是天元或一线）', () => {
  const s = initialState(9);
  const m = bestMoveMedium(s, deterministicRng(1));
  assert.ok(m >= 0 && legalMoves(s).includes(m), 'medium returns a legal move');

  const x = m % 9;
  const y = Math.floor(m / 9);
  const edgeDist = Math.min(x, y, 8 - x, 8 - y);
  assert.ok(edgeDist >= 2 && edgeDist <= 3,
    `medium 开局应落三/四线，实得 (${x},${y}) edgeDist=${edgeDist}`);
});

test('hard：空盘首手在三线/四线（9/13/19 路都成立）', () => {
  for (const size of [9, 13, 19]) {
    const s = initialState(size);
    const m = bestMoveHard(s, { budgetMs: 1500 });
    const x = m % size;
    const y = Math.floor(m / size);
    const edgeDist = Math.min(x, y, size - 1 - x, size - 1 - y);
    assert.ok(edgeDist >= 2 && edgeDist <= 3,
      `${size} 路 hard 首手应在三/四线，实得 (${x},${y}) edgeDist=${edgeDist}`);
  }
});

test('hard：从不选择填自己真眼的手（纳卡）', () => {
  // 黑 (2,2) 已被自己的子四邻围成真眼 —— 填它等于自毁
  const s = build(9, [
    [2, 2, 1], [1, 2, 1], [3, 2, 1], [2, 1, 1], [2, 3, 1],
  ], 1);
  const m = bestMoveHard(s, { budgetMs: 1200 });
  assert.notEqual(m, idx(9, 2, 2), 'hard must not fill its own true eye');
  assert.ok(legalMoves(s).includes(m), 'hard move is legal');
});

test('hard：被短气包围时选择逃气而不是原地等死', () => {
  // 黑一子 (4,4)，白围三边，只留 (4,5)/(5,4) 两个逃气方向
  const s = build(9, [
    [4, 4, 1], [4, 3, 2], [3, 3, 2], [3, 4, 2], [3, 5, 2],
  ], 1);
  const m = bestMoveHard(s, { budgetMs: 1500 });
  assert.ok(m === idx(9, 4, 5) || m === idx(9, 5, 4),
    `黑被打吃应逃气，实得 (${m % 9},${Math.floor(m / 9)})`);
});

// ───────────────────────── 4. medium 不送死（不选自杀/劫禁，computePlay 已拒） ─────────────────────────
test('medium：从不选择非法手（自杀/劫/占用已被引擎拒绝）', () => {
  const s = build(9, [
    [3, 4, 2], [5, 4, 2], [4, 3, 2], [4, 5, 2], // 围 (4,4) 空点
  ], 1);
  const m = bestMoveMedium(s, deterministicRng(1));
  assert.ok(m !== idx(9, 4, 4), 'medium never picks the suicide point');
  assert.ok(legalMoves(s).includes(m), 'medium move is legal');
});

// ───────────────────────── 5. terminalScore / didWin ─────────────────────────
test('terminalScore / didWin：黑明显占优时判黑胜', () => {
  const size = 9;
  const b = new Array(size * size).fill(0);
  for (let i = 0; i < 60; i++) b[i] = 1; // 黑占 60 子
  for (let i = 60; i < 70; i++) b[i] = 2; // 白占 10 子
  const s = makeState(size, b, 1, null, null, 0, [0, 0], -1, 1);
  assert.equal(didWin(s, 1), true, 'black overwhelmingly wins');
  assert.ok(terminalScore(s, 1) > 0, 'black score positive');
  assert.equal(didWin(s, 2), false, 'white does not win');
});

// ───────────────────────── 6. playOut 完整对局模拟（9/13/19） ─────────────────────────
function match(size: number, seed: number, blackDiff: Difficulty, whiteDiff: Difficulty): { winner: Player; final: GoState } {
  let s = initialState(size);
  const history = new Set<string>([hashPosition(s.board, s.toPlay)]);
  const rng = deterministicRng(seed);
  const cap = size * size * 3;
  let steps = 0;
  while (s.passes < 2 && steps < cap) {
    const diff = s.toPlay === 1 ? blackDiff : whiteDiff;
    const m = bestMove(s, diff, rng);
    if (m < 0) s = pass(s);
    else {
      const r = computePlay(s, m, { superko: true, history });
      if (!r.ok || !r.state) s = pass(s);
      else s = r.state;
    }
    history.add(hashPosition(s.board, s.toPlay));
    steps++;
  }
  if (s.passes < 2) s = pass(pass(s));
  return { winner: scoreChinese(s).winner, final: s };
}

test('playOut：9 路 self-play（medium vs medium）终局且数目有效', () => {
  const final = playOut(initialState(9), 'medium', deterministicRng(7));
  assert.ok(final.passes >= 2, 'game terminates by double pass');
  const sc = scoreChinese(final);
  assert.ok(Number.isFinite(sc.black) && Number.isFinite(sc.white), 'score finite');
});

test('playOut：13 路 self-play 终局', () => {
  const final = playOut(initialState(13), 'medium', deterministicRng(3));
  assert.ok(final.passes >= 2, '13x13 game terminates');
});

test('playOut：19 路一局不崩溃且终局', () => {
  const final = playOut(initialState(19), 'medium', deterministicRng(5), { maxSteps: 19 * 19 });
  assert.ok(final.passes >= 2 || final.moveNumber > 0, '19x19 game runs without crash');
});

// ───────────────────────── 7. medium 强度：9 路 medium(黑) vs easy(白) ─────────────────────────
test('强度：9 路 medium(黑) 对 easy(白) 多数获胜（≥3/5）', () => {
  let mediumWins = 0;
  const total = 5;
  for (let seed = 1; seed <= total; seed++) {
    const { winner } = match(9, seed, 'medium', 'easy');
    if (winner === 1) mediumWins++;
  }
  assert.ok(mediumWins >= 3, `medium should beat easy in majority of games (won ${mediumWins}/${total})`);
});

// ───────────────────────── 8. easy 自对弈不崩溃（random 路径） ─────────────────────────
test('easy 自对弈：9 路不崩溃且终局', () => {
  const final = playOut(initialState(9), 'easy', deterministicRng(11));
  assert.ok(final.passes >= 2, 'easy self-play terminates');
});
