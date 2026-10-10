/* Service Worker 注册 —— BoardDuel
   注册失败一律静默：SW 只是「锦上添花的离线能力」，
   任何注册失败都不能影响游戏本身（红线性：静默降级，不冒泡）。
   只在 HTTPS / localhost 下注册（SW 依赖 Secure Context）。 */
(function () {
  try {
    if (!('serviceWorker' in navigator)) return;
    if (!(window.isSecureContext || location.hostname === 'localhost')) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* 静默 */ });
    });
  } catch (e) { /* 静默 */ }
})();
