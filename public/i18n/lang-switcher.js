/* ═══════════════════════════════════════════════════════════════
   lang-switcher.js - 注入 + 行为
   用法：
     <div id="lang-switcher"></div>          ← 放在 <body> 顶部
     <script src="/i18n/lang-switcher.js?v=3"></script>  ← 引入
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LABELS = { zh: '中文', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', ja: '日本語' };
  var FLAGS  = { zh: '🇨🇳', en: '🇺🇸', es: '🇪🇸', fr: '🇫🇷', de: '🇩🇪', ja: '🇯🇵' };

  // 1. 注入 HTML + CSS
  function injectHTML() {
    var host = document.getElementById('lang-switcher');
    if (!host) return;

    host.innerHTML = ''
      + '<button class="lang-current" id="lang-current-btn" aria-label="Switch language">'
      +   '<span class="lang-icon">🌐</span>'
      +   '<span class="lang-label" id="lang-current-label">中文</span>'
      +   '<span class="lang-arrow">▾</span>'
      + '</button>'
      + '<ul class="lang-dropdown" id="lang-dropdown">'
      +   '<li><a href="#" data-lang="zh">🇨🇳 中文</a></li>'
      +   '<li><a href="#" data-lang="en">🇺🇸 English</a></li>'
      +   '<li><a href="#" data-lang="es">🇪🇸 Español</a></li>'
      +   '<li><a href="#" data-lang="fr">🇫🇷 Français</a></li>'
      +   '<li><a href="#" data-lang="de">🇩🇪 Deutsch</a></li>'
      +   '<li><a href="#" data-lang="ja">🇯🇵 日本語</a></li>'
      + '</ul>';

    // 注入样式（仅一次）
    if (!document.getElementById('lang-switcher-style')) {
      var style = document.createElement('style');
      style.id = 'lang-switcher-style';
      style.textContent = ''
        + '.lang-switcher{position:fixed;top:.75rem;right:.75rem;z-index:10000;'
        + '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}'
        + '.lang-switcher .lang-current{'
        + '  background:rgba(255,255,255,.95);border:1px solid var(--border,#e5e7eb);'
        + '  border-radius:8px;padding:.4rem .75rem;cursor:pointer;'
        + '  display:flex;align-items:center;gap:.35rem;font-size:.85rem;'
        + '  color:var(--text,#111827);box-shadow:0 2px 6px rgba(0,0,0,.08);'
        + '  transition:all .15s}'
        + '.lang-switcher .lang-current:hover{background:#fff;box-shadow:0 4px 10px rgba(0,0,0,.12)}'
        + '.lang-switcher .lang-dropdown{position:absolute;top:calc(100% + 4px);right:0;'
        + '  background:#fff;border:1px solid var(--border,#e5e7eb);border-radius:8px;'
        + '  box-shadow:0 4px 12px rgba(0,0,0,.1);list-style:none;margin:0;padding:.25rem 0;'
        + '  min-width:160px;display:none;overflow:hidden}'
        + '.lang-switcher.open .lang-dropdown{display:block}'
        + '.lang-switcher .lang-dropdown li a{'
        + '  display:block;padding:.5rem .9rem;color:var(--text,#111827);'
        + '  text-decoration:none;font-size:.85rem;transition:background .1s}'
        + '.lang-switcher .lang-dropdown li a:hover{background:var(--bg,#f9fafb)}'
        + '.lang-switcher .lang-dropdown li a.active{background:var(--primary,#1e40af);color:#fff}';
      document.head.appendChild(style);
    }
  }

  function init() {
    injectHTML();

    var sw = document.getElementById('lang-switcher');
    if (!sw) return;
    var btn = document.getElementById('lang-current-btn');
    var label = document.getElementById('lang-current-label');
    var dropdown = document.getElementById('lang-dropdown');

    function updateLabel() {
      var lang = (window.i18n && window.i18n.getLang()) || 'zh';
      label.textContent = LABELS[lang] || lang;
      var links = dropdown.querySelectorAll('a[data-lang]');
      for (var i = 0; i < links.length; i++) {
        if (links[i].getAttribute('data-lang') === lang) {
          links[i].classList.add('active');
        } else {
          links[i].classList.remove('active');
        }
      }
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      sw.classList.toggle('open');
    });
    document.addEventListener('click', function () {
      sw.classList.remove('open');
    });

    var links = dropdown.querySelectorAll('a[data-lang]');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function (e) {
        e.preventDefault();
        var lang = this.getAttribute('data-lang');
        if (window.i18n && window.i18n.setLang) {
          window.i18n.setLang(lang).then(function () {
            updateLabel();
            sw.classList.remove('open');
            window.dispatchEvent(new CustomEvent('language-changed', { detail: { lang: lang } }));
          });
        }
      });
    }

    window.addEventListener('i18n:ready', updateLabel);
    window.addEventListener('i18n:change', updateLabel);
    updateLabel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();