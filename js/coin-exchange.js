(function(){
  /* ============================================================
     积分兑换免广告弹窗
     Usage:
       CoinExchange.open()     // 打开弹窗
       CoinExchange.close()    // 关闭
       CoinExchange.refresh()  // 刷新数据
     触发：任意 <button data-exchange> 点击打开
  ============================================================ */
  'use strict';

  function T(k, fb) {
    try {
      if (window.t) { var v = window.t(k); if (v && v !== k) return v; }
      if (window.i18n && window.i18n.t) { var w = window.i18n.t(k); if (w && w !== k) return w; }
    } catch (e) {}
    return fb || k;
  }


  /* 兜底价（离线/接口失败时使用）；正常以 GET /api/membership/plans 返回为准 */
  var PRICES = { 1: 3000, 3: 8000, 6: 14000, 12: 24000 };
  var LABELS = { 1: '' + T('coins.dur_1m','1 month') + '', 3: '' + T('coins.dur_3m','3 months') + '', 6: '' + T('coins.dur_6m','6 months') + '', 12: '' + T('coins.dur_12m','1 year') + '' };

  function qs(s) { return document.querySelector(s); }
  function qsa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  var state = { coins: 0, loading: false };

  function renderContent(d) {
    state.coins = d && d.coins !== undefined ? d.coins : 0;
    var adDays = 0;
    var adActive = d && d.ad_free && d.ad_free.active;
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
    html += '<div style="display:grid;gap:10px">';
    for (var m in PRICES) {
      var price = PRICES[m];
      var canAfford = state.coins >= price;
      var deficit = price - state.coins;
      var statusHtml = canAfford
        ? '<span style="color:#16a34a;font-weight:600">\u2713 ' + T('coins.can_exchange','Available') + '</span>'
        : '<span style="color:#dc2626;font-size:12px">' + T('coins.deficit','Off by ') + '' + deficit.toLocaleString() + '</span>';
      html += '<button class="exchange-btn" data-months="' + m + '" style="' +
        'display:flex;align-items:center;justify-content:space-between;' +
        'padding:14px 16px;border-radius:10px;border:1px solid ' + (canAfford ? '#c7d2fe' : '#e5e7eb') + ';' +
        'background:' + (canAfford ? '#fff' : '#f9fafb') + ';cursor:' + (canAfford ? 'pointer' : 'not-allowed') + ';' +
        'font-size:14px;text-align:left;width:100%;' +
        'transition:all .15s;opacity:' + (canAfford ? '1' : '0.6') + '">' +
        '<div><span style="font-weight:700;font-size:16px;color:#1f2937">' + LABELS[m] + '</span><br>' +
        '<span style="color:#6b7280">\uD83E\uDE99 ' + price.toLocaleString() + ' ' + T('coins.points','points</span>') + '</div>' +
        '<div>' + statusHtml + '</div></button>';
    }
    html += '</div>';
    html += '<div style="margin-top:14px;padding:10px;background:#fef9c3;border-radius:8px;font-size:12px;color:#854d0e;text-align:center">\u26A1 ' + T('coins.invite_bonus','Invite a friend, earn 500 points!') + '<br><a href="#" id="go-invite" style="color:#ca8a04;font-weight:600">[ 立即邀请 ]</a></div>';
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
      .then(function(d){
        state.coins = d && d.coins !== undefined ? d.coins : 0;
        if (cb) cb(d);
      })
      .catch(function(){ if (cb) cb(null); });
  }

  function doPurchase(months) {
    if (state.loading) return;
    state.loading = true;
    var btn = qsa('.exchange-btn[data-months="' + months + '"]')[0];
    if (btn) { btn.disabled = true; btn.textContent = '' + T('common.loading','Processing...') + ''; }

    fetch('/api/coins/purchase-adfree', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration_months: parseInt(months) })
    })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d && d.ok) {
          var days = d.days_remaining;
          var html = '<div style="text-align:center;padding:24px 0">' +
            '<div style="font-size:48px;margin-bottom:12px">\uD83C\uDF89</div>' +
            '<div style="font-size:20px;font-weight:700;color:#1f2937;margin-bottom:8px">' + T('coins.exchange_success','Exchange successful!') + '</div>' +
            '<div style="color:#6b7280;margin-bottom:20px">' + T('coins.ad_free_remaining','Ad-free remaining ') + '<b style="color:#4f46e5">' + days + '</b>' + T('coins.days',' days') + '</div>' +
            '<div style="font-size:14px;color:#6b7280">' + T('coins.remaining_balance','Remaining points: ') + '\uD83E\uDE99 <b>' + d.coins.toLocaleString() + '</b></div>' +
            '<button onclick="CoinExchange.close()" style="margin-top:20px;padding:10px 32px;background:#4f46e5;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600">知道了！</button>' +
            '</div>';
          var panel = qs('#exchange-panel');
          if (panel) panel.innerHTML = html;
          if (window.CoinsBar && window.CoinsBar.refresh) window.CoinsBar.refresh();
        } else {
          var errMsg = { insufficient_coins: '' + T('coins.insufficient_balance','Insufficient points') + '' };
          alert((errMsg[d.error] || d.error || '' + T('coins.exchange_failed','Exchange failed') + '') + '！');
          state.loading = false;
          refresh(function(dd){ var p = qs('#exchange-panel'); if (p) p.innerHTML = renderContent(dd); });
        }
      })
      .catch(function(){
        alert('' + T('common.network_error','Network error, please retry!') + '');
        state.loading = false;
        refresh(function(dd){ var p = qs('#exchange-panel'); if (p) p.innerHTML = renderContent(dd); });
      });
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
      if (target.closest('#exchange-close') || (e.target && e.target.id === 'exchange-overlay')) close();
      var btn = target.closest('.exchange-btn');
      if (btn && !btn.disabled) doPurchase(btn.dataset.months);
      if (target.closest('#go-invite')) { close(); setTimeout(function(){ var ie = document.querySelector('[data-open-invite]'); if (ie) ie.click(); }, 300); }
    });
  }

  function injectStyles() {
    if (qs('#exchange-styles')) return;
    var css = document.createElement('style');
    css.id = 'exchange-styles';
    css.textContent = [
      '.exchange-btn:hover { border-color:#4f46e5 !important; background:#eff6ff !important }',
      '#exchange-overlay { animation: fadeIn .2s ease }',
      '@keyframes fadeIn { from{opacity:0} to{opacity:1} }'
    ].join('\n');
    document.head.appendChild(css);
  }

  /* P1 (2026-09-20): 价格以服务端为单一来源（GET /api/membership/plans）——
     此前三站前端各硬编码一份价格，改价必漏站。失败则用上方兜底价。 */
  function loadPlans() {
    fetch('/api/membership/plans', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var plans = d && d.plans;
        if (!Array.isArray(plans) || !plans.length) return;
        var changed = false;
        plans.forEach(function (p) {
          if (p && p.months && p.price && PRICES[p.months] !== p.price) { PRICES[p.months] = p.price; changed = true; }
        });
        if (!changed) return;
        var ov = qs('#exchange-overlay');
        if (ov && ov.style.display === 'flex') {
          refresh(function (dd) {
            var panel = qs('#exchange-panel');
            if (panel) panel.innerHTML = renderContent(dd);
          });
        }
      })
      .catch(function () { /* 保持兜底价 */ });
  }
  loadPlans();

  if (typeof window !== 'undefined') window.CoinExchange = { open: open, close: close, refresh: refresh };
})();
