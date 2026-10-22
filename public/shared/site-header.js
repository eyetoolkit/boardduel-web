/* ============================================================
   DUEL-DS v2 · 全局吸顶头部 (全站共享)
   ---------------------------------------------------------------
   用法 (页面 body 顶部):
     <div id="site-header"
          data-brand-a="Memory" data-brand-b="Duel"
          data-mark="duel-brain"
          data-nav='[{"label":"Play","href":"#lobby","i18n":"nav.play"},
                     {"label":"Train","href":"/train.html","i18n":"nav.train"}]'
          data-cta-label="Start Duel" data-cta-href="#lobby"
          data-cta-i18n="home.btn_start_duel"></div>
   脚本会注入吸顶玻璃头部; 自动把已有 #lang-switcher 移入头部;
   自带主题切换(复用 localStorage 'bd-theme', 并移除旧的固定按钮)。
   链接全部来自页面属性, 不硬编码路径, 不触发构建校验坏链门禁。

   2026-10-22 shared 收敛阶段3：Games 下拉的导航数据外置到
   site-header.nav.js（每站一份，天然按站不同），本文件只留逻辑，
   三站逐字节一致（漂移契约 STRICT）。加载失败时降级为空菜单并
   console.warn，不阻塞页面。
   ============================================================ */
