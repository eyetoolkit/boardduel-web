/**
 * 联机终局帧解析器测试 — shared/game-over.ts
 *
 * 覆盖：和棋双形状（winner:'draw' / kind:'draw'）、reason 归一化白名单
 * （含 2026-10-23 补登记的 'double_pass' / 'draw_agreed'）、认输帧的
 * by→winner 推导、null winner 不误判。
 *
 * 运行：node --experimental-strip-types --test tests/game-over.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGameOver } from '../src/shared/game-over.ts';

test('draw: both wire shapes are detected', () => {
  assert.equal(parseGameOver({ winner: 'draw', reason: 'draw_agreed' }).draw, true);
  assert.equal(parseGameOver({ kind: 'draw', reason: '双方同意' }).draw, true);
  // 旧 worker 的中文裸 reason 也要认
  assert.equal(parseGameOver({ reason: '双方同意' }).draw, true);
});

test('reason normalization whitelist', () => {
  const cases: Array<[string, string]> = [
    ['resign', 'resign'],
    ['timeout', 'timeout'],
    ['natural_over', 'natural_over'],
    ['opponent_left', 'opponent_left'],
    ['count', 'count'],
    // 2026-10-23 补登记：服务端实发但此前落进 default 被渲染成认输的两个
    ['double_pass', 'natural_over'],
    ['draw_agreed', 'draw'],
    ['双方同意', 'draw'],
    // 未知 reason 安全降级
    ['some_future_reason', 'resign'],
  ];
  for (const [raw, want] of cases) {
    assert.equal(parseGameOver({ reason: raw }).reason, want, `reason ${raw}`);
  }
});

test('resign frame: winner derived from by when absent', () => {
  // 认输方座位 0 → 赢家座位 1
  const r = parseGameOver({ kind: 'resign', by: 0, reason: 'resign' });
  assert.equal(r.draw, false);
  assert.equal(r.winner, 1);
  // 认输方座位 1 → 赢家座位 0
  assert.equal(parseGameOver({ kind: 'resign', by: 1 }).winner, 0);
});

test('winner seat number passes through', () => {
  const r = parseGameOver({ winner: 0, reason: 'natural_over' });
  assert.equal(r.draw, false);
  assert.equal(r.winner, 0);
  assert.equal(r.reason, 'natural_over');
  // 判棋模式的字符串座位号
  assert.equal(parseGameOver({ winner: '1', reason: 'natural_over' }).winner, 1);
});

test('no winner and no by: never fabricate a result', () => {
  const r = parseGameOver({ reason: 'resign' });
  assert.equal(r.draw, false);
  assert.equal(r.winner, null);
});

test('P0 contract: natural end must not be reported as resignation', () => {
  // 2026-10-23 修复前 connect4/reversi 把 natural_over / double_pass / timeout
  // 一律渲染成「认输」。共享层归一化后，调用方按 reason 分流即可。
  for (const raw of ['natural_over', 'double_pass']) {
    const r = parseGameOver({ winner: 1, reason: raw });
    assert.notEqual(r.reason, 'resign', `${raw} must not degrade to resign`);
  }
  const t = parseGameOver({ winner: 1, reason: 'timeout' });
  assert.equal(t.reason, 'timeout');
});
