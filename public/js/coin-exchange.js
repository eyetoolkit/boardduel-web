(function(){
  /* ============================================================
     去广告信息面板（2026-10-22 经济巡检 P0-3 诚实化）
     原「积分兑换免广告」弹窗已下架：三站零广告代码，"去广告"在卖不存在的产品。
     现改为诚实信息面板 —— 仅展示余额 + 说明，无任何购买 / 扣款入口。
     触发：任意 <a data-exchange> 点击打开（保留触发以便解释，但不再有购买按钮）。
  ============================================================ */
  'use strict';

  function T(k, fb) {
    try {
      if (window.t) { var v = window.t(k); if (v && v !== k) return v; }
      if (window.i18n && window.i18n.t) { var w = window.i18n.t(k); if (w && w !== k) return w; }
    } catch (e) {}
    return fb || k;
  }

  function qs(s) { return document.querySelector(s); }
  function qsa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  var state = { coins: 0, loading: false };

  function renderContent(d) {
    state.coins = d && d.coins !== undefined ? d.coins : 0;
    var adActive = d && d.ad_free && d.ad_free.active;
    var adDays = 0;
    if (adActive) {
      adDays = Math.ceil((d.ad_free.expires_at - Date.now()) / 86400000);
    }

    var html = '<div style="max-height:70vh;overflow-y:auto;padding-right:4px">';
    if (adActive) {
      html += '<div style="background:#dcfce7;border:1px solid #86efac;color:#166534;padding:12px;border-radius:10px;margin-bottom:16px;font-weight:600;text-align:center">\u2705 ' + T('coins.ad_free_active','Ad-free active, remaining ') + '<b>' + adDays + '</b>' + T('coins.days',' days') + '</div>';
    }
    html += '<div style="background:#f9fafb;border-radius:10px;padding:16px;margin-bottom:16px;text-align:center">';
    html += '<div style="font-size:12px;color:#6b7280;margin-bottom:4px">' + T('coins.current_balance','Current points') + '</div>';
    html += '<div style="font-size:28px;font-weight:800;color:#1f2937">\uD83E\uDE99 ' + state.coins.toLocaleString() + '</div>';
    html += '</div>';
    html += '<div style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;padding:14px 16px;border-radius:10px;font-size:13px;line-height:1.6">';
    html += '\u2139\uFE0F ' + T('coins.adfree_info','This site currently runs no ads, so there is nothing to remove yet. The ad-free perk is reserved for future ad-supported features — we will open purchases once real ads launch.');
    html += '</div>';
    html += '</div>';
    return html;
  }

  function open() {
    injectStyles();
    var overlay = qs('#exchange-overlay');
    if (!overlay) createOverlay();
    overlay = qs('#exchange-overlay');
    overlay.style.display = 'flex';

    refresh(function(d) {
      var panel = qs('#exchange-panel');
      if (panel) panel.innerHTML = renderContent(d);
    });
  }

  function close() {
    var overlay = qs('#exchange-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function refresh(cb) {
    fetch('/api/coins/me', { credentials: 'same-origin' })
      .then(function(r){ return r.json(); })
      .then(function(d){ state.coins = d && d.coins !== undefined ? d.coins : 0; if (cb) cb(d); })
      .catch(function(){ if (cb) cb(null); });
  }

  function createOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'exchange-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:none;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML =
      '<div id="exchange-panel" style="background:#fff;border-radius:16px;width:min(460px,96vw);max-height:90vh;overflow-y:auto;padding:28px 24px 24px;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.2)">' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function(e){
      if (e.target === overlay) close();
    });

    document.addEventListener('click', function(e){
      var target = e.target;
      if (!target) return;
      if (target.closest('[data-exchange]')) { e.preventDefault(); open(); return; }
    });
  }

  function injectStyles() {
    if (qs('#exchange-styles')) return;
    var css = document.createElement('style');
    css.id = 'exchange-styles';
    css.textContent = [
      '#exchange-overlay { animation: fadeIn .2s ease }',
      '@keyframes fadeIn { from{opacity:0} to{opacity:1} }'
    ].join('\n');
    document.head.appendChild(css);
  }

  if (typeof window !== 'undefined') window.CoinExchange = { open: open, close: close, refresh: refresh };
})();
