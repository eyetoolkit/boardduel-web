// Board Duel 棋盘对决 — Service Worker
// 加载三站共享 SW 策略（/shared/sw-helpers.js），本站参数如下：

importScripts('/shared/sw-helpers.js');

TriSW.create({
  CACHE_VERSION: 'boardduel-v13-p0front',
  NETWORK_FIRST: [
    '/',
    '/about/', '/contact/', '/privacy/', '/terms/',
    '/shop/', '/rank/', '/stats/',
    '/games/'
  ],
  CACHE_FIRST: [
    '/manifest.webmanifest',
    '/css/shared/tokens.css',
    '/css/shared/sidebar.css',
    '/css/shared/components.css',
    '/css/shared/toast.css',
    '/js/sidebar.js',
    '/js/toast.js'
  ],
  PRECACHE: [
    '/manifest.webmanifest'
  ]
});