/* ============================================================
   DUEL-DS v2 · analytics-bootstrap.js (Phase 0)
   ---------------------------------------------------------------
   自包含：Cookie 同意横幅 + GA4 注入 + 事件 API。
   读取 window.__GA4_ID__（由各站 inject-analytics 写入 <head>）。
   合规：默认 Google Consent Mode v2 = denied；用户 Accept 后更新 granted。
   安全：__GA4_ID__ 为占位符/非法时禁用追踪（仅 console.warn），可安全上线。
   用法：<head> 内由 inject-analytics.mjs 注入：
     <link rel="stylesheet" href="/shared/consent.css?v=ph0-1">
     <script>window.__GA4_ID__='G-XXX';</script>
     <script src="/shared/analytics.js?v=ph0-1" defer></script>
   事件上报：window.__duelAnalytics.track('event_name', {foo:'bar'})
   ============================================================ */
(function () {
  "use strict";

  var KEY = "duel_consent";
  var ID = (window.__GA4_ID__ || "").trim();
  var ID_OK = /^G-[A-Z0-9]{6,}$/.test(ID) && ID.indexOf("PLACEHOLDER") === -1;

  function lsGet() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function lsSet(v) { try { if (v === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch (e) {} }

  // ---- GA4 + Consent Mode v2 ----
  function loadGtag() {
    if (!ID_OK) { console.warn("[analytics] GA4 ID 未配置（占位符/非法），追踪已禁用"); return; }
    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("consent", "default", {
      ad_storage: "denied",
      analytics_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      wait_for_update: 500
    });
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ID);
    document.head.appendChild(s);
    gtag("config", ID, { send_page_view: true });
  }

  function grant() {
    lsSet("granted");
    loadGtag();
    if (window.gtag) {
      window.gtag("consent", "update", {
        ad_storage: "granted",
        analytics_storage: "granted",
        ad_user_data: "granted",
        ad_personalization: "granted"
      });
    }
    removeBanner();
  }
  function deny() { lsSet("denied"); removeBanner(); }

  // ---- 事件 API ----
  window.__duelAnalytics = {
    track: function (name, params) { if (window.gtag) window.gtag("event", name, params || {}); },
    grant: grant,
    deny: deny,
    revoke: function () { lsSet(null); },
    showBanner: showBanner
  };

  // ---- 横幅 ----
  function bannerHTML() {
    return '' +
      '<div id="duel-consent" class="duel-consent" role="dialog" aria-live="polite" aria-label="Cookie consent">' +
        '<div class="dc-inner">' +
          '<p class="dc-text">We use cookies for anonymous analytics to improve the site. Nothing is tracked without your consent.</p>' +
          '<div class="dc-actions">' +
            '<button type="button" class="dc-reject" data-dc="reject">Reject</button>' +
            '<button type="button" class="dc-accept" data-dc="accept">Accept</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }
  function showBanner() {
    if (document.getElementById("duel-consent")) return;
    var wrap = document.createElement("div");
    wrap.innerHTML = bannerHTML();
    document.body.appendChild(wrap.firstChild);
    var el = document.getElementById("duel-consent");
    el.addEventListener("click", function (e) {
      var b = e.target.getAttribute && e.target.getAttribute("data-dc");
      if (b === "accept") grant();
      else if (b === "reject") deny();
    });
  }
  function removeBanner() {
    var el = document.getElementById("duel-consent");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var c = lsGet();
    if (c === "granted") { grant(); }
    else if (c === "denied") { /* 不追踪 */ }
    else { showBanner(); }
  });
})();
