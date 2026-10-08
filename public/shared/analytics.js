(function() {
/* ═══════════════════════════════════════════════════════════════
   boardduel 埋点模块
   ────────────────────────────────────────────────────────────────
   用途: 上报关键事件到服务端 /api/track
   事件:
     - daily_open         {game, date}
     - daily_complete     {game, duration, score}
     - daily_share        {game, cta, surface}
     - daily_challenge_accept {game, from_session}
     - streak_milestone   {days, badge}
     - page_view          {page, ref}
   存储: localStorage['bd_analytics_queue'] + 服务端 /api/track
   接口:
     window.MDAnalytics = {
       track(event, props),  // 异步上报(失败重试 3 次)
       flush(),              // 立即发送队列
       getQueue(),           // 查看队列
       page(page, ref),      // page_view 简写
     }
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const QUEUE_KEY = 'bd_analytics_queue';
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
      const k = 'bd_session_id';
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

  /* 取消待触发的节流 flush(用于"立即上报"场景, 避免空跑一次) */
  function cancelPendingFlush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
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
    cancelPendingFlush,
    getQueue: load,
    start,
    _save: save,
    _enqueue: enqueue,
  };
}


/* ────────────────────────────────────────────────────────────
 * 行为侦测（零侵入）——不改动任何游戏代码
 * ------------------------------------------------------------
 * 8 款游戏 lobby 页共有的稳定 DOM id（实测交集）：
 *   #mi-engine(AI对局) #mi-pass(pass&play) #mi-friend(好友对战)
 *   #mi-random #mi-ranked #modeGrid(模式选择) #createRoom
 * 棋盘页则通过识别 board/canvas 容器 + 落子类名判定"开始一局"。
 * 这样只改analytics 一个文件即可覆盖全部页面。
 * ──────────────────────────────────────────────────────────── */
function gameKey() {
  const m = location.pathname.match(/\/games\/([a-z0-9-]+)\//i);
  return m ? m[1] : null;
}
function installBehaviorProbe(inst) {
  if (typeof document === 'undefined' || inst._probed) return;
  inst._probed = true;
  const g = gameKey();
  const seen = {};

  // 1) 模式选择(点任一模式卡)→ game_start
  const MODE_HOOKS = ['mi-engine', 'mi-pass', 'mi-friend', 'mi-random', 'mi-ranked', 'mi-clock', 'mi-master'];
  MODE_HOOKS.forEach((id) => {
    document.addEventListener('click', () => {
      const el = document.getElementById(id);
      if (!el) return;
      const mode = el.dataset ? (el.dataset.mode || id.replace('mi-', '')) : id.replace('mi-', '');
      if (seen['start_' + id]) return;
      seen['start_' + id] = 1;
      inst.track('game_start', { game: g, mode: mode });
    }, true);
  });

  // 2) 首次落子 → 记开局时间(棋盘容器/画布)
  const BOARD_SEL = '#board, .board, canvas, .g-board, [data-board]';
  document.addEventListener('click', (e) => {
    if (!g) return;
    const t = e.target;
    const onBoard = t && t.closest && t.closest(BOARD_SEL);
    if (!onBoard) return;
    if (seen.started_at) return;
    seen.started_at = Date.now();
    inst.track('ai_game', { game: g });
  }, true);

  // 3) 页面隐藏时结算局时长(近似 game_complete)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || !seen.started_at || seen.ended_at) return;
    seen.ended_at = 1;
    const dur = Math.round((Date.now() - seen.started_at) / 1000);
    if (dur < 5) return;                 // 太短视为误触
    inst.track('game_complete', { game: g, duration: dur });
  });
}

/* ─── 浏览器 + Node ─── */
if (typeof window !== 'undefined') {
  /* 单例: 自动创建 + 自动启动(定时 flush + 页面退出 beacon 兜底) */
  try {
    const inst = createAnalytics();
    window.BDAnalytics = inst;
    window.MDAnalytics = { create: createAnalytics, instance: inst };
    inst.start();
    installBehaviorProbe(inst);
    /* 首屏立即上报一次 page_view, 保证 DAU 口径完整 */
    inst.page(location.pathname, document.referrer || '');
    /* 首屏事件立即上报: 用户可能 1 秒内就跳走, 不能等节流定时器。
       flush 后清掉 track() 排的节流定时器, 防止 1s 后再空跑一次 flush。 */
    inst.cancelPendingFlush();
    inst.flush().catch(() => {});
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[analytics] init failed', e);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createAnalytics, QUEUE_KEY };
}
})();
