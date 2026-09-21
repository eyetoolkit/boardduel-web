(function() {
/* ═══════════════════════════════════════════════════════════════
   W7.1 分析埋点模块
   ────────────────────────────────────────────────────────────────
   用途: 上报关键事件到服务端 /api/track
   事件:
     - daily_open         {game, date}
     - daily_complete     {game, duration, score}
     - daily_share        {game, cta, surface}
     - daily_challenge_accept {game, from_session}
     - streak_milestone   {days, badge}
     - page_view          {page, ref}
   存储: localStorage['md_analytics_queue'] + 服务端 /api/track
   接口:
     window.MDAnalytics = {
       track(event, props),  // 异步上报(失败重试 3 次)
       flush(),              // 立即发送队列
       getQueue(),           // 查看队列
       page(page, ref),      // page_view 简写
     }
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const QUEUE_KEY = 'md_analytics_queue';
const MAX_QUEUE = 100;
const FLUSH_INTERVAL = 30000; // 30s

function defaultStorage() {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  const m = {};
  return { getItem: k => m[k] || null, setItem: (k, v) => { m[k] = v; }, removeItem: k => delete m[k] };
}

function defaultFetcher() {
  if (typeof window !== 'undefined' && window.fetch) {
    return (url, opts) => window.fetch(url, opts).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().catch(() => ({}));
    });
  }
  return () => Promise.reject(new Error('no fetcher'));
}

function createAnalytics(opts = {}) {
  const storage = opts.storage || defaultStorage();
  const fetcher = opts.fetcher || defaultFetcher();
  const apiBase = opts.apiBase || (typeof window !== 'undefined' && window.API_BASE ? window.API_BASE : '/api');
  const debug = opts.debug === true;
  let flushTimer = null;

  function load() {
    try {
      const raw = storage.getItem(QUEUE_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (e) { return []; }
  }

  function save(queue) {
    try { storage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE))); }
    catch (e) {}
  }

  function enqueue(event) {
    const queue = load();
    queue.push(event);
    save(queue);
  }

  async function flush() {
    const queue = load();
    if (queue.length === 0) return { ok: true, sent: 0 };
    let sent = 0;
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try {
        await fetcher(`${apiBase}/track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ events: queue }),
        });
        // 成功 → 清空队列
        save([]);
        sent = queue.length;
        return { ok: true, sent };
      } catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, 200 * (i + 1)));
      }
    }
    return { ok: false, error: lastErr && lastErr.message };
  }

  async function track(event, props = {}) {
    const evt = {
      event,
      props,
      timestamp: new Date().toISOString(),
      url: typeof location !== 'undefined' ? location.href : '',
      referrer: typeof document !== 'undefined' ? document.referrer : '',
      sessionId: getSessionId(),
    };
    if (debug) console.log('[analytics]', event, props);
    enqueue(evt);
    // 节流:每 5s 最多 flush 一次
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush().catch(() => {});
      }, 1000);
    }
  }

  function getSessionId() {
    try {
      const k = 'md_session_id';
      let v = storage.getItem(k);
      if (!v) {
        v = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        storage.setItem(k, v);
      }
      return v;
    } catch (e) { return 'anon'; }
  }

  function page(pageName, ref) {
    return track('page_view', { page: pageName, ref });
  }

  function start() {
    // 启动时 flush + 定时 flush
    flush().catch(() => {});
    if (flushTimer) clearInterval(flushTimer);
    setInterval(() => { flush().catch(() => {}); }, FLUSH_INTERVAL);
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        // 同步尝试 flush(navigator.sendBeacon 更优,但简单实现即可)
        try {
          const queue = load();
          if (queue.length === 0) return;
          if (navigator.sendBeacon) {
            navigator.sendBeacon(`${apiBase}/track`, JSON.stringify({ events: queue }));
          }
        } catch (e) {}
      });
    }
  }

  return {
    track,
    flush,
    page,
    getQueue: load,
    start,
    _save: save,
    _enqueue: enqueue,
  };
}

/* ─── 浏览器 + Node ─── */
if (typeof window !== 'undefined') {
  window.MDAnalytics = { create: createAnalytics };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createAnalytics, QUEUE_KEY };
}
})();