(function () {
  "use strict";
  /* 先确保本站导航数据就绪（动态加载 site-header.nav.js），再跑主逻辑。
     nav 文件设置 window.__SH_NAV__ = { games: [...] }。 */
  function ensureNav(cb) {
    if (window.__SH_NAV__) { cb(); return; }
    var s = document.createElement("script");
    s.src = "/shared/site-header.nav.js";
    s.onload = function () {
      if (!window.__SH_NAV__) { console.warn("[site-header] nav.js loaded but __SH_NAV__ missing"); window.__SH_NAV__ = { games: [] }; }
      cb();
    };
    s.onerror = function () { console.warn("[site-header] nav.js load failed, Games menu empty"); window.__SH_NAV__ = { games: [] }; cb(); };
    document.head.appendChild(s);
  }
  function ready(fn) {
    if (document.readyState !== "loading") {
      fn();
    } else {
      var run = function () {
        document.removeEventListener("DOMContentLoaded", run);
        window.removeEventListener("load", run);
        clearTimeout(t);
        fn();
      };
      document.addEventListener("DOMContentLoaded", run);
      window.addEventListener("load", run);
      var t = setTimeout(run, 100);
    }
  }
  ensureNav(function () {
  ready(function () {
    var mount = document.getElementById("site-header");
    if (!mount || mount.dataset.built) return;
    mount.dataset.built = "1";

    var ICON_BASE = "/shared/icons.svg#";
    function icon(id, cls) {
      return '<svg class="duel-icon' + (cls ? " " + cls : "") + '" aria-hidden="true"><use href="' + ICON_BASE + id + '"></use></svg>';
    }
    function t(key, fallback) {
      try {
        var r = null;
        if (key && window.__t) r = window.__t(key);
        else if (key && window.i18n && typeof window.i18n.t === "function") r = window.i18n.t(key);
        if (r && r !== key) return r;
      } catch (e) {}
      return fallback;
    }

    var a = mount.dataset.brandA || "Duel", b = mount.dataset.brandB || "";
    var mark = mount.dataset.mark || "duel-brain";
    var nav = [];
    try { nav = JSON.parse(mount.dataset.nav || "[]"); } catch (e) { nav = []; }

    var SITE_ID = (document.documentElement.dataset.site || "board");
    /* 导航数据来自 site-header.nav.js（每站一份站点定制文件） */
    var games = (window.__SH_NAV__ && window.__SH_NAV__.games) || [];
    var SISTER_SITES = [
      { id: "board", name: "Board Duel", href: "https://boardduel.com/" },
      { id: "math", name: "Numeri Duel", href: "https://numeriduel.com/" },
      { id: "memory", name: "Memory Duel", href: "https://memoryduel.com/" }
    ];

    var LANG_NATIVE = { en: "English" }; // TEMP: multilingual disabled
    var LANG_SHORT  = { en: "EN" };
    var LANG_ORDER  = ["en"];
    function curLang() {
      try { if (window.i18n && window.i18n.getLang) { var l = window.i18n.getLang(); if (l && LANG_NATIVE[l]) return l; } } catch (e) {}
      var hl = (document.documentElement.lang || "zh").split("-")[0];
      return LANG_NATIVE[hl] ? hl : "en"; // TEMP: default to English
    }
    function applyLang(lang) {
      try { localStorage.setItem("lang", lang); localStorage.setItem(SITE_ID + "duel_lang", lang); } catch (e) {}
      document.documentElement.lang = lang;
      if (typeof window.setLang === "function") window.setLang(lang);
      else if (window.i18n && typeof window.i18n.setLang === "function") window.i18n.setLang(lang);
      try { window.dispatchEvent(new CustomEvent("langchange", { detail: { lang: lang } })); } catch (e) {}
    }

    function closeMenusExcept(keep) {
      header.querySelectorAll(".sh-menu-wrap.open").forEach(function (w) {
        if (w === keep) return;
        w.classList.remove("open");
        var b = w.querySelector("button"); if (b) b.setAttribute("aria-expanded", "false");
      });
    }
    document.addEventListener("click", function (e) { if (!e.target.closest(".sh-menu-wrap")) closeMenusExcept(null); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenusExcept(null); });
    function bindMenu(btnEl, wrapEl) {
      btnEl.addEventListener("click", function (e) {
        e.stopPropagation();
        var open = wrapEl.classList.toggle("open");
        btnEl.setAttribute("aria-expanded", open ? "true" : "false");
        closeMenusExcept(wrapEl);
      });
    }

    function buildGamesMenu(navEl) {
      var list = games;
      if (!list.length) return;
      var w = document.createElement("div");
      w.className = "sh-menu-wrap sh-games";
      w.innerHTML = '<button type="button" class="sh-navbtn" aria-haspopup="true" aria-expanded="false">' +
        '<span data-sh-i18n="nav.games" data-sh-fallback="Games">' + t("nav.games", "Games") + '</span><span class="sh-caret">▾</span></button>' +
        '<div class="sh-menu" role="menu"></div>';
      var menu = w.querySelector(".sh-menu");
      list.forEach(function (g) {
        var aEl = document.createElement("a");
        aEl.className = "sh-menu-item"; aEl.href = g.href;
        aEl.textContent = t(g.key, g.label);
        aEl.dataset.shI18n = g.key; aEl.dataset.shFallback = g.label;
        menu.appendChild(aEl);
      });
      bindMenu(w.querySelector("button"), w);
      navEl.insertBefore(w, navEl.firstChild);
    }

    function buildLangMenu(actions) {
      var cur = curLang();
      var w = document.createElement("div");
      w.className = "sh-menu-wrap sh-lang";
      w.innerHTML = '<button type="button" class="sh-navbtn" aria-haspopup="true" aria-expanded="false">' +
        '<span data-sh-i18n="language" data-sh-fallback="Language">Language</span><span class="sh-caret">▾</span></button>' +
        '<div class="sh-menu" role="menu"></div>';
      var menu = w.querySelector(".sh-menu");
      LANG_ORDER.forEach(function (l) {
        var aEl = document.createElement("a");
        aEl.className = "sh-menu-item" + (l === cur ? " active" : "");
        aEl.href = "javascript:void(0)";
        aEl.textContent = LANG_NATIVE[l];
        aEl.dataset.lang = l;
        aEl.addEventListener("click", function () {
          applyLang(l);
          menu.querySelectorAll(".sh-menu-item").forEach(function (mi) { mi.classList.remove("active"); });
          aEl.classList.add("active");
          w.classList.remove("open");
          w.querySelector("button").setAttribute("aria-expanded", "false");
        });
        menu.appendChild(aEl);
      });
      bindMenu(w.querySelector("button"), w);
      actions.appendChild(w);
    }

    function buildSiteMenu() {
      var brand = header.querySelector(".sh-brand");
      if (!brand || !brand.parentNode) return;
      var w = document.createElement("div");
      w.className = "sh-menu-wrap sh-sites";
      w.innerHTML = '<button type="button" class="sh-sites-btn" aria-haspopup="true" aria-expanded="false" aria-label="More games"><span class="sh-caret">▾</span></button>' +
        '<div class="sh-menu" role="menu"></div>';
      var menu = w.querySelector(".sh-menu");
      SISTER_SITES.forEach(function (s) {
        var aEl = document.createElement("a");
        aEl.className = "sh-menu-item" + (s.id === SITE_ID ? " active" : "");
        aEl.href = s.href; aEl.textContent = s.name;
        if (s.id === SITE_ID) aEl.setAttribute("aria-current", "true");
        menu.appendChild(aEl);
      });
      bindMenu(w.querySelector("button"), w);
      brand.parentNode.insertBefore(w, brand.nextSibling);
    }

    var header = document.createElement("header");
    header.id = "site-header";
    document.body.classList.add("ds2-header");
    header.innerHTML =
      '<div class="sh-in">' +
        '<a class="sh-brand" href="/" aria-label="' + (a + b) + '">' +
          '<span class="mark">' + icon(mark) + '</span>' +
          '<span>' + a + (b ? '<b>' + b + '</b>' : '') + '</span>' +
        '</a>' +
        '<nav class="sh-nav" aria-label="primary"></nav>' +
        '<span class="sh-spacer"></span>' +
        '<div class="sh-actions"></div>' +
        '<span class="sh-me" data-identity="compact"></span>' +
      '</div>';

    var navEl = header.querySelector(".sh-nav");
    nav.forEach(function (item) {
      var link = document.createElement("a");
      link.href = item.href || "#";
      link.textContent = item.i18n ? t(item.i18n, item.label) : item.label;
      if (item.i18n) { link.dataset.shI18n = item.i18n; link.dataset.shFallback = item.label; }
      navEl.appendChild(link);
    });
    buildGamesMenu(navEl);

    var actions = header.querySelector(".sh-actions");
    var ls = document.getElementById("lang-switcher");
    if (ls && ls.parentNode) ls.parentNode.removeChild(ls);

    buildLangMenu(actions);
    buildSiteMenu();

    mount.parentNode.replaceChild(header, mount);

    var old = document.getElementById("bd-theme-toggle");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var onScroll = function () {
      header.classList.toggle("scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    function retranslate() {
      header.querySelectorAll("[data-sh-i18n]").forEach(function (el) {
        el.textContent = t(el.dataset.shI18n, el.dataset.shFallback || el.textContent);
      });
    }
    if (document.documentElement.getAttribute("data-i18n-ready") === "true") {
      retranslate();
    } else {
      window.addEventListener("i18n:ready", retranslate);
    }
    window.addEventListener("i18n:change", retranslate);

    /* 玩家身份：一次取名，之后每页都认识你。
       header 是异步拼出来的，可能晚于 identity.js 的自动扫描，所以这里显式挂载一次。 */
    var meEl = header.querySelector(".sh-me");
    if (meEl) {
      meEl.dataset.idtDone = "1";
      var bootIdt = function () {
        if (window.Identity) window.Identity.mount(meEl, { compact: true });
      };
      if (window.Identity) bootIdt();
      else {
        var idtScript = document.createElement("script");
        idtScript.src = "/shared/identity.js?v=3";
        idtScript.onload = bootIdt;
        document.head.appendChild(idtScript);
      }
    }
  });
  });
})();
