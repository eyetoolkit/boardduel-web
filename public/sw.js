/* ═══════════════════════════════════════════════════════════════
   BoardDuel Service Worker —— 最小可用 PWA 策略
   ────────────────────────────────────────────────────────────────
   移植自 NumeriDuel 已上线的 sw.js（同一套策略），并按本站资产调整。

   原则（与 CF Pages + HTML max-age=0 must-revalidate 约束共存）：
   1. /api/、/ws（WebSocket 升级）绝不拦截 —— 实时对局与账号数据永远走网络
      （本站 API：/api/leaderboard、/api/account/me、/api/gp/room 等均在 /api/ 下）
   2. /assets/（vite 带 hash、内容不变）与 /fonts/：cache-first
   3. 页面导航（HTML）：network-first —— 永远优先最新版，断网才用缓存
   4. 其余同源静态（/shared/、/sfx/、图标等）：stale-while-revalidate
   换版本：V 常量升级即弃旧缓存。

   🔴 2026-10-24 变更（第四批）：/games/go/model/ 改为**版本化缓存**。
      此前显式排除它，理由是「模型与前端代码强绑定，缓存易不一致」——
      但实测代价更大：每次开围棋页都要重新拉 3.7MB 权重，弱网下要等好几秒。
      解法不是不缓存，而是**按文件名版本化**：权重文件名自带内容哈希前缀
      （b6c96.bin.gz，由 _spike-katago-b6c96/tools/verify-sizes.cjs 门禁），
      换模型 → 文件名变 → URL 变 → 自动成为新缓存条目；旧条目在 activate 里
      按 MODEL_FILES 白名单清理。这样既省 3.7MB 重复流量，又不会「代码新 + 模型旧」。
      ⚠️ 换模型文件时必须同步更新下面的 MODEL_FILES（否则新文件不被缓存、
      旧文件也不会被清）。
      /games/go/lib/（TF.js + KataGo JS 运行时，1.2MB）照旧缓存：内容稳定。
   ═══════════════════════════════════════════════════════════════ */
const V = 'bdsw-v2';
/** 模型缓存独立成桶：换前端版本不该连带把 3.7MB 权重冲掉 */
const MODEL_CACHE = 'bdsw-model-v1';
/** 当前在用的模型文件白名单（换模型必须同步改这里） */
const MODEL_FILES = ['/games/go/model/b6c96.bin.gz'];
const ASSET_RE = /^\/(assets|fonts)\//;
const ICON_RE = /^\/(icon\.svg|favicon\.ico|favicon\.svg|apple-touch-icon\.png|manifest(\.[a-z]{2})?\.webmanifest)$/;
const MODEL_RE = /^\/games\/go\/model\//; // 版本化文件名 → 可安全 cache-first

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V && k !== MODEL_CACHE).map((k) => caches.delete(k))))
      // 模型桶：只保留白名单里的文件名（换模型后旧权重自动淘汰）
      .then(() => caches.open(MODEL_CACHE)
        .then((c) => c.keys().then((reqs) => Promise.all(reqs
          .filter((r) => !MODEL_FILES.includes(new URL(r.url).pathname))
          .map((r) => c.delete(r)))))
        .catch(() => undefined))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.pathname.startsWith('/ws')) return;
  // 0) KataGo 权重：文件名带内容哈希 → cache-first，命中就不再下 3.7MB
  if (MODEL_RE.test(url.pathname)) {
    event.respondWith(
      caches.open(MODEL_CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) c.put(req, res.clone());
        return res;
      })))
    );
    return;
  }

  // 1) 带内容 hash 的构建产物与字体：cache-first（immutable）
  if (ASSET_RE.test(url.pathname) || ICON_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(V).then((c) => c.put(req, clone));
        }
        return res;
      }))
    );
    return;
  }

  // 2) 页面导航：network-first，离线回落缓存
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(V).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
    );
    return;
  }

  // 3) 其余同源静态：stale-while-revalidate
  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(V).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
