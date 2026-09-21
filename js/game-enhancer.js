/* ============================================================
   BoardDuel Game Enhancer (P1)
   — 注入玩家卡片 + 实时计时器
   — 检测当前游戏状态，自动高亮活跃玩家
   — 不破坏已有游戏 JS（只读现有 stateVal/turnVal 的 DOM）
   ============================================================ */
(function(){
  'use strict';

  // ---------- 配置（每个游戏的玩家标识） ----------
  var GAME_CONFIG = {
    tictactoe:  { me: '✕', opp: '◯', meEmoji: '🤖', oppEmoji: '💻' },
    gomoku:     { me: '⚫', opp: '⚪', meEmoji: '👤', oppEmoji: '🤖' },
    connect4:   { me: '🔴', opp: '🔵', meEmoji: '👤', oppEmoji: '🤖' },
    othello:    { me: '⚫', opp: '⚪', meEmoji: '👤', oppEmoji: '🤖' },
    chess:      { me: '♟️', opp: '♚', meEmoji: '👤', oppEmoji: '🤖' },
    checkers:   { me: '⚫', opp: '⚪', meEmoji: '👤', oppEmoji: '🤖' }
  };

  var SITE = document.documentElement.dataset.site;
  var GAME = (location.pathname.match(/\/games\/([^\/]+)/) || [])[1] || '';
  var CFG = GAME_CONFIG[GAME] || GAME_CONFIG.tictactoe;

  // ---------- 计时器状态 ----------
  var timers = {
    me:   { total: 120, left: 120, ticking: false, el: null },
    opp:  { total: 120, left: 120, ticking: false, el: null }
  };
  var tickInterval = null;

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function updateTimerUI(who) {
    var t = timers[who];
    if (!t.el) return;
    t.el.textContent = fmt(t.left);
    t.el.classList.remove('warn', 'danger');
    if (t.left <= 5) t.el.classList.add('danger');
    else if (t.left <= 15) t.el.classList.add('warn');
  }

  function startTicking(who) {
    if (timers[who].ticking) return;
    stopTicking();
    timers[who].ticking = true;
    tickInterval = setInterval(function(){
      timers[who].left -= 1;
      updateTimerUI(who);
      if (timers[who].left <= 0) {
        stopTicking();
        // 超时判负 — 只做视觉，不影响游戏逻辑
        var loser = who === 'me' ? 'opp' : 'me';
        timers[who].el.parentElement.style.opacity = '0.3';
      }
    }, 1000);
  }

  function stopTicking() {
    Object.keys(timers).forEach(function(k){ timers[k].ticking = false; });
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  }

  function resetTimers() {
    timers.me.left = timers.me.total;
    timers.opp.left = timers.opp.total;
    updateTimerUI('me');
    updateTimerUI('opp');
    stopTicking();
  }

  // ---------- 注入玩家卡片 ----------
  function injectPlayerCards() {
    if (document.getElementById('bdPlayers')) return; // 已注入

    var container = document.createElement('div');
    container.className = 'bd-players';
    container.id = 'bdPlayers';

    container.innerHTML =
      '<div class="bd-player-card me" id="bdPlayerMe">' +
        '<div class="bd-p-avatar">' + CFG.meEmoji + '</div>' +
        '<div class="bd-p-symbol">' + CFG.me + '</div>' +
        '<div class="bd-p-name">You</div>' +
        '<div class="bd-p-timer" id="bdTimerMe">' + fmt(timers.me.left) + '</div>' +
      '</div>' +
      '<div class="bd-vs">VS</div>' +
      '<div class="bd-player-card opp" id="bdPlayerOpp">' +
        '<div class="bd-p-avatar">' + CFG.oppEmoji + '</div>' +
        '<div class="bd-p-symbol">' + CFG.opp + '</div>' +
        '<div class="bd-p-name">AI</div>' +
        '<div class="bd-p-timer" id="bdTimerOpp">' + fmt(timers.opp.left) + '</div>' +
      '</div>';

    // 记住 timer 元素
    timers.me.el  = container.querySelector('#bdTimerMe');
    timers.opp.el = container.querySelector('#bdTimerOpp');

    // 找到合适的插入点 — 在 .status-bar 前面
    var statusBar = document.querySelector('.status-bar, .sb-wrap');
    var banner    = document.querySelector('.g-banner, .banner, .game-header');
    var boardWrap = document.querySelector('.board-wrap, #board');

    if (statusBar && statusBar.parentElement) {
      statusBar.parentElement.insertBefore(container, statusBar);
    } else if (banner && banner.nextSibling) {
      banner.parentElement.insertBefore(container, banner.nextSibling);
    } else if (boardWrap && boardWrap.parentElement) {
      boardWrap.parentElement.insertBefore(container, boardWrap);
    } else {
      document.body.insertBefore(container, document.body.children[3]);
    }

    updateTimerUI('me');
    updateTimerUI('opp');
  }

  // ---------- 检测当前回合 ----------
  function detectTurn() {
    // 策略 1: 读 stateVal / turnVal 文本
    var stateEl = document.getElementById('stateVal');
    var turnEl  = document.getElementById('turnVal');
    var state = stateEl ? stateEl.textContent.trim() : '';
    var turn  = turnEl  ? turnEl.textContent.trim()  : '';

    // 策略 2: 读自定义 data-active 属性（如果游戏 JS 设了）
    var activeSide = document.querySelector('[data-active="me"]') ||
                     document.querySelector('[data-active="opp"]');
    if (activeSide) {
      var who = activeSide.dataset.active;
      highlightPlayer(who);
      startTicking(who);
      return;
    }

    // 策略 3: 从文本推断
    var meKeywords = ['你', 'You', 'Your', '你方'];
    var oppKeywords = ['电脑', 'AI', 'Opponent', 'Opp', '对方'];

    var turnLower = turn.toLowerCase();
    var active = null;

    for (var i=0; i<meKeywords.length; i++) {
      if (turn.indexOf(meKeywords[i]) >= 0 || state.indexOf(meKeywords[i]) >= 0 ||
          turnLower.indexOf(meKeywords[i].toLowerCase()) >= 0) {
        active = 'me'; break;
      }
    }
    if (!active) {
      for (var j=0; j<oppKeywords.length; j++) {
        if (turn.indexOf(oppKeywords[j]) >= 0 || state.indexOf(oppKeywords[j]) >= 0) {
          active = 'opp'; break;
        }
      }
    }

    if (active) {
      highlightPlayer(active);
      startTicking(active);
    } else {
      // 游戏可能刚开始或已结束 — 重置计时器
      resetTimers();
      highlightPlayer(null);
    }
  }

  function highlightPlayer(who) {
    var meCard  = document.getElementById('bdPlayerMe');
    var oppCard = document.getElementById('bdPlayerOpp');
    if (!meCard || !oppCard) return;

    meCard.classList.toggle('active',  who === 'me');
    oppCard.classList.toggle('active', who === 'opp');
  }

  // ---------- 监听游戏重置 ----------
  function detectNewGame() {
    // 观察 stateVal 变化
    var stateEl = document.getElementById('stateVal');
    if (!stateEl) return;

    var lastText = stateEl.textContent;
    setInterval(function(){
      if (stateEl.textContent !== lastText) {
        var oldStatus = lastText;
        lastText = stateEl.textContent;

        // 如果变成 "对战" 或 playing，新游戏开始
        var s = stateEl.textContent.toLowerCase();
        if (s.indexOf('对战') >= 0 || s.indexOf('playing') >= 0 ||
            s.indexOf('你的') >= 0 || s.indexOf('your') >= 0) {
          resetTimers();
          setTimeout(detectTurn, 500);
        } else if (s.indexOf('胜') >= 0 || s.indexOf('win') >= 0 ||
                   s.indexOf('输') >= 0 || s.indexOf('lose') >= 0 ||
                   s.indexOf('draw') >= 0 || s.indexOf('平') >= 0) {
          stopTicking();
        }
      }
      detectTurn();
    }, 1000);
  }

  // ---------- 初始化 ----------
  function init() {
    // 只在游戏页启用
    if (SITE !== 'board' || !GAME) return;

    injectPlayerCards();
    detectNewGame();

    // 监听 DOM 变化（某些游戏用 MutationObserver 更新状态）
    var mo = new MutationObserver(function(){ detectTurn(); });
    var observeTarget = document.getElementById('stateVal') ||
                        document.getElementById('turnVal') ||
                        document.body;
    mo.observe(observeTarget, { childList: true, characterData: true, subtree: true });
  }

  function ready(fn){
    if (document.readyState !== 'loading') { fn(); }
    else { document.addEventListener('DOMContentLoaded', fn); }
  }

  ready(init);

  // 暴露 API
  window.GameEnhancer = {
    resetTimers: resetTimers,
    detectTurn: detectTurn,
    setTimerTotal: function(who, seconds) { timers[who].total = seconds; timers[who].left = seconds; updateTimerUI(who); },
    highlightPlayer: highlightPlayer
  };
})();
