/**
 * 围棋 · 中日式棋钟（byoyomi clock）—— 纯逻辑，无 DOM、无计时器（测试友好）
 *
 * 规则（中国/日本「读秒」制）：
 *   1. 每方有「主时间」mainSec（如 600s）+ 「读秒」periods 段（如 5 段 × periodSec=60s）。
 *   2. 主时间走完 → 进入读秒：每落一手扣 1 段（从当前段的时间里扣）。
 *   3. 读秒时间用尽且无剩余段 → 该方超时判负。
 *   4. 读秒模式下若在段内提前落子，剩余时间**不累积**到下一段（标准读秒规则），
 *      但会把当前段重置为满段 periodSec（下一手重新给满 read 秒）。
 *
 * 设计：所有状态变化都是纯函数（tick 返回新状态或 null 表示无变化），
 * UI 层（index.ts）用 requestAnimationFrame / setInterval 驱动 tick 并渲染。
 * 这样棋钟规则可独立单测，不依赖真实计时。
 */
import type { Player } from './engine.ts';

export interface ClockConfig {
  /** 主时间（秒） */
  mainSec: number;
  /** 读秒段数（中日式通常 3） */
  periods: number;
  /** 每段读秒时长（秒） */
  periodSec: number;
}

export interface SideClock {
  /** 剩余主时间（毫秒）。进入读秒后为 0 */
  mainMs: number;
  /** 剩余读秒段数 */
  periodsLeft: number;
  /** 当前段剩余时间（毫秒） */
  periodMs: number;
  /** 已进入读秒（主时间已用尽） */
  inByoyomi: boolean;
}

export interface ClockState {
  me: SideClock;
  opp: SideClock;
  /** 当前该走谁（与引擎 toPlay 同步）；由 UI 层设置 */
  toPlay: Player;
  /** 某方是否已超时（判负）。null = 都还在走 */
  timeout: Player | null;
}

/**
 * 🔴 2026-10-04 修正（原值 30s + 3×60s —— 配置量级错了，实测必超时）
 *
 * 原配置下按正常节奏推演（实测脚本跑过 clock.ts 真实逻辑）：
 *   人类 8s/手 →主时间只够 3 手 + 读秒 3 手 → **第 13 手被判超时**
 *   人类 12s/手 → 主时间只够 2 手 + 读秒 3 手 → **第 11 手被判超时**
 *   人类 20s/手 → 主时间只够 1 手 + 读秒 3 手 → **第  9 手被判超时**
 * 而 19 路一局要 100~200 手 ⇒ 玩家「正常下」也必定在第 9~13 手看到超时提示。
 *根因是把棋钟当成了「反应速度测试」，而不是「一整局的总预算」。
 *
 * 现在的量级按「一局 19 路（~150 手）+ 人类平均 8~12s/手」定：
 *   主时间 10 min = 600s，覆盖约 50~75 手（读秒段另有 5 手余量）
 *   读秒 5 段 × 60s，每段 1 分钟是中日规则惯例（读秒制的「一气」长度）
 */
export const DEFAULT_CLOCK: ClockConfig = { mainSec: 600, periods: 5, periodSec: 60 };

/** 某方是否还在走（未超时） */
export function sideActive(c: SideClock): boolean {
  if (c.inByoyomi) return c.periodsLeft > 0 && c.periodMs > 0;
  return c.mainMs > 0;
}

function freshSide(cfg: ClockConfig): SideClock {
  return {
    mainMs: cfg.mainSec * 1000,
    periodsLeft: cfg.periods,
    periodMs: cfg.periodSec * 1000,
    inByoyomi: false,
  };
}

/** 初始状态：双方满时间，黑（me=1）先行 */
export function initialClock(cfg: ClockConfig = DEFAULT_CLOCK): ClockState {
  return { me: freshSide(cfg), opp: freshSide(cfg), toPlay: 1, timeout: null };
}

function sideOf(s: ClockState, p: Player): SideClock {
  return p === 1 ? s.me : s.opp;
}

/**
 * 推进 dtMs 毫秒（UI 层每帧/每秒调用）。
 * 返回**新状态**；若该方仍在走且未超时，返回推进后的状态；
 * 若该方时间耗尽（主时间用尽进读秒、读秒也耗尽）→ 设置 timeout 并停止走表。
 * 注：只给 toPlay 的一方走表（AI 思考 / 轮空不动）。
 */
export function tickClock(prev: ClockState, dtMs: number, cfg: ClockConfig = DEFAULT_CLOCK): ClockState {
  if (prev.timeout !== null) return prev;            // 已有人超时，定格
  const s: ClockState = { me: { ...prev.me }, opp: { ...prev.opp }, toPlay: prev.toPlay, timeout: null };
  const me = sideOf(s, prev.toPlay);
  // 读秒段数已用尽 → 该方无时间可走（刚用掉最后一段，轮回来发现没段了）→ 超时判负
  if (me.inByoyomi && me.periodsLeft <= 0) { s.timeout = prev.toPlay; return s; }
  if (!sideActive(me)) return s;

  let remain = dtMs;
  if (!me.inByoyomi) {
    if (remain < me.mainMs) {
      me.mainMs -= remain;
      remain = 0;
    } else {
      remain -= me.mainMs;
      me.mainMs = 0;
      me.inByoyomi = true;                          // 主时间耗尽 → 进入读秒
    }
  }
  if (me.inByoyomi && remain > 0) {
    if (remain < me.periodMs) {
      me.periodMs -= remain;
      remain = 0;
    } else {
      // 本段读秒用尽 → 扣一段，进入下一段（若还有段）；否则超时
      remain -= me.periodMs;
      me.periodsLeft -= 1;
      if (me.periodsLeft <= 0) {
        me.periodsLeft = 0;
        me.periodMs = 0;
        s.timeout = prev.toPlay;                     // 读秒耗尽 → 该方超时判负
        return s;
      }
      me.periodMs = cfg.periodSec * 1000;            // 下一段给满
    }
  }
  return s;
}

/**
 * 落子后调用：把「刚走完的一方」扣 1 段读秒（若在读秒），并把表交给对方。
 * 主时间模式下不扣段（只轮转）。进读秒时下一段重置为满 periodSec。
 * 返回新状态（toPlay 轮转到对方）。
 */
export function afterMoveClock(prev: ClockState, mover: Player, cfg: ClockConfig = DEFAULT_CLOCK): ClockState {
  if (prev.timeout !== null) return prev;
  const s: ClockState = { me: { ...prev.me }, opp: { ...prev.opp }, toPlay: prev.toPlay, timeout: null };
  const side = sideOf(s, mover);
  if (side.inByoyomi && !s.timeout) {
    // 落子即算用掉当前段：扣段，剩余段给满
    if (side.periodsLeft > 0) {
      side.periodsLeft -= 1;
      side.periodMs = cfg.periodSec * 1000;
    }
  }
  s.toPlay = mover === 1 ? 2 : 1;                     // 轮转
  return s;
}

/** 格式化：主时间模式 → mm:ss；读秒模式 → "M:SS (n)"（n=剩余段） */
export function formatClock(c: SideClock): string {
  if (c.inByoyomi) {
    const totalSec = Math.ceil(c.periodMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s} (${c.periodsLeft})`;
  }
  const totalSec = Math.ceil(c.mainMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
