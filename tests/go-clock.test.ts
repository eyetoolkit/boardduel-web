/**
 * W3.3 中日式棋钟（byoyomi clock）规则测试
 *
 * 覆盖：主时间扣减 / 主时间耗尽进读秒 / 每手扣一段 / 段用尽轮转下一段 /
 *       读秒耗尽判负 / 格式化。
 */
import { test } from 'node:test';
import {
  initialClock, tickClock, afterMoveClock, formatClock, sideActive,
  DEFAULT_CLOCK, type ClockState, type ClockConfig,
} from '../src/games/go/clock.ts';

const CFG: ClockConfig = { mainSec: 30, periods: 3, periodSec: 60 };

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/* ── 初始状态 ── */

test('clock: 初始双方满时间、黑先行', () => {
  const s = initialClock(CFG);
  ok(s.toPlay === 1, '黑先行');
  ok(s.me.mainMs === 30_000, '主时间 30s');
  ok(s.me.periodsLeft === 3, '3 段读秒');
  ok(s.me.inByoyomi === false, '初始不在读秒');
  ok(s.timeout === null, '初始无人超时');
  ok(sideActive(s.me) && sideActive(s.opp), '双方都在走');
});

/* ── 主时间扣减 ── */

test('clock: 主时间随 tick 递减，轮转后走对方', () => {
  let s = initialClock(CFG);
  s = tickClock(s, 5_000, CFG);              // 黑走 5s
  ok(s.me.mainMs === 25_000, `黑剩 25s，实际 ${s.me.mainMs}`);
  ok(s.opp.mainMs === 30_000, '白不走表');
  s = afterMoveClock(s, 1, CFG);             // 黑落子，轮到白
  ok(s.toPlay === 2, '轮到白');
  s = tickClock(s, 3_000, CFG);              // 白走 3s
  ok(s.opp.mainMs === 27_000, `白剩 27s，实际 ${s.opp.mainMs}`);
  ok(s.me.mainMs === 25_000, '黑已停表');
});

/* ── 主时间耗尽 → 进读秒 ── */

test('clock: 主时间耗尽自动进入读秒（段数保留）', () => {
  let s = initialClock(CFG);
  s = tickClock(s, 30_000, CFG);             // 黑主时间走完
  ok(s.me.inByoyomi === true, '黑应进读秒');
  ok(s.me.periodsLeft === 3, '段数仍 3');
  ok(formatClock(s.me) === '1:00 (3)', `显示 1:00 (3)，实际 ${formatClock(s.me)}`);
});

test('clock: 主时间跨帧耗尽时把余量带入读秒段', () => {
  let s = initialClock(CFG);
  // 黑主时间 30s，再过 20s → 耗尽 10s 主时间，剩 20s 走读秒段
  s = tickClock(s, 50_000, CFG);
  ok(s.me.inByoyomi === true, '进读秒');
  ok(s.me.periodsLeft === 3, '仍 3 段');
  ok(s.me.periodMs === 40_000, `本段剩 40s，实际 ${s.me.periodMs}`);
});

/* ── 落子扣一段 ── */

test('clock: 读秒中每落一手扣一段，下一段给满', () => {
  let s = initialClock(CFG);
  s = tickClock(s, 30_000, CFG);             // 黑进读秒
  s = afterMoveClock(s, 1, CFG);             // 黑落子 → 扣 1 段
  ok(s.me.periodsLeft === 2, `黑剩 2 段，实际 ${s.me.periodsLeft}`);
  ok(s.me.periodMs === 60_000, '下一段给满 60s');
  ok(s.toPlay === 2, '轮到白');
});

test('clock: 段用尽自动滚到下一段，不判负', () => {
  let s = initialClock(CFG);
  s = tickClock(s, 30_000, CFG);             // 黑进读秒
  // 走满一整段 60s（读秒模式下）→ 扣 1 段，下一段满
  s = tickClock(s, 60_000, CFG);
  ok(s.timeout === null, '还有段，不判负');
  ok(s.me.periodsLeft === 2, `黑剩 2 段，实际 ${s.me.periodsLeft}`);
  ok(s.me.periodMs === 60_000, '下一段满');
});

/* ── 读秒耗尽判负 ── */

test('clock: 最后一段读秒耗尽判超时负', () => {
  let s = initialClock(CFG);
  s = tickClock(s, 30_000, CFG);             // 黑进读秒 3 段
  s = afterMoveClock(s, 1, CFG);             // 黑落子扣段 → 2 段
  s = afterMoveClock(s, 1, CFG);             // 黑再扣段 → 1 段
  ok(s.me.periodsLeft === 1, `黑剩 1 段，实际 ${s.me.periodsLeft}`);
  // 关键：必须轮到黑，黑走满最后一段才会超时（toPlay 决定谁走表）
  s = { ...s, toPlay: 1 };
  s = tickClock(s, 60_000, CFG);             // 黑走满最后一段 → 超时
  ok(s.timeout === 1, `黑应超时，实际 timeout=${s.timeout}`);
  ok(s.me.periodsLeft === 0, '段数归零');
});

test('clock: 超时后定格不再走表', () => {
  let s: ClockState = { ...initialClock(CFG) };
  // 人为构造一个已超时状态
  s = { me: { mainMs: 0, periodsLeft: 0, periodMs: 0, inByoyomi: true }, opp: { mainMs: 30000, periodsLeft: 3, periodMs: 60000, inByoyomi: false }, toPlay: 1, timeout: 1 };
  const after = tickClock(s, 5_000, CFG);
  ok(after === s, '已超时状态原样返回（不新建）');
  ok(after.timeout === 1, '仍超时');
});

/* ── 格式化 ── */

test('clock: formatClock 主时间 mm:ss / 读秒带段数', () => {
  let s = initialClock(CFG);
  ok(formatClock(s.me) === '0:30', `主时间 0:30，实际 ${formatClock(s.me)}`);
  s.me.mainMs = 5_400;                        // 5.4s → ceil 6s
  ok(formatClock(s.me) === '0:06', `5.4s→0:06，实际 ${formatClock(s.me)}`);
  s = initialClock(CFG);
  s = tickClock(s, 30_000, CFG);
  ok(formatClock(s.me) === '1:00 (3)', `读秒 1:00 (3)，实际 ${formatClock(s.me)}`);
});

/* ── 默认配置 ── */

test('clock: 默认配置 = 30s + 3×60s 读秒', () => {
  ok(DEFAULT_CLOCK.mainSec === 30, '主 30s');
  ok(DEFAULT_CLOCK.periods === 3, '3 段');
  ok(DEFAULT_CLOCK.periodSec === 60, '每段 60s');
});
