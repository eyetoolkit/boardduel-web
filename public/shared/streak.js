(function() {
/* ═══════════════════════════════════════════════════════════════
   连击 (Streak) 模块
   ────────────────────────────────────────────────────────────────
   用途: 跟踪用户每日连击 + 徽章解锁 + 跨游戏共享 streak
   存储: localStorage['md_streak']
   接口:
     const streak = createStreak({ now?, storage? });
     streak.recordComplete(game, date?)   → 新 streak 数据
     streak.getStreak()                   → { count, lastDate }
     streak.getBadges()                   → [{ id, icon, text, threshold }]
     streak.getHistory()                  → [{ date, game }]
     streak.reset()                       → 清空
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const STORAGE_KEY = 'md_streak';

/* ─── 翻译函数 ─── */
function __(key, fallback) {
  if (typeof window !== 'undefined') {
    if (window.i18n && typeof window.i18n.t === 'function') {
      return window.i18n.t(key);
    }
    if (window.__ && typeof window.__ === 'function') {
      return window.__(key);
    }
  }
  return fallback || key;
}

const BADGES = [
  { id: 'fire_start', icon: '🔥', textKey: 'streak.badge_fire_start', threshold: 3 },
  { id: 'week_one',   icon: '🌾', textKey: 'streak.badge_week_one', threshold: 7 },
  { id: 'month_full', icon: '🏆', textKey: 'streak.badge_month_full', threshold: 30 },
  { id: 'season',     icon: '👑', textKey: 'streak.badge_season', threshold: 100 },
];

/* ─── 获取徽章文本 ─── */
function getBadgeText(badge) {
  return __(badge.textKey, badge.textKey);
}

/* ─── 工具: UTC 日期键(YYYYMMDD)─── */
function getKey(date) {
  const d = date || new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/* ─── 工具: 两个 YYYYMMDD 字符串相差的天数 ─── */
function daysBetween(prev, curr) {
  if (!prev) return Infinity;
  // YYYYMMDD → Date(UTC 0 点)
  const p = new Date(Date.UTC(
    Number(prev.slice(0, 4)),
    Number(prev.slice(4, 6)) - 1,
    Number(prev.slice(6, 8))
  ));
  const c = new Date(Date.UTC(
    Number(curr.slice(0, 4)),
    Number(curr.slice(4, 6)) - 1,
    Number(curr.slice(6, 8))
  ));
  return Math.round((c - p) / (24 * 3600 * 1000));
}

/* ─── 工具: 找出当前 count 触达的所有徽章 id ─── */
function badgesForCount(count) {
  return BADGES.filter(b => count >= b.threshold).map(b => b.id);
}

/* ─── 默认 storage(浏览器 localStorage)─── */
function defaultStorage() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  // Node 环境:返回 in-memory mock
  const mem = {};
  return {
    getItem: (k) => Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null,
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
}

/* ─── 工厂 ─── */
function createStreak(opts = {}) {
  const now = opts.now || (() => new Date());
  const storage = opts.storage || defaultStorage();

  function load() {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return { count: 0, lastDate: null, badges: [], history: [] };
      const parsed = JSON.parse(raw);
      // 防御:旧格式/损坏数据
      return {
        count: Number.isInteger(parsed.count) ? parsed.count : 0,
        lastDate: typeof parsed.lastDate === 'string' ? parsed.lastDate : null,
        badges: Array.isArray(parsed.badges) ? parsed.badges : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
      };
    } catch (e) {
      console.warn('[streak] Failed to load, resetting:', e.message);
      return { count: 0, lastDate: null, badges: [], history: [] };
    }
  }

  function save(data) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[streak] Failed to save:', e.message);
    }
    return data;
  }

  function getStreak() {
    const data = load();
    // 浏览器打开时如果今天还没玩,只返回缓存(不重置 — recordComplete 才重置)
    return { count: data.count, lastDate: data.lastDate };
  }

  function getBadges() {
    return load().badges.map(id => {
      const badge = BADGES.find(b => b.id === id);
      if (!badge) return null;
      return {
        ...badge,
        text: getBadgeText(badge),
      };
    }).filter(Boolean);
  }

  function getAllBadges() {
    return BADGES.slice();
  }

  function getHistory() {
    return load().history.slice();
  }

  /* ─── 记录一次完成 ───
     - 同一天再玩:count 不变,但记录 history
     - 隔 1 天:count + 1
     - 隔 ≥2 天或从未玩:count 重置为 1
  */
  function recordComplete(game, date) {
    const today = getKey(date || now());
    const data = load();

    if (data.lastDate === today) {
      // 同一天,只追加 history
      const history = data.history.concat({ date: today, game }).slice(-100);
      return save({ ...data, history });
    }

    const diff = daysBetween(data.lastDate, today);
    let newCount;
    if (diff === 1) {
      newCount = data.count + 1; // 连续
    } else {
      newCount = 1; // 首次 / 断档重置
    }

    const newBadges = Array.from(new Set([
      ...data.badges,
      ...badgesForCount(newCount),
    ]));

    const history = data.history.concat({ date: today, game }).slice(-100);

    return save({
      count: newCount,
      lastDate: today,
      badges: newBadges,
      history,
    });
  }

  function reset() {
    try { storage.removeItem(STORAGE_KEY); } catch (e) {}
    return { count: 0, lastDate: null, badges: [], history: [] };
  }

  return {
    recordComplete, getStreak, getBadges, getAllBadges, getHistory, reset,
    // 暴露给测试用
    _load: load,
    _daysBetween: daysBetween,
  };
}

/* ─── 浏览器全局 + Node ─── */
if (typeof window !== 'undefined') {
  window.Streak = { createStreak, BADGES, STORAGE_KEY };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createStreak, BADGES, STORAGE_KEY, daysBetween, badgesForCount, getKey };
}
})();
