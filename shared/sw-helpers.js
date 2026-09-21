/* ============================================================
   Tri-Sites Service Worker 共享策略
   各站 service-worker.js 通过 importScripts('/shared/sw-helpers.js') 加载
   ============================================================ */

var TriSW = (function() {
  /**
   * 创建符合各站点需求的 SW 配置
   * @param {Object} opts
   * @param {string} opts.CACHE_VERSION      - 缓存版本号，如 'boardduel-v3'
   * @param {string[]} opts.NETWORK_FIRST   - network-first 路径列表（HTML 页面）
   * @param {string[]} opts.CACHE_FIRST      - cache-first 静态资源列表
   * @param {string[]} opts.PRECACHE         - 安装时预缓存的资源
   * @param {boolean} opts.PRECACHE_HTML     - 是否预缓存 HTML（如单页应用）
   */
  function create(opts) {
    var CACHE_VERSION = opts.CACHE_VERSION;
    var STATIC_CACHE = opts.CACHE_VERSION + '-static';
    var NETWORK_FIRST = opts.NETWORK_FIRST || ['/'];
    var CACHE_FIRST = opts.CACHE_FIRST || [];
    var PRECACHE = opts.PRECACHE || [];
    var PRECACHE_HTML = opts.PRECACHE_HTML || false;

    // 路径匹配：network-first 适用于任何 HTML 请求
    function isHTMLRequest(request) {
      var accept = request.headers.get('accept') || '';
      return accept.indexOf('text/html') >= 0;
    }

    function isCacheFirstPath(pathname) {
      // 静态资源 + cache-first 列表
      if (CACHE_FIRST.indexOf(pathname) >= 0) return true;
      if (/\.(css|js|webmanifest|woff2?|svg|png|jpg|jpeg|webp|ico)$/i.test(pathname)) return true;
      return false;
    }

    function isNetworkFirstPath(pathname) {
      // 精确匹配或前缀匹配（用于子路径，如 /games/）
      for (var i = 0; i < NETWORK_FIRST.length; i++) {
        var p = NETWORK_FIRST[i];
        if (p === pathname || (p !== '/' && pathname.indexOf(p) === 0)) return true;
      }
      return false;
    }

    self.addEventListener('install', function(e) {
      var assets = PRECACHE.slice();
      if (PRECACHE_HTML && assets.indexOf('/') < 0) assets.push('/');
      e.waitUntil(
        caches.open(STATIC_CACHE)
          .then(function(c) { return c.addAll(assets).catch(function(err) { console.warn('[SW] addAll partial:', err); }); })
          .then(function() { return self.skipWaiting(); })
      );
    });

    self.addEventListener('activate', function(e) {
      e.waitUntil(
        caches.keys().then(function(keys) {
          return Promise.all(keys
            .filter(function(k) { return k !== CACHE_VERSION && k !== STATIC_CACHE; })
            .map(function(k) { return caches.delete(k); })
          );
        }).then(function() { return self.clients.claim(); })
      );
    });

    self.addEventListener('fetch', function(e) {
      if (e.request.method !== 'GET') return;
      var url = new URL(e.request.url);
      if (url.origin !== location.origin) return;

      var pathname = url.pathname;

      // HTML 请求：network-first
      if (isHTMLRequest(e.request)) {
        if (isNetworkFirstPath(pathname)) {
          e.respondWith(networkFirst(e.request));
          return;
        }
        // 其它 HTML（如共享 CSS、JS）
        e.respondWith(cacheFirst(e.request));
        return;
      }

      // 静态资源
      if (isCacheFirstPath(pathname)) {
        e.respondWith(cacheFirst(e.request));
        return;
      }

      // 默认 network-first
      e.respondWith(networkFirst(e.request));
    });

    function networkFirst(request) {
      return fetch(request, { cache: 'no-store' })
        .then(function(resp) {
          if (resp.ok) {
            var clone = resp.clone();
            caches.open(STATIC_CACHE).then(function(c) { c.put(request, clone); });
          }
          return resp;
        })
        .catch(function() {
          return caches.match(request).then(function(cached) {
            return cached || caches.match('/');
          });
        });
    }

    function cacheFirst(request) {
      return caches.match(request).then(function(cached) {
        if (cached) return cached;
        return fetch(request).then(function(resp) {
          if (resp.ok) {
            var clone = resp.clone();
            caches.open(STATIC_CACHE).then(function(c) { c.put(request, clone); });
          }
          return resp;
        }).catch(function() {
          return caches.match('/');
        });
      });
    }

    return {
      CACHE_VERSION: CACHE_VERSION,
      STATIC_CACHE: STATIC_CACHE
    };
  }

  return { create: create };
})();