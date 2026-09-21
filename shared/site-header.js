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
   ============================================================ */
(function () {
  "use strict";
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
    var GAMES = {
      board: [
        { key: "nav.ttt", label: "Tic-Tac-Toe", href: "/games/tictactoe/" },
        { key: "nav.gomoku", label: "Gomoku", href: "/games/gomoku/" },
        { key: "nav.connect4", label: "Connect 4", href: "/games/connect4/" },
        { key: "nav.chess", label: "Chess", href: "/games/chess/" },
        { key: "nav.reversi", label: "Reversi", href: "/games/reversi/" }
      ],
      memory: [
        { key: "nav.play", label: "Lobby", href: "/#lobby" },
        { key: "nav.train", label: "Solo train", href: "/train.html" },
        { key: "nav.how_to_play", label: "How to play", href: "/how-to-play/memory-match/" }
      ]
    };
    var SISTER_SITES = [
      { id: "board", name: "Board Duel", href: "https://boardduel.com/" },
      { id: "math", name: "Math Duel", href: "https://mathduel.games/" },
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
      var list = GAMES[SITE_ID] || GAMES.board;
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
  });
})();
