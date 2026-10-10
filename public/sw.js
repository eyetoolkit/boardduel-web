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

   ⚠️ 显式排除 /games/go/model/（KataGo 权重 b6c96.bin.gz，3.7MB）：
      - 按需加载即可，缓存它只会挤占配额
      - 模型版本与前端代码强绑定，缓存易造成「代码更新 + 模型旧」的不一致
      /games/go/lib/（TF.js + KataGo JS 运行时，1.2MB）不排除：内容稳定且每次
      开围棋页都要加载，缓存收益明显。
   ═══════════════════════════════════════════════════════════════ */
const V = 'bdsw-v1';
const ASSET_RE = /^\/(assets|fonts)\//;
const ICON_RE = /^\/(icon\.svg|favicon\.ico|favicon\.svg|apple-touch-icon\.png|manifest(\.[a-z]{2})?\.webmanifest)$/;
const SKIP_RE = /^\/games\/go\/model\//; // 大体积按需资源，不进缓存

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.pathname.startsWith('/ws')) return;
  if (SKIP_RE.test(url.pathname)) return;

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
