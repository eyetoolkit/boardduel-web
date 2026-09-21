/* ═══════════════════════════════════════════════════════════════
   EP2 对局 emoji 反应（共享前端模块，无需实时推送）
   ────────────────────────────────────────────────────────────────
   依赖:
     - 页面标记 <div id="so-react"> 包含:
         <div id="so-react-counts"></div>   // 计数/昵称样本
         <button onclick="window.reactE('🔥')">🔥</button>
     - 每个游戏页设置 window.__reactionGame = '24-game' 等
   行为:
     - loadReactions(): GET /api/daily/{game}/reactions?d=今日 → 渲染计数
     - reactE(emoji):  POST /api/daily/{game}/react → 再刷新
     - 日期: 优先取 #daily-banner-date 文本(YYYYMMDD)，否则用 UTC 今日
   兼容性: 使用 var/function，避免模板字符串。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  window.__reactionGame = window.__reactionGame || '';

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function todayKey() {
    var d = new Date();
    return String(d.getUTCFullYear()) + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
  }

  function detectDate() {
    var el = document.getElementById('daily-banner-date');
    if (el) {
      var t = (el.textContent || '').trim();
      if (/^\d{8}$/.test(t)) return t;
    }
    return todayKey();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getGame() { return window.__reactionGame || ''; }

  function countsEl() { return document.getElementById('so-react-counts'); }

  function renderCounts(reactions) {
    var el = countsEl();
    if (!el) return;
    var list = reactions || [];
    if (!list.length) { el.innerHTML = ''; return; }
    var html = list.map(function (r) {
      var samples = (r.samples && r.samples.length)
        ? ' <span style="color:var(--text-light)">' + esc(r.samples.join('、')) + '</span>'
        : '';
      return '<span class="so-react-chip">' + r.emoji + ' ×' + r.count + samples + '</span>';
    }).join('');
    el.innerHTML = html;
  }

  window.loadReactions = function () {
    var game = getGame();
    if (!game) return;
    fetch('/api/daily/' + encodeURIComponent(game) + '/reactions?d=' + detectDate(), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data && data.reactions) renderCounts(data.reactions); })
      .catch(function () { /* 静默失败 */ });
  };

  window.reactE = function (emoji) {
    var game = getGame();
    if (!game) return;
    var body = JSON.stringify({ date: detectDate(), emoji: emoji });
    // 先确保匿名 cookie
    fetch('/api/account/me', { method: 'GET', credentials: 'same-origin' })
      .then(function () {
        return fetch('/api/daily/' + encodeURIComponent(game) + '/react', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          credentials: 'same-origin',
        });
      })
      .then(function () { window.loadReactions(); })
      .catch(function () { /* 静默 */ });
  };

  // 页面加载完成后拉取一次
  function boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { window.loadReactions(); });
    } else {
      window.loadReactions();
    }
  }
  boot();
})();