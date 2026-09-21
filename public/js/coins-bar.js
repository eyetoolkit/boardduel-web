(function(){
  /* ============================================================
     积分余额顶栏组件
     Usage:
       window.CoinsBar.init()           // 初始化
       window.CoinsBar.refresh()         // 刷新
       window.CoinsBar.getBalance(cb)    // 获取余额回调
     DOM: 显示积分徽章，点击展开详情弹窗
  ============================================================ */
  'use strict';

  function __(k, fb) {
    try {
      if (window.t) { var v = window.t(k); if (v && v !== k) return v; }
      if (window.i18n && window.i18n.t) { var w = window.i18n.t(k); if (w && w !== k) return w; }
    } catch (e) {}
    return fb || k;
  }


  var API = '/api/coins/me';
  var STORAGE_KEY = 'md_coins_v1';
  var cache = null;
  var cacheTime = 0;
  var CACHE_TTL = 60 * 1000; // 1分钟缓存

  function qs(s) { return document.querySelector(s); }
  function qsa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  function getBalance(cb) {
    var now = Date.now();
    if (cache && now - cacheTime < CACHE_TTL) {
      cb(cache);
      return;
    }
    fetch(API, { credentials: 'same-origin' })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d && d.coins !== undefined) {
          cache = d;
          cacheTime = now;
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ d: d, t: now })); } catch(e){}
          cb(d);
        } else {
          cb(null);
        }
      })
      .catch(function(){ cb(null); });
  }

  function render(bal) {
    var el = qs('#coins-bar-btn');
    if (!el) return;
    if (bal) {
      el.textContent = '\uD83E\uDE99 ' + bal.coins.toLocaleString();
      if (bal.ad_free && bal.ad_free.active) {
        el.classList.add('coins-bar--vip');
      }
    }
  }

  /* ─── P0-4 (2026-09-20): 签到入口 ───
     背景：/api/coins/checkin 规则（+10，7 天连签再 +50）在后端一直在，但三站前端 0 引用、
     全站没有任何 UI ⇒ 签到与"连续签到 3 天"任务不可达。这里把它挂到金币徽章弹窗里。 */
  function todayUTCKey() {
    var d = new Date();
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function checkinBtnHtml(bal) {
    var done = !!(bal && bal.streaks && bal.streaks.last_checkin_date === todayUTCKey());
    if (done) {
      return '<div style="background:#f3f4f6;color:#6b7280;text-align:center;padding:8px;border-radius:8px;font-size:13px;margin-bottom:8px">\u2705 ' + __('coins.checked_in_today', '今日已签到') + '</div>';
    }
    return '<button id="coins-checkin-btn" type="button" style="display:block;width:100%;background:#f59e0b;color:#fff;border:none;text-align:center;padding:8px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:8px">\uD83D\uDCC5 ' + __('coins.checkin_cta', '签到领 10 金币') + '</button>';
  }
  function bindCheckin(popup) {
    var ci = popup.querySelector('#coins-checkin-btn');
    if (!ci) return;
    ci.addEventListener('click', function (e) {
      e.stopPropagation();
      ci.disabled = true;
      ci.textContent = '...';
      fetch('/api/coins/checkin', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          cache = null; cacheTime = 0;
          getBalance(function (nb) { closeAllPopups(); showTooltip(nb); });
        })
        .catch(function () { ci.disabled = false; ci.textContent = __('coins.checkin_cta', '签到领 10 金币'); });
    });
  }

  function showTooltip(bal) {
    closeAllPopups();
    var popup = document.createElement('div');
    popup.id = 'coins-popup';
    popup.style.cssText = [
      'position:absolute','right:0','top:100%','margin-top:8px',
      'background:#fff','border-radius:12px','box-shadow:0 8px 24px rgba(0,0,0,.15)',
      'min-width:200px','padding:16px','z-index:9999','font-size:14px',
      'border:1px solid #e5e7eb','text-align:left'
    ].join(';');

    if (!bal) {
      popup.innerHTML = '<p style="color:#6b7280;margin:0">' + __('coins.login_to_view','Log in to view points') + '</p>';
    } else {
      var adFreeHtml = '';
      if (bal.ad_free && bal.ad_free.active) {
        var days = Math.ceil((bal.ad_free.expires_at - Date.now()) / 86400000);
        adFreeHtml = '<div style="background:#dcfce7;color:#166534;padding:6px 10px;border-radius:6px;margin-bottom:10px;font-weight:600">\u2705 ' + __('coins.ad_free_remaining','Ad-free remaining ') + '' + days + '' + __('coins.days',' days') + '</div>';
      }
      var streakHtml = '';
      if (bal.streaks && bal.streaks.login_streak > 0) {
        streakHtml = '<div style="margin-bottom:8px;color:#6b7280">\uD83D\uDD25 ' + __('coins.streak_days','Streak ') + '<b>' + bal.streaks.login_streak + '</b>' + __('coins.days',' days') + '</div>';
      }
      popup.innerHTML =
        adFreeHtml +
        '<div style="font-size:18px;font-weight:700;color:#1f2937;margin-bottom:8px">\uD83E\uDE99 ' + bal.coins.toLocaleString() + '</div>' +
        streakHtml +
        '<div style="color:#6b7280;font-size:12px;margin-bottom:10px">' + __('coins.today_gained','Earned today: ') + '<b>+' + ((bal.daily_budget && bal.daily_budget.used) || bal.today_earned || 0) + '</b></div>' +
        checkinBtnHtml(bal) + '<a href="/membership/" style="display:block;background:#4f46e5;color:#fff;text-align:center;padding:8px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">\uD83D\uDCB0 赚更多积分</a>';
    }

    var btn = qs('#coins-bar-btn');
    var parent = btn && btn.parentElement;
    if (parent) {
      parent.style.position = 'relative';
      parent.appendChild(popup);
      bindCheckin(popup);
      setTimeout(function(){
        document.addEventListener('click', closeOnClickOutside);
      }, 0);
    }
  }

  function closeOnClickOutside(e) {
    var popup = qs('#coins-popup');
    var btn = qs('#coins-bar-btn');
    if (popup && !popup.contains(e.target) && (!btn || !btn.contains(e.target))) {
      closeAllPopups();
    }
  }

  function closeAllPopups() {
    var p = qs('#coins-popup');
    if (p) p.remove();
    document.removeEventListener('click', closeOnClickOutside);
  }

  function mount() {
    var existing = qs('#coins-bar-btn');
    if (!existing) return;

    existing.addEventListener('click', function(e){
      e.stopPropagation();
      var popup = qs('#coins-popup');
      if (popup) {
        closeAllPopups();
      } else {
        getBalance(function(bal){
          render(bal);
          showTooltip(bal);
        });
      }
    });

    getBalance(function(bal){ render(bal); });
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount);
    } else {
      mount();
    }
  }

  function refresh() {
    cache = null;
    cacheTime = 0;
    getBalance(function(bal){ render(bal); });
  }

  function getBalanceSync() { return cache; }

  if (typeof window !== 'undefined') {
    window.CoinsBar = { init: init, refresh: refresh, getBalance: getBalance, getBalanceSync: getBalanceSync };
  }
  init();
})();
