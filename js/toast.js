/* ============================================================
   Global Toast / Notification JS
   — 三站共享，自动初始化
   Usage: Toast.show('Hello', 'info')
          Toast.success('你赢了！')
          Toast.error('网络错误')
          Toast.show({ title: '新对局', msg: '已加入', type: 'success', duration: 3000 })
   ============================================================ */
(function(){
  'use strict';

  function tt(key, fallback) {
    if (typeof window !== 'undefined' && window.t) {
      try {
        var v = window.t(key);
        if (v && v !== key) return v;
      } catch (e) {}
    }
    return fallback || key;
  }

  var STACK_ID = 'bdToastStack';
  var DEFAULTS = {
    type: 'info',
    duration: 3500,
    closable: true
  };
  var ICONS = {
    info:    'ℹ️',
    success: '✅',
    warning: '⚠️',
    error:   '❌',
    tip:     '💡',
    game:    '🎮',
    timer:   '⏱️'
  };

  function ensureStack() {
    var stack = document.getElementById(STACK_ID);
    if (!stack) {
      stack = document.createElement('div');
      stack.id = STACK_ID;
      stack.className = 'bd-toast-stack';
      document.body.appendChild(stack);
    }
    return stack;
  }

  function buildToast(opts) {
    var cfg = Object.assign({}, DEFAULTS, opts);
    var el = document.createElement('div');
    el.className = 'bd-toast bd-' + cfg.type;

    // Title + msg handling
    var title = '', msg = '';
    if (typeof opts === 'string') {
      msg = opts;
    } else {
      title = opts.title || '';
      msg   = opts.msg || opts.message || '';
    }

    var ico = ICONS[cfg.type] || ICONS.info;
    el.innerHTML =
      '<span class="bd-toast-ico">' + ico + '</span>' +
      '<div class="bd-toast-body">' +
        (title ? '<div class="bd-toast-title">' + escapeHtml(title) + '</div>' : '') +
        (msg   ? '<div class="bd-toast-msg">'   + escapeHtml(msg)   + '</div>' : '') +
      '</div>' +
      (cfg.closable ? '<button class="bd-toast-close" aria-label="Close">✕</button>' : '');

    el.addEventListener('click', function(e){
      if (e.target.classList.contains('bd-toast-close')) {
        dismiss(el);
      } else if (cfg.onClick) {
        cfg.onClick(el);
      }
    });

    return el;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function show(opts) {
    var stack = ensureStack();
    var el = buildToast(opts);
    stack.appendChild(el);

    var cfg = typeof opts === 'string' ? DEFAULTS : Object.assign({}, DEFAULTS, opts);

    if (cfg.duration > 0) {
      setTimeout(function(){ dismiss(el); }, cfg.duration);
    }
    return el;
  }

  function dismiss(el) {
    if (el.dataset.leaving) return;
    el.dataset.leaving = '1';
    el.classList.add('bd-toast-leave');
    setTimeout(function(){
      if (el.parentElement) el.parentElement.removeChild(el);
    }, 300);
  }

  // Convenience methods
  var Toast = {
    show:    show,
    info:    function(m, o){ return show(Object.assign({}, o, { type: 'info',    msg: m })); },
    success: function(m, o){ return show(Object.assign({}, o, { type: 'success', msg: m })); },
    warning: function(m, o){ return show(Object.assign({}, o, { type: 'warning', msg: m })); },
    error:   function(m, o){ return show(Object.assign({}, o, { type: 'error',   msg: m })); },
    tip:     function(m, o){ return show(Object.assign({}, o, { type: 'tip',     msg: m })); },
    game:    function(m, o){ return show(Object.assign({}, o, { type: 'game',    msg: m })); },
    timer:   function(m, o){ return show(Object.assign({}, o, { type: 'timer',   msg: m })); },
    dismiss: dismiss,

    // Batch helpers
    queue: function(messages) {
      messages.forEach(function(m, i){
        setTimeout(function(){ show(m); }, i * 350);
      });
    }
  };

  // Auto-expose
  window.Toast = Toast;

  // Auto-demo on game page load (只在 BoardDuel 游戏页)
  var site = document.documentElement.dataset.site;
  var path = location.pathname;
  if (site === 'board' && path.indexOf('/games/') >= 0) {
    // 等游戏初始化完了弹一个欢迎提示
    setTimeout(function(){
      Toast.tip(tt('toast.game_tip', 'Click the board to start. Good luck!'));
    }, 1500);
  }
})();
