/* ═══════════════════════════════════════════════════════════════
   match-mode.js — 棋类对战三模式通用前端模块
   - 暴露全局 window.BoardDuelMatch
   - 模式:ai(本地人机) / online(好友建房) / random(随机配对)
   - 联机/随机匹配均调用后端 /api/match/{join,poll,cancel}
   - 随机配对 8 秒超时由后端自动 AI 补位,前端只显示真人风格昵称
   使用方法:
     BoardDuelMatch.init({
       game: 'tictactoe',           // 游戏标识,后端 GAMES 白名单需匹配
       aiNames: ['玩家A','玩家B'],   // 可选:AI 补位时随机昵称列表(后端自带一组)
       onStartAI: () => { ... },    // 进入人机模式(已有内部逻辑)
       onEnterOnline: (code, asCreator) => { ... }, // 进入联机模式:由调用方建/连 ws
       onStop: () => { ... }        // 退出任意对战(用于清理 ws/计时器)
     });
   HTML 必备元素(可调用 BoardDuelMatch.inject(containerEl) 自动注入):
     #bd-mode-toggle : 含 [data-m="ai"] / [data-m="online"] / [data-m="random"] 三个按钮
     #bd-lobby      : 建房/加入 UI 容器(联机时显示)
     #bd-random-panel : 匹配等待 UI(随机配对时显示)
     #bd-mode-val   : 模式文本
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function t(key, fallback) {
    if (typeof window !== 'undefined' && window.t) {
      try {
        var v = window.t(key);
        if (v && v !== key) return v;
      } catch (e) {}
    }
    return fallback || key;
  }

  var state = {
    game: null,
    onStartAI: null,
    onEnterOnline: null,
    onStop: null,
    aiNames: null,
    active: false,
    matchId: null,
    pollTimer: null,
    name: t('match.default_player', 'Player') + Math.floor(1000 + Math.random() * 9000),
    mode: 'ai'
  };

  function $(id) { return document.getElementById(id); }

  function init(opts) {
    state.game = opts.game;
    state.onStartAI = opts.onStartAI || function () {};
    state.onEnterOnline = opts.onEnterOnline || function () {};
    state.onStop = opts.onStop || function () {};
    state.aiNames = opts.aiNames || null;
    state.name = opts.name || state.name;
    // 绑定 toggle 按钮(若存在)
    var toggle = $('bd-mode-toggle');
    if (toggle) {
      toggle.querySelectorAll('button[data-m]').forEach(function (b) {
        b.onclick = function () { setMode(b.dataset.m); };
      });
    }
    var cancelBtn = $('bd-random-cancel');
    if (cancelBtn) cancelBtn.onclick = function () { stopMatch(); setMode('ai'); };
    var createBtn = $('bd-create-btn');
    if (createBtn) createBtn.onclick = function () { createRoom(); };
    var joinBtn = $('bd-join-btn');
    if (joinBtn) joinBtn.onclick = function () { joinRoom(); };
    var copyBtn = $('bd-copy-btn');
    if (copyBtn) copyBtn.onclick = function () { copyInvite(); };
  }

  function setMode(m) {
    state.mode = m;
    var toggle = $('bd-mode-toggle');
    if (toggle) toggle.querySelectorAll('button[data-m]').forEach(function (b) { b.classList.toggle('on', b.dataset.m === m); });
    var mv = $('bd-mode-val'); if (mv) mv.textContent = m === 'online' ? t('match.mode_online') : (m === 'random' ? t('match.mode_random') : t('match.mode_ai'));
    // 显隐各面板
    var lobby = $('bd-lobby'); if (lobby) lobby.style.display = (m === 'online') ? '' : 'none';
    var rp = $('bd-random-panel'); if (rp) rp.style.display = (m === 'random') ? '' : 'none';
    // 切模式先停旧
    stopMatch();
    state.onStop();
    if (m === 'ai') { state.onStartAI(); }
    else if (m === 'random') { startMatch(); }
    // online 不自动建房,由用户点 "创建房间" 或 "加入"
  }

  function stopMatch() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    if (state.matchId) {
      var mid = state.matchId;
      fetch('/api/match/cancel', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: state.game, matchId: mid })
      }).catch(function () {});
      state.matchId = null;
    }
  }

  function startMatch() {
    stopMatch();
    var statusEl = $('bd-random-status');
    if (statusEl) statusEl.textContent = t('match.matchmaking');
    fetch('/api/match/join', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: state.game, name: state.name })
    }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.status === 'matched') { handleMatchResult(d); return; }
        state.matchId = d.matchId;
        state.pollTimer = setInterval(function () {
          fetch('/api/match/poll?matchId=' + encodeURIComponent(state.matchId), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (p) { if (p.status === 'matched') { clearInterval(state.pollTimer); state.pollTimer = null; handleMatchResult(p); } })
            .catch(function () {});
        }, 5000);
      })
      .catch(function () { if (statusEl) statusEl.textContent = t('match.match_fail'); });
  }

  function handleMatchResult(d) {
    var rp = $('bd-random-panel'); if (rp) rp.style.display = 'none';
    if (d.ai) {
      // AI 补位:进入人机模式,但选手昵称由游戏页 onStartAI 自己适配(读取 d.aiName)
      state._aiFillName = d.aiName || t('match.mysterious_player');
      state.onStartAI({ aiFillName: state._aiFillName });
    } else {
      // 真人:进入联机模式,调用方负责建/连 ws
      state.mode = 'online';
      var toggle = $('bd-mode-toggle');
      if (toggle) toggle.querySelectorAll('button[data-m]').forEach(function (b) { b.classList.toggle('on', b.dataset.m === 'online'); });
      var mv = $('bd-mode-val'); if (mv) mv.textContent = t('match.mode_online');
      var lobby = $('bd-lobby'); if (lobby) lobby.style.display = 'none';
      state.onEnterOnline(d.code, false);
    }
  }

  function createRoom() {
    var nameEl = $('bd-name');
    var n = (nameEl && nameEl.value && nameEl.value.trim()) || state.name;
    fetch('/api/gp/room?game=' + encodeURIComponent(state.game) + '&name=' + encodeURIComponent(n), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (e) { throw new Error(e.error || t('match.create_room_fail')); }); })
      .then(function (d) {
        showWaiting(d.code);
        state.onEnterOnline(d.code, true);
      })
      .catch(function (e) { alert(e.message); });
  }

  function joinRoom() {
    var cEl = $('bd-code-input');
    var code = (cEl && cEl.value && cEl.value.trim().toUpperCase()) || '';
    if (!/^[A-Z2-9]{6}$/.test(code)) { alert(t('match.enter_room_code')); return; }
    state.onEnterOnline(code, false);
  }

  function showWaiting(code) {
    var lobby = $('bd-lobby'); if (lobby) lobby.style.display = 'none';
    var wt = $('bd-waiting'); if (wt) wt.style.display = '';
    var ce = $('bd-code'); if (ce) ce.textContent = code;
    var st = $('bd-status'); if (st) st.textContent = t('match.connected_waiting');
  }

  function copyInvite() {
    var ce = $('bd-code'); var code = ce ? ce.textContent : '';
    if (!code) return;
    var url = location.origin + '/b/' + state.game + '/' + code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { var st = $('bd-status'); if (st) st.textContent = t('match.invite_copied'); });
    } else {
      prompt(t('match.copy_invite_link'), url);
    }
  }

  function getAiFillName() { return state._aiFillName || null; }
  function getMode() { return state.mode; }
  function getName() { return state.name; }

  window.BoardDuelMatch = {
    init: init,
    setMode: setMode,
    stopMatch: stopMatch,
    createRoom: createRoom,
    joinRoom: joinRoom,
    showWaiting: showWaiting,
    copyInvite: copyInvite,
    getAiFillName: getAiFillName,
    getMode: getMode,
    getName: getName
  };
})();
