(function() {
/* ═══════════════════════════════════════════════════════════════
   每日题客户端模块
   ────────────────────────────────────────────────────────────────
   用途: 浏览器侧获取每日题 + 倒计时 + URL 检测
   依赖: 全局 fetch API (现代浏览器原生)
   API:
     getKey(date?)              → 'YYYYMMDD' (UTC 日期)
     fetch(game, dateKey?)      → { cards, solutions, ... } 或 null
     nextRollover()             → ms 到下一个 UTC 0 点
     getCurrentDailyUrl(game)   → 完整的今日 URL (?g=...)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const WS_BASE = (typeof window !== 'undefined' && window.MATHDUEL_WS_BASE)
  || (typeof location !== 'undefined' ? location.protocol + '//' + location.host : 'https://mathduel.games');
const HTTP_BASE = WS_BASE.replace(/^wss?:/, '');

/* ─── 本地时区日期键 ─── */
function getKey(date) {
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/* ─── 到下一个本地 0 点的 ms ─── */
function nextRollover() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/* ─── 内存缓存(避免重复请求)─── */
const cache = new Map(); // key: `${game}:${dateKey}` → Promise

/* ─── 主获取函数(自动 fallback)─── */
async function fetchDaily(game, dateKey) {
  dateKey = dateKey || getKey();
  const cacheKey = `${game}:${dateKey}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const url = `${HTTP_BASE}/api/daily/${encodeURIComponent(game)}?d=${dateKey}`;

  const promise = (async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) {
        if (r.status === 404) return null; // 今日题尚未生成
        throw new Error(`HTTP ${r.status}`);
      }
      return await r.json();
    } catch (e) {
      console.warn(`[daily-challenge] fetch(${game}, ${dateKey}) failed:`, e.message);
      return null;
    }
  })();

  cache.set(cacheKey, promise);
  return promise;
}

/* ─── 预加载(可选,优化体验)─── */
async function prefetch(game, dateKey) {
  return fetchDaily(game, dateKey);
}

/* ─── URL 工具: 当前页 + ?g=&d= ─── */
function getCurrentDailyUrl(game, baseUrl) {
  const url = new URL(baseUrl || window.location.href);
  url.searchParams.set('g', game);
  url.searchParams.set('d', getKey());
  return url.toString();
}

/* ─── 解析当前 URL 的 ?g=&d= 参数 ─── */
function parseUrlParams() {
  if (typeof window === 'undefined') return { game: null, dateKey: null };
  const params = new URLSearchParams(window.location.search);
  const game = params.get('g');
  const dateKey = params.get('d');
  const referrer = params.get('r'); // 分享者 sessionId (W3.3 用)
  const medium = params.get('m');   // copy=从分享卡点入
  return { game, dateKey, referrer, medium };
}

/* ─── 倒计时格式化 ─── */
function formatCountdown(ms) {
  if (ms <= 0) return '已换题';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/* ─── 清除缓存(主要用于测试)─── */
function clearCache() {
  cache.clear();
}

/* ─── 浏览器全局 + Node 兼容 ─── */
if (typeof window !== 'undefined') {
  window.DailyChallenge = {
    getKey, fetch: fetchDaily, prefetch, nextRollover,
    getCurrentDailyUrl, parseUrlParams,
    formatCountdown, clearCache,
    fetch: fetchDaily,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getKey, fetch: fetchDaily, prefetch, nextRollover,
    getCurrentDailyUrl, parseUrlParams,
    formatCountdown, clearCache,
    fetch: fetchDaily,
    HTTP_BASE,
  };
}
})();
