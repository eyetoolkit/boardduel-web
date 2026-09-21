/* ============================================================
   Tri-Sites Sidebar Injector v2.2
   — 内建语言下拉（不再依赖旧 nav DOM）
   ============================================================ */
(function(){
  'use strict';

  // ---------- i18n helper ----------
  function t(key, fallback) {
    if (typeof window !== 'undefined' && window.t) {
      try {
        var v = window.t(key);
        if (v && v !== key) return v;
      } catch (e) {}
    }
    return fallback || key;
  }

  // ---------- 站点配置 ----------
  var SITE_CONFIG = {
    board: {
      name: 'Board Duel', nameKey: 'site.name', emoji: '⚔️', host: 'boardduel.com',
      games: [
        { icon: '✕◯',  name: 'Tic-Tac-Toe',  key: 'nav.ttt',   href: '/games/tictactoe/' },
        { icon: '⚫',  name: 'Gomoku',       key: 'nav.gomoku', href: '/games/gomoku/' },
        { icon: '🔴',  name: 'Connect 4',    key: 'nav.connect4', href: '/games/connect4/' },
        { icon: '♞',   name: 'Chess',        key: 'nav.chess',  href: '/games/chess/' },
        { icon: '◍',   name: 'Reversi',      key: 'nav.reversi', href: '/games/reversi/' }
      ]
    },
    math: {
      name: 'Math Duel', nameKey: 'site.name', emoji: '🔢', host: 'mathduel.games',
      games: [
        { icon: '24',  name: '24 Game',        key: 'nav.24game',   href: '/games/24-game/' },
        { icon: '24⁺', name: '24 Easy',        key: 'nav.24easy',   href: '/games/24-game-easy/' },
        { icon: '9²',  name: 'Sudoku',         key: 'nav.sudoku',   href: '/games/sudoku/' },
        { icon: '6²',  name: '6×6 Sudoku',     key: 'nav.sudoku6',  href: '/games/sudoku-6x6/' },
        { icon: '☠️',  name: 'Killer Sudoku',  key: 'nav.killer',   href: '/games/killer-sudoku/' },
        { icon: '🔺',  name: 'Pyramid',        key: 'nav.pyramid',  href: '/games/equation-pyramid/' }
      ]
    },
    memory: {
      name: 'Memory Duel', nameKey: 'site.name', emoji: '🧠', host: 'memoryduel.com',
      games: [
        { icon: '⚔️',  name: 'Battle Lobby', key: 'nav.lobby',   href: '#lobby' },
        { icon: '📝',  name: 'Solo Train',   key: 'nav.train',   href: '/train.html' }
      ]
    }
  };

  var BRAND_MATRIX = [
    { key: 'board',  emoji: '⚔️', name: 'Board Duel',  nameKey: 'site.name', descKey: 'brand.board_desc' },
    { key: 'math',   emoji: '🔢', name: 'Math Duel',   nameKey: 'site.name', descKey: 'brand.math_desc' },
    { key: 'memory', emoji: '🧠', name: 'Memory Duel', nameKey: 'site.name', descKey: 'brand.memory_desc' }
  ];

  var currentSite = document.documentElement.dataset.site || 'board';
  var cfg = SITE_CONFIG[currentSite] || SITE_CONFIG.board;

  // ---------- 统一获取/设置三站语言（兼容各站独立 localStorage key） ----------
  // 三站各自独立 key：boardduel_lang / mathduel_lang / memoryduel_lang
  // 外加一个通用 key "lang" 做跨站同步
  var SITE_LANG_KEY = currentSite + 'duel_lang'; // board->boardduel_lang, math->mathduel_lang, memory->memoryduel_lang

  function getSiteLang(){
    // 1) 优先用各站 i18n 自身的 API（最准）
    if (window.i18n && typeof window.i18n.getLang === 'function') {
      try { var l = window.i18n.getLang(); if (l) return l; } catch(e){}
    }
    // 2) 当前站点自己的 key
    try { var v = localStorage.getItem(SITE_LANG_KEY); if (v && v.length >= 2 && v.length <= 5) return v; } catch(e){}
    // 3) 通用 key（跨站同步用）
    try { v = localStorage.getItem('lang'); if (v && v.length >= 2 && v.length <= 5) return v; } catch(e){}
    // 4) 最后兜底：html lang 属性
    var hl = document.documentElement.lang || 'zh';
    return hl.split('-')[0]; // "ja-JP" → "ja"
  }
  function setSiteLang(lang){
    // 写自己站的 key + 通用 key（方便跨站同步）
    try {
      localStorage.setItem(SITE_LANG_KEY, lang);
      localStorage.setItem('lang', lang);
    } catch(e){}
    document.documentElement.lang = lang;
  }

  // ---------- 侧栏导航多语言字典（self-contained，不依赖各站 i18n.json） ----------
  var NAV_I18N = {
    zh: { home: '首页', about: '关于', games: '🎮 游戏', langLabel: '简体中文' },
    en: { home: 'Home',  about: 'About', games: '🎮 Games', langLabel: 'English' },
    ja: { home: 'ホーム', about: '概要', games: '🎮 ゲーム', langLabel: '日本語' },
    es: { home: 'Inicio', about: 'Acerca de', games: '🎮 Juegos', langLabel: 'Español' },
    fr: { home: 'Accueil', about: 'À propos', games: '🎮 Jeux', langLabel: 'Français' },
    de: { home: 'Startseite', about: 'Über', games: '🎮 Spiele', langLabel: 'Deutsch' }
  };
  function applySidebarLang(lang){
    if (!NAV_I18N[lang]) lang = 'zh';
    var d = NAV_I18N[lang];
    // R-2: sb-name 语言感知（整段重设，避免 "Board Duel Duel" 重复）
    try {
      var _c = (typeof cfg !== 'undefined' && cfg) ? cfg : (SITE_CONFIG[currentSite] || SITE_CONFIG.board);
      var _sbn = document.querySelector('.sb-name');
      if (_sbn) _sbn.textContent = (lang === 'zh') ? (_c.nameZh + ' Duel') : _c.name;
    } catch (e) {}
    var el;
    // 首页
    el = document.querySelector('[data-sb-nav="home"]');
    if (el) el.textContent = d.home;
    // About
    el = document.querySelector('[data-sb-nav="about"]');
    if (el) el.textContent = d.about;
    // Games group title
    el = document.querySelector('[data-sb-nav="games-group"]');
    if (el) el.textContent = d.games;
    // 游戏项标签（通过 data-i18n 更新）
    var i18nEls = document.querySelectorAll('[data-i18n]');
    i18nEls.forEach(function(el2) {
      var key = el2.dataset.i18n;
      var trans = t(key);
      if (trans && trans !== key) el2.textContent = trans;
    });
    // 语言按钮 label（三语言完整）
    var label = document.getElementById('sbLangLabel');
    if (label) label.textContent = d.langLabel;
  }

  // ---------- 生成侧栏 HTML ----------
  function buildSidebarHTML(){
    var currentPath = location.pathname;
    var activeGame = null;
    for (var i=0; i<cfg.games.length; i++){
      var g = cfg.games[i];
      var clean = g.href.replace(/\/$/, '');
      if (currentPath.indexOf(g.href) === 0 || currentPath.replace(/\/$/, '') === clean) {
        activeGame = g.href; break;
      }
    }

    var gamesHTML = cfg.games.map(function(g, idx){
      var active = (g.href === activeGame) ? ' active' : '';
      return '<a class="sb-link'+active+'" href="'+g.href+'">'+
        '<span class="sb-icon">'+g.icon+'</span>'+
        '<span data-i18n="'+g.key+'">'+g.name+'</span>'+
      '</a>';
    }).join('');

    var switcherHTML = BRAND_MATRIX.map(function(s){
      var isCurrent = (s.key === currentSite);
      var cls = isCurrent ? ' current' : '';
      var target = isCurrent ? '#' : ('https://' + SITE_CONFIG[s.key].host + '/');
      return '<button class="sb-site-item'+cls+'" onclick="location.href=\''+target+'\'">' +
        '<span class="sb-site-icon">'+s.emoji+'</span>' +
        '<div class="sb-site-meta">' +
          '<span class="sb-site-name">'+s.emoji+' '+s.name+'</span>' +
          '<span class="sb-site-desc" data-i18n="'+s.descKey+'">'+t(s.descKey)+'</span>' +
        '</div>' +
      '</button>';
    }).join('');

    var siteNameZh = cfg.nameKey ? t(cfg.nameKey, cfg.name) : cfg.name;

    return '' +
      '<aside class="sb" id="triSidebar">' +
        '<div class="sb-brand">' +
          '<button class="sb-brand-btn" id="sbBrandBtn" type="button" aria-haspopup="true" aria-expanded="false">' +
            '<span class="sb-logo">'+cfg.emoji+'</span>' +
            '<span class="sb-name" data-sb-name></span>' +
            '<svg class="sb-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</button>' +
          '<div class="sb-brand-switcher" id="sbSwitcher" role="menu">'+switcherHTML+'</div>' +
        '</div>' +
        '<nav class="sb-body" aria-label="Main navigation">' +
          '<div class="sb-group">' +
            '<a class="sb-link'+(currentPath==='/' ? ' active' : '')+'" href="/"><span class="sb-icon">🏠</span><span data-sb-nav="home" data-i18n="sidebar.home">首页</span></a>' +
          '</div>' +
          '<div class="sb-group">' +
            '<div class="sb-group-title" data-sb-nav="games-group" data-i18n="sidebar.group_games">🎮 游戏</div>' +
            gamesHTML +
          '</div>' +
          '<div class="sb-group">' +
            '<a class="sb-link" href="/about/"><span class="sb-icon">ℹ️</span><span data-sb-nav="about" data-i18n="sidebar.about">关于</span></a>' +
          '</div>' +
        '</nav>' +
        '<div class="sb-footer">' +
          '<div class="sb-lang" id="sbLang">' +
            '<button class="sb-lang-btn" id="sbLangBtn" type="button" aria-haspopup="listbox" aria-expanded="false">' +
              '<span class="sb-icon">🌐</span>' +
              '<span id="sbLangLabel">Language</span>' +
              '<svg class="sb-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</button>' +
            '<div class="sb-lang-menu" id="sbLangMenu" role="listbox">' +
              '<button class="sb-lang-item" data-lang="zh" role="option"><span>'+NAV_I18N.zh.langLabel+'</span></button>' +
              '<button class="sb-lang-item" data-lang="en" role="option"><span>'+NAV_I18N.en.langLabel+'</span></button>' +
              '<button class="sb-lang-item" data-lang="ja" role="option"><span>'+NAV_I18N.ja.langLabel+'</span></button>' +
              '<button class="sb-lang-item" data-lang="es" role="option"><span>'+NAV_I18N.es.langLabel+'</span></button>' +
              '<button class="sb-lang-item" data-lang="fr" role="option"><span>'+NAV_I18N.fr.langLabel+'</span></button>' +
              '<button class="sb-lang-item" data-lang="de" role="option"><span>'+NAV_I18N.de.langLabel+'</span></button>' +'</div>' +
          '</div>' +
        '</div>' +
      '</aside>' +
      '<div class="sb-mask" id="sbMask" aria-hidden="true"></div>' +
      '<div class="sb-edge-handle" id="sbEdgeHandle" aria-hidden="true"></div>' +
      '<button class="sb-toggle" id="sbToggle" type="button" aria-label="Menu" aria-expanded="false">' +
        '<span class="sb-toggle-bars"><span></span><span></span><span></span></span>' +
      '</button>';
  }

  // ---------- 注入 DOM ----------
  function injectSidebar(){
    ['triSidebar','sbToggle','sbMask','sbEdgeHandle'].forEach(function(id){
      var el = document.getElementById(id); if (el) el.remove();
    });
    // 如果有旧的 sb-main 包装，先"拆包"（把 children 还原到 body）
    var oldMain = document.querySelector('.sb-main');
    if (oldMain) {
      while (oldMain.firstChild) {
        oldMain.parentNode.insertBefore(oldMain.firstChild, oldMain);
      }
      oldMain.remove();
    }

    document.body.insertAdjacentHTML('afterbegin', buildSidebarHTML());
    wrapMainContent();
    bindSidebarEvents();
    bindSidebarLang();
    // 立即应用侧栏语言（用 localStorage 里的值）
    applySidebarLang(getSiteLang());
    // R-2: 侧栏常在 i18n 就绪前渲染（getSiteLang 回退 zh），故就绪后按真实语言重刷
    window.addEventListener('i18n:ready', function () {
      var _l = (window.i18n && typeof window.i18n.getLang === 'function')
        ? window.i18n.getLang() : getSiteLang();
      applySidebarLang(_l);
    });
  }

  function wrapMainContent(){
    // 优先选语义化容器：main → 各种常见 layout 容器
    var content = document.querySelector('main') ||
                  document.querySelector('.layout-main') ||
                  
                  
                  
                  document.querySelector('.page-wrap, .main-wrap, .shell') ||
                  document.querySelector('.page, .app') ||
                  document.querySelector('.games-grid, .home-grid, .card-grid');
    // Fallback: 找 body 中第一个非 sidebar、非内容性的真实元素
    if (!content) {
      var skip = { SCRIPT:1, LINK:1, META:1, ASIDE:1, NOSCRIPT:1, STYLE:1 };
      var bodyTags = { BODY:1, HEAD:1, HTML:1 };
      var ch = document.body.children;
      // 从后往前找，跳过 sidebar 自身的元素和内容性标签
      for (var i = ch.length - 1; i >= 0; i--) {
        var el = ch[i];
        if (skip[el.tagName]) continue;
        if (el.id === 'triSidebar' || el.id === 'sbMask' || el.id === 'sbEdgeHandle' || el.id === 'sbToggle') continue;
        if (el.classList && (el.classList.contains('sb-main') || el.classList.contains('toast-stack'))) continue;
        // 找到第一个真正的内容元素
        content = el;
        break;
      }
    }
    if (!content) return;
    if (content.parentElement && content.parentElement.classList.contains('sb-main')) return;
    if (content.id === 'triSidebar') return;
    if (content.tagName === 'SCRIPT') return; // 安全网

    var wrapper = document.createElement('div');
    wrapper.className = 'sb-main';
    content.parentElement.insertBefore(wrapper, content);
    wrapper.appendChild(content);
  }

  // ---------- 打开/关闭侧栏 ----------
  function openSidebar(){
    var sb = document.getElementById('triSidebar');
    var toggle = document.getElementById('sbToggle');
    if (!sb) return;
    sb.classList.add('open');
    if (toggle) { toggle.classList.add('open'); toggle.setAttribute('aria-expanded', 'true'); }
    document.body.classList.add('sb-open');
  }

  function closeSidebar(){
    var sb = document.getElementById('triSidebar');
    var toggle = document.getElementById('sbToggle');
    if (!sb) return;
    sb.classList.remove('open');
    if (toggle) { toggle.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
    document.body.classList.remove('sb-open');
  }

  function toggleSidebar(){
    var sb = document.getElementById('triSidebar');
    if (!sb) return;
    if (sb.classList.contains('open')) closeSidebar(); else openSidebar();
  }

  // ---------- 交互绑定（非语言部分）----------
  function bindSidebarEvents(){
    var brandBtn = document.getElementById('sbBrandBtn');
    var switcher = document.getElementById('sbSwitcher');

    if (brandBtn && switcher) {
      brandBtn.addEventListener('click', function(e){
        e.stopPropagation();
        var isOpen = switcher.classList.toggle('show');
        brandBtn.classList.toggle('open', isOpen);
        brandBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    }
    document.addEventListener('click', function(e){
      if (switcher && switcher.classList.contains('show')) {
        if (!switcher.contains(e.target) && e.target !== brandBtn && !brandBtn.contains(e.target)) {
          switcher.classList.remove('show');
          if (brandBtn) { brandBtn.classList.remove('open'); brandBtn.setAttribute('aria-expanded', 'false'); }
        }
      }
    });

    var toggle = document.getElementById('sbToggle');
    var sb = document.getElementById('triSidebar');
    if (toggle && sb) {
      toggle.addEventListener('click', function(e){
        e.stopPropagation();
        toggleSidebar();
      });
      sb.querySelectorAll('a').forEach(function(a){
        a.addEventListener('click', function(){
          if (window.innerWidth <= 760) closeSidebar();
        });
      });
    }

    // 遮罩层点击关闭
    var mask = document.getElementById('sbMask');
    if (mask) {
      mask.addEventListener('click', closeSidebar);
    }

    // ESC 键关闭
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' || e.keyCode === 27) {
        var sb = document.getElementById('triSidebar');
        if (sb && sb.classList.contains('open')) closeSidebar();
        if (switcher) { switcher.classList.remove('show'); if (brandBtn) brandBtn.classList.remove('open'); }
        // 关闭语言菜单
        var lm = document.getElementById('sbLangMenu');
        var lb = document.getElementById('sbLangBtn');
        if (lm) lm.classList.remove('open');
        if (lb) { lb.classList.remove('open'); lb.setAttribute('aria-expanded', 'false'); }
      }
    });

    // 窗口 resize
    window.addEventListener('resize', function(){
      if (window.innerWidth > 760) {
        closeSidebar();
      }
    });

    // 隐藏各站旧 nav 残留
    var site = document.documentElement.dataset.site;

    // MathDuel 旧元素
    hideById('lang-switcher');           // 旧语言切换容器
    hideById('hamburger');               // 旧汉堡按钮
    hideByClass('mobile-topbar');        // 旧移动端顶部栏
    hideByClass('drawer-backdrop');      // 旧抽屉遮罩
    if (site === 'math') {
      // MathDuel 旧侧栏/底部导航/抽屉（全部隐藏）
      document.querySelectorAll('.sidebar, [class*="sidebar"], [class*="drawer"], .bottom-nav').forEach(function(el){
        if (el.id !== 'triSidebar') el.style.display = 'none';
      });
    }

    // BoardDuel 旧元素
    hideByClass('nav-wrap');
    hideByClass('g-nav');

    function hideById(id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; }
    function hideByClass(cls) { document.querySelectorAll('.' + cls).forEach(function(el){ el.style.display = 'none'; }); }
  }

  // ---------- 侧栏内建语言下拉 ----------
  function bindSidebarLang(){
    document.body.insertAdjacentHTML('beforeend','<div id=sbBindDebug style=display:none>bindSidebarLang CALLED</div>');
    var sbLangBtn = document.getElementById('sbLangBtn');
    var sbLangMenu = document.getElementById('sbLangMenu');
    var sbLangLabel = document.getElementById('sbLangLabel');
    if (!sbLangBtn || !sbLangMenu) return;

    var LANG_LABELS = { zh: '简体中文', en: 'English', ja: '日本語' };

    function syncBtn(){
      var cur = getSiteLang();
      if (sbLangLabel) sbLangLabel.textContent = LANG_LABELS[cur] || cur;
      var items = sbLangMenu.querySelectorAll('.sb-lang-item');
      items.forEach(function(it){
        it.classList.toggle('active', it.dataset.lang === cur);
      });
    }
    syncBtn();

    // 点击按钮切换菜单
    sbLangBtn.addEventListener('click', function(e){
      e.stopPropagation();
      var isOpen = sbLangMenu.classList.toggle('open');
      sbLangBtn.classList.toggle('open', isOpen);
      sbLangBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // 选择语言 — 兼容三站 i18n API（setLang 位置不同）
    sbLangMenu.addEventListener('click', function(e){
      var item = e.target.closest('.sb-lang-item');
      if (!item) return;
      var lang = item.dataset.lang;
      document.body.insertAdjacentHTML('beforeend','<div id=sbDebug style=display:none>clicked:'+lang+':before:'+(localStorage.getItem(SITE_LANG_KEY)||'null')+'</div>');

      // 优先级：先同步写 localStorage（立即可读），再调各站 i18n API 翻译主内容
      setSiteLang(lang);
      
      if (typeof window.setLang === 'function') {
        window.setLang(lang);
      } else if (window.i18n && typeof window.i18n.setLang === 'function') {
        window.i18n.setLang(lang);
      }
      try { window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: lang } })); } catch(err){}

      sbLangMenu.classList.remove('open');
      sbLangBtn.classList.remove('open');
      sbLangBtn.setAttribute('aria-expanded', 'false');
      syncBtn();
      applySidebarLang(lang);
      // 关闭品牌矩阵
      var sw = document.getElementById('sbSwitcher');
      if (sw) sw.classList.remove('show');
    });

    // 点击外部关闭
    document.addEventListener('click', function(e){
      if (!sbLangBtn.contains(e.target) && !sbLangMenu.contains(e.target)) {
        sbLangMenu.classList.remove('open');
        sbLangBtn.classList.remove('open');
        sbLangBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // 监听外部语言变化 — 三站各有自己的事件名
    function onLangChange(e){
      var lang = (e && e.detail && e.detail.lang) || getSiteLang();
      syncBtn();
      applySidebarLang(lang);
    }
    document.addEventListener('langchange', onLangChange);      // BoardDuel/MemoryDuel
    document.addEventListener('i18n:change', onLangChange);      // MathDuel

    // 兜底：如果没有事件，也定期轮询 localStorage（保护 setTimeout）
    var _lastLang = getSiteLang();
    setInterval(function(){
      var cur = getSiteLang();
      if (cur !== _lastLang) { _lastLang = cur; syncBtn(); applySidebarLang(cur); }
    }, 2000);
  }

  // ---------- 边缘滑动手势 ----------
  function setupEdgeSwipe(){
    var handle = document.getElementById('sbEdgeHandle');
    if (!handle) return;
    var startX = 0, startY = 0, tracking = false, THRESHOLD = 60;

    handle.addEventListener('touchstart', function(e){
      var t = e.touches[0];
      startX = t.clientX; startY = t.clientY; tracking = true;
    }, { passive: true });

    handle.addEventListener('touchmove', function(e){
      if (!tracking) return;
      var t = e.touches[0];
      var dx = t.clientX - startX;
      var dy = Math.abs(t.clientY - startY);
      if (dx > THRESHOLD && dx > dy * 1.5) { openSidebar(); tracking = false; }
    }, { passive: true });

    handle.addEventListener('touchend', function(){ tracking = false; });
  }

  // ---------- DOM Ready ----------
  function ready(fn){
    if (document.readyState !== 'loading') { fn(); }
    else { document.addEventListener('DOMContentLoaded', fn); }
  }

  ready(function(){
    injectSidebar();
    setupEdgeSwipe();
  });

  window.SiteSidebar = {
    inject: injectSidebar,
    open: openSidebar,
    close: closeSidebar,
    toggle: toggleSidebar,
    config: cfg,
    site: currentSite
  };
})();
