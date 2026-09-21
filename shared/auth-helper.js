/* ═══════════════════════════════════════════════════════════════
   boardduel shared auth-helper
   ────────────────────────────────────────────────────────────────
   P5 (W8): 给所有 boardduel 游戏页 / 主页注入 window.MD_AUTH
     - 自动 fetch /api/auth/me
     - 写入 window.MD_AUTH = { uuid, email, nickname, tier }
   用法: <script src="/shared/auth-helper.js" defer></script>
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  // 立即设空对象, 避免 race condition (脚本 defer 时 connect4/index.html 的同步代码可能引用)
  window.MD_AUTH = { uuid: null, tier: null, loaded: false };
  window.addEventListener('md-auth-needed', () => {
    // connect4 等游戏在 connectRoom 前调用此事件, 确保 MD_AUTH 已加载
  });
  const API_BASE = (typeof window.API_BASE === 'string' ? window.API_BASE : '') + '/auth';
  fetch(API_BASE + '/me', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (d && d.uuid) {
        window.MD_AUTH = {
          uuid: d.uuid,
          email: d.email,
          nickname: d.nickname,
          tier: d.tier || null,
          loaded: true,
        };
        // 触发自定义事件, 让其他组件可以监听
        window.dispatchEvent(new CustomEvent('md-auth-ready', { detail: window.MD_AUTH }));
      } else {
        window.MD_AUTH.loaded = true;
        window.dispatchEvent(new CustomEvent('md-auth-ready', { detail: window.MD_AUTH }));
      }
    })
    .catch(() => {
      window.MD_AUTH.loaded = true;
      window.dispatchEvent(new CustomEvent('md-auth-ready', { detail: window.MD_AUTH }));
    });
})();