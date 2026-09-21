(function() {
/* ═══════════════════════════════════════════════════════════════
   账户模块 (Account — 本地 + 服务端同步)
   ────────────────────────────────────────────────────────────────
   用途: 用户昵称 + 战绩历史 + 导出/导入 + 跨设备同步
   存储: localStorage['md_account'] + 服务端 /api/account/{me,sync}
   接口:
     const account = createAccount({ storage?, fetcher?, enableSync? });
     account.ensure()                         → 初始化 + 触发后台 sync
     account.getProfile()                     → { nickname, created }
     account.setNickname(nick)                → { nickname } 或抛异常
     account.recordGame(game, data)           → 新 history 项 + 异步 sync
     account.getHistory({ game?, limit? })    → [history item...]
     account.getStats()                       → { totalGames, totalCompleted, byGame, ... }
     account.exportData()                     → JSON 字符串
     account.importData(json)                 → 合并后数据
     account.reset()                          → 清空(本地 + 服务端)
     account.syncNow()                        → 立即同步(返回 Promise)
     account.flushPendingSync()               → 失败重试队列
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const STORAGE_KEY = 'md_account';
const MAX_HISTORY = 200;
const NICK_MIN = 1;
const NICK_MAX = 12;

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

/* ─── 脏词过滤(极简列表,后续可扩展)─── */
const PROFANITY = [
  '傻逼', '你妈', '去死', '操你', 'fuck', 'shit', 'bitch',
  'asshole', 'damn', 'bastard', 'idiot',
];

/* ─── 工具: 生成默认昵称 ─── */
function defaultNickname() {
  const num = Math.floor(Math.random() * 9000) + 1000;
  return __('account.default_player', '玩家') + num;
}

/* ─── 工具: 验证昵称 ─── */
function validateNickname(nick) {
  if (typeof nick !== 'string') return { ok: false, error: __('account.nickname_must_be_string', '昵称必须是字符串') };
  const trimmed = nick.trim();
  if (trimmed.length < NICK_MIN) return { ok: false, error: __('account.nickname_too_short', '昵称至少 ' + NICK_MIN + ' 字符') };
  if (trimmed.length > NICK_MAX) return { ok: false, error: __('account.nickname_too_long', '昵称最多 ' + NICK_MAX + ' 字符') };
  const lower = trimmed.toLowerCase();
  for (const w of PROFANITY) {
    if (lower.includes(w)) return { ok: false, error: __('account.nickname_profanity', '昵称包含敏感词,请换个名字') };
  }
  return { ok: true, nickname: trimmed };
}

/* ─── 工具: 生成 ISO 日期键 ─── */
function dateKey(date) {
  const d = date || new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/* ─── 默认 storage ─── */
function defaultStorage() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  const mem = {};
  return {
    getItem: (k) => Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null,
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
}

/* ─── 默认 fetcher(window.fetch 包装)─── */
function defaultFetcher() {
  if (typeof window !== 'undefined' && window.fetch) {
    return (url, opts) => window.fetch(url, opts).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().catch(() => ({}));
    });
  }
  // Node 环境测试用:返回一个 stub(永远 reject)
  return () => Promise.reject(new Error('no fetcher'));
}

/* ─── 工厂 ─── */
function createAccount(opts = {}) {
  const storage = opts.storage || defaultStorage();
  const fetcher = opts.fetcher || defaultFetcher();
  const enableSync = opts.enableSync !== false; // 默认开启
  const apiBase = opts.apiBase || (typeof window !== 'undefined' && window.API_BASE ? window.API_BASE + '/account' : '/api/account');
  // 同步失败重试队列(本地内存)
  const pendingSync = [];

  function load() {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return {
        nickname: typeof parsed.nickname === 'string' ? parsed.nickname : defaultNickname(),
        created: typeof parsed.created === 'string' ? parsed.created : new Date().toISOString(),
        history: Array.isArray(parsed.history) ? parsed.history : [],
      };
    } catch (e) {
      console.warn('[account] Failed to load, creating new:', e.message);
      return null;
    }
  }

  function save(data) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[account] Failed to save:', e.message);
    }
    return data;
  }

  /* ═════════ W6 同步 ═════════ */

  /* ─── 把内部数据转成服务端可识别的格式 ─── */
  function toServerFormat(data) {
    return {
      nickname: data.nickname,
      // streak 在 W6 由 streak.js 单独同步(不同存储),这里不重复
      gameHistory: data.history || [],
    };
  }

  /* ─── 把服务端数据合并回内部(只取 nickname + gameHistory)─── */
  function fromServerFormat(serverAcc) {
    return {
      nickname: serverAcc.nickname,
      history: Array.isArray(serverAcc.gameHistory) ? serverAcc.gameHistory : [],
    };
  }

  /* ─── 异步同步(失败入队,3 次重试)─── */
  async function syncNow() {
    if (!enableSync) return { ok: false, reason: 'disabled' };
    const data = load();
    if (!data) return { ok: false, reason: 'no_local' };
    const payload = toServerFormat(data);
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try {
        await fetcher(`${apiBase}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload),
        });
        return { ok: true };
      } catch (e) {
        lastErr = e;
        // 等待后重试
        await new Promise(r => setTimeout(r, 200 * (i + 1)));
      }
    }
    // 全部失败,加入重试队列
    pendingSync.push({ payload, at: Date.now() });
    return { ok: false, error: lastErr && lastErr.message };
  }

  /* ─── 拉服务端并合并(去重)─── */
  async function pullFromServer() {
    if (!enableSync) return { ok: false, reason: 'disabled' };
    try {
      const res = await fetcher(`${apiBase}/me`, {
        method: 'GET',
        credentials: 'same-origin',
      });
      if (res && res.account) {
        const remote = fromServerFormat(res.account);
        const local = load() || { nickname: defaultNickname(), created: new Date().toISOString(), history: [] };
        // 合并:history 按 game+date+timestamp+duration 去重(可能同一秒写多条)
        const seen = new Set((local.history || []).map(h => `${h.game}:${h.date}:${h.timestamp || ''}:${h.duration || 0}`));
        for (const h of (remote.history || [])) {
          const k = `${h.game}:${h.date}:${h.timestamp || ''}:${h.duration || 0}`;
          if (!seen.has(k)) {
            local.history = (local.history || []).concat(h);
            seen.add(k);
          }
        }
        // 按 timestamp 排序,保留最新 N
        local.history.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
        if (local.history.length > MAX_HISTORY) local.history.splice(0, local.history.length - MAX_HISTORY);
        // nickname: 远程覆盖(信任服务端)
        if (remote.nickname) local.nickname = remote.nickname;
        save(local);
        return { ok: true, merged: true };
      }
      return { ok: false, reason: 'no_account' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /* ─── 把队列里的失败同步重试 ─── */
  async function flushPendingSync() {
    if (!enableSync) return { ok: false };
    while (pendingSync.length) {
      const item = pendingSync.shift();
      try {
        await fetcher(`${apiBase}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(item.payload),
        });
      } catch (e) {
        // 失败放回队列末尾
        pendingSync.push(item);
        return { ok: false, error: e.message };
      }
    }
    return { ok: true };
  }

  /* ─── 触发后台 sync(不阻塞 UI)─── */
  function triggerBackgroundSync() {
    if (!enableSync) return;
    setTimeout(() => {
      syncNow().then(r => {
        if (!r.ok) flushPendingSync();
      }).catch(() => flushPendingSync());
    }, 100);
  }

  /* ─── 初始化:第一次调用时创建默认账户 ─── */
  function initIfNeeded() {
    let data = load();
    if (!data) {
      data = {
        nickname: defaultNickname(),
        created: new Date().toISOString(),
        history: [],
      };
      save(data);
    }
    return data;
  }

  /* ─── 获取 profile(不触发初始化 — 仅查询)─── */
  function getProfile() {
    const data = load();
    if (!data) return null;
    return { nickname: data.nickname, created: data.created };
  }

  /* ─── 确保账户存在并返回 profile ─── */
  function ensure() {
    const data = initIfNeeded();
    return { nickname: data.nickname, created: data.created };
  }

  /* ─── 修改昵称 ─── */
  function setNickname(nick) {
    const v = validateNickname(nick);
    if (!v.ok) throw new Error(v.error);
    const data = initIfNeeded();
    data.nickname = v.nickname;
    save(data);
    return { nickname: data.nickname };
  }

  /* ─── 记录一局游戏 ───
     history 项: { game, date, duration?, solutions_count?, completed?, meta? }
  */
  function recordGame(game, gameData = {}) {
    if (!game || typeof game !== 'string') throw new Error('game is required');

    const data = initIfNeeded();
    const entry = {
      game,
      date: dateKey(),
      timestamp: new Date().toISOString(),
      ...(typeof gameData.duration === 'number' ? { duration: gameData.duration } : {}),
      ...(typeof gameData.solutions_count === 'number' ? { solutions_count: gameData.solutions_count } : {}),
      ...(typeof gameData.completed === 'boolean' ? { completed: gameData.completed } : {}),
      ...(typeof gameData.score === 'number' ? { score: gameData.score } : {}),
      ...(gameData.meta ? { meta: gameData.meta } : {}),
    };

    data.history = data.history.concat(entry).slice(-MAX_HISTORY);
    save(data);
    triggerBackgroundSync(); // W6 异步同步到服务端
    return entry;
  }

  /* ─── 获取历史 ─── */
  function getHistory(opts = {}) {
    const data = initIfNeeded();
    let h = data.history;
    if (opts.game) h = h.filter(e => e.game === opts.game);
    if (opts.limit && opts.limit > 0) h = h.slice(-opts.limit);
    return h;
  }

  /* ─── 统计 ─── */
  function getStats() {
    const data = initIfNeeded();
    const h = data.history;
    const byGame = {};
    let totalCompleted = 0;
    let totalDuration = 0;
    let uniqueDays = new Set();

    for (const e of h) {
      if (!byGame[e.game]) {
        byGame[e.game] = { total: 0, completed: 0, duration: 0 };
      }
      byGame[e.game].total++;
      if (e.completed) { byGame[e.game].completed++; totalCompleted++; }
      if (typeof e.duration === 'number') {
        byGame[e.game].duration += e.duration;
        totalDuration += e.duration;
      }
      if (e.date) uniqueDays.add(e.date);
    }

    return {
      totalGames: h.length,
      totalCompleted,
      totalDuration,
      uniqueDays: uniqueDays.size,
      byGame,
    };
  }

  /* ─── 导出:全量 JSON 字符串 ─── */
  function exportData() {
    const data = initIfNeeded();
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      ...data,
    }, null, 2);
  }

  /* ─── 导入:合并策略 ───
     - 同一 timestamp 的 history 不重复(去重)
     - nickname 取导入数据的(用户明确选择)
  */
  function importData(jsonStr) {
    let imported;
    try {
      imported = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error(__('account.json_format_error', 'JSON 格式错误: ') + e.message);
    }
    if (!imported || !Array.isArray(imported.history)) {
      throw new Error(__('account.missing_history', '缺少 history 数组'));
    }
    if (typeof imported.nickname !== 'string') {
      throw new Error(__('account.missing_nickname', '缺少 nickname'));
    }

    const data = initIfNeeded();

    // 合并 nickname(用导入的)
    if (validateNickname(imported.nickname).ok) {
      data.nickname = imported.nickname.trim();
    }

    // 合并 history(去重:同 timestamp 不重复)
    const existingTs = new Set(data.history.map(e => e.timestamp));
    const newEntries = imported.history.filter(e => !e.timestamp || !existingTs.has(e.timestamp));
    data.history = data.history.concat(newEntries).slice(-MAX_HISTORY);

    save(data);
    return { nickname: data.nickname, historyCount: data.history.length, imported: newEntries.length };
  }

  function reset() {
    try { storage.removeItem(STORAGE_KEY); } catch (e) {}
    // W6: 异步通知服务端清除
    if (enableSync) {
      setTimeout(() => {
        try {
          fetcher(`${apiBase}/me`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
        } catch (e) {}
      }, 50);
    }
    return null;
  }

  /* ─── 异步 ensure:初始化 + 拉服务端合并 ─── */
  async function ensureAsync() {
    initIfNeeded();
    if (!enableSync) return { ok: false, reason: 'disabled' };
    return await pullFromServer();
  }

  return {
    getProfile, ensure, ensureAsync, setNickname,
    recordGame, getHistory, getStats,
    exportData, importData, reset,
    syncNow, pullFromServer, flushPendingSync,
    // 测试用
    _load: load, _initIfNeeded: initIfNeeded,
    _validateNickname: validateNickname,
    _defaultNickname: defaultNickname,
    _toServerFormat: toServerFormat,
    _fromServerFormat: fromServerFormat,
  };
}

/* ─── 浏览器 + Node ─── */
if (typeof window !== 'undefined') {
  window.Account = { createAccount, STORAGE_KEY };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createAccount, STORAGE_KEY, validateNickname, defaultNickname, dateKey };
}
})();
