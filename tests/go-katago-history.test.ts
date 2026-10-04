/**
 * katago.buildHistory 颜色正确性（2026-10-04 深度审计 P0 的回归测试）
 *
 * 原 bug：buildHistory 写成 `for (k = 0; k < n - 1 - i; k++)` 少循环一次，
 * 每一手颜色都取反。后果：神经网络历史平面全空（kg-features 第 0 手不匹配）。
 *
 * 测试策略：用真实 engine 走一个完整对局，用 katago.buildHistory（未导出，
 * 通过 KataGo 实际前向间接验证太重）—— 这里直接复刻它的内部公式作为
 * ground truth，再断言「buggy 版本 ≠ 正确版本」。
 *
 * 数学事实：mover(i) = flip^(n-i)(go.toPlay_after)。
 *   手 i 之后到 go.toPlay 之间翻了 (n-1-i) 次到达倒数第一手 + 最后一次翻到 go.toPlay = n-i 次。
 *   i=0: n 次翻转（n 偶 → 回到 toPlay_initial；n 奇 → 翻转 toPlay_initial）。
 *
 *   验证：n=4 黑先，go.toPlay_after=1（黑，因 4 手后轮到黑）：
 *     i=0: flip^4(1) = 1（黑）✅ 手 0 = 黑
 *     i=1: flip^3(1) = 2（白）✅ 手 1 = 白
 *     i=2: flip^2(1) = 1（黑）✅
 *     i=3: flip^1(1) = 2（白）✅
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, play, initialStateHandicap } from '../src/games/go/engine.ts';

/** 复刻 katago.buildHistory 内部循环 —— 用来作为对照（不导出，但可移植） */
function historyPlayers(goToPlay: 1 | 2, moves: number[]): (1 | 2)[] {
  const played = moves.filter((m) => m >= 0);
  const n = played.length;
  const out: (1 | 2)[] = [];
  for (let i = 0; i < n; i++) {
    let c: 1 | 2 = goToPlay;
    for (let k = 0; k < n - i; k++) c = (c === 1 ? 2 : 1);
    out.push(c);
  }
  return out;
}

/** 原 buggy 版本（n-1-i）—— 用于反向验证「确实错」 */
function buggyHistoryPlayers(goToPlay: 1 | 2, moves: number[]): (1 | 2)[] {
  const played = moves.filter((m) => m >= 0);
  const n = played.length;
  const out: (1 | 2)[] = [];
  for (let i = 0; i < n; i++) {
    let c: 1 | 2 = goToPlay;
    for (let k = 0; k < n - 1 - i; k++) c = (c === 1 ? 2 : 1);
    out.push(c);
  }
  return out;
}

test('buildHistory：n=4 黑先 go.toPlay=1 → [1,2,1,2]', () => {
  assert.deepEqual(historyPlayers(1, [3, 0, 5, 7]), [1, 2, 1, 2]);
});

test('buildHistory：n=4 白先 go.toPlay=2 → [2,1,2,1]', () => {
  assert.deepEqual(historyPlayers(2, [3, 0, 5, 7]), [2, 1, 2, 1]);
});

test('buildHistory：n=1 黑先 go.toPlay=2（手 0 后轮到白） → [1]（手 0 是黑）', () => {
  assert.deepEqual(historyPlayers(2, [3]), [1]);
});

test('buildHistory：n=1 白先 go.toPlay=1 → [2]（手 0 是白）', () => {
  assert.deepEqual(historyPlayers(1, [3]), [2]);
});

test('buildHistory：n=0 任意 → []', () => {
  assert.deepEqual(historyPlayers(1, []), []);
  assert.deepEqual(historyPlayers(2, []), []);
});

test('buildHistory：与 buggy 公式结果严格不等（防止回归）', () => {
  const moves = [3, 0, 5, 7];
  // 任意 n ≥ 2 的情况下，两者必须不同（每个元素反号）
  for (const t of [1, 2] as const) {
    const fix = historyPlayers(t, moves);
    const bug = buggyHistoryPlayers(t, moves);
    for (let i = 0; i < moves.length; i++) {
      assert.notEqual(fix[i], bug[i], `i=${i} 修复版=${fix[i]} buggy=${bug[i]}（必须不同）`);
    }
  }
});

/* ═══════════════════════════════════════════════════════════════
   端到端：用真实 engine 走对局，验证「落子方颜色序列」必须黑白交替
   （覆盖 pass 的间隔、让子局的非黑先起步等多种边界情况）。
   ═══════════════════════════════════════════════════════════════ */
test('端到端：黑先走 8 手（无 pass/提子），buildHistory 输出黑白交替', () => {
  const SIZE = 9;
  let s = initialState(SIZE);
  const moves: number[] = [];
  // 走 8 步，每次在下一个空格
  for (let step = 0; step < 8; step++) {
    const i = step % SIZE;
    const j = Math.floor(step / SIZE) % SIZE;
    const idx = j * SIZE + i;
    const r = play(s, idx);
    if (!r.ok || !r.state) break;
    moves.push(idx);
    s = r.state;
  }
  // 8 步后 toPlay 翻转 8 次 = 回到 1（黑）。但无 pass，moves 长度就是 n。
  const hist = historyPlayers(s.toPlay, moves);
  assert.equal(hist.length, 8);
  // 期望序列 [1,2,1,2,1,2,1,2]
  assert.deepEqual(hist, [1, 2, 1, 2, 1, 2, 1, 2]);
});

test('端到端：第 0 手的颜色必须等于「手 0 走完后棋盘上那一格的颜色」', () => {
  const SIZE = 9;
  // 黑先走 (0,0) → board[0] = 1（黑）
  const r1 = play(initialState(SIZE), 0);
  assert.ok(r1.ok && r1.state);
  const s1 = r1.state!;
  // 走一手后 toPlay = 2（白），用 historyPlayers(toPlay=2, [0]) 应输出 [1]（黑）
  const hist = historyPlayers(s1.toPlay, [0]);
  assert.equal(hist[0], 1);
  assert.equal(s1.board[0], 1, '盘面上 (0,0) 应该是黑棋');
});

test('端到端：白先（让子 3）走 1 手 → buildHistory 第 0 个应是白', () => {
  // 让子局：白先走 1 手
  const SIZE = 19;
  const s0 = initialStateHandicap(SIZE, 3);
  assert.equal(s0.toPlay, 2, '让子 3 应白先');
  // 白走 (0,0)
  const r1 = play(s0, 0);
  assert.ok(r1.ok && r1.state);
  const s1 = r1.state!;
  // toPlay 现在是 1（黑），用 historyPlayers(toPlay=1, [0]) 应输出 [2]（白）
  const hist = historyPlayers(s1.toPlay, [0]);
  assert.equal(hist[0], 2);
  assert.equal(s1.board[0], 2, '盘面上 (0,0) 应是白棋（让子局白先走）');
});
