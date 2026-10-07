/*!
 * identity.js — 一次取名，之后自动出现
 * ────────────────────────────────────────────────────────────
 * 三站后端早就各自留好了读写昵称的端点，但前端从来没调过写端点，
 * 于是名字只活在 localStorage 里：清缓存就没、换设备就没、
 * 排行榜上看到的是 "Player" 或 "玩家a3f1"。
 *
 * 这个模块把三站的差异（端点路径、字段名、会话方式）收进一张表，
 * 对外只暴露四个动作：me() / save() / mount() / fill()。
 *
 * 容错原则：后端不可用时名字仍然存本机，界面如实说"存在这台设备上"，
 * 不让用户为一个看不见的失败买单。
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var host = (global.location && global.location.hostname) || '';

  /* ─── 站点契约表 ───
     三站的读端点、写端点、字段名、会话方式全不一样，差异到此为止。 */
  var SITES = [
    {
      id: 'mathduel',
      host: /(^|\.)(numeriduel\.com|mathduel\.games|teachduel\.com)$/,
      read: '/api/account/me',
      write: '/api/account/sync',
      field: 'nickname',
      ls: 'mp_name',
      unwrap: function (d) {
        return {
          name: d.nickname || (d.account && d.account.nickname) || null,
          avatar: d.avatar || (d.account && d.account.active && d.account.active.avatar) || null
        };
      }
    },
    {
      id: 'boardduel',
      host: /(^|\.)boardduel\.com$/,
      read: '/api/account/me',
      write: '/api/account/profile',
      field: 'nickname',
      ls: 'bd_nick',   // 沿用 online-core 已在用的键，老用户的名字不会丢
      unwrap: function (d) {
        return {
          name: d.nickname || (d.account && d.account.nickname) || null,
          avatar: d.avatar || (d.account && d.account.active && d.account.active.avatar) || null
        };
      }
    },
    {
      // memoryduel 走 D1 players 表，改名前必须先有 pid + token 会话
      id: 'memoryduel',
      host: /(^|\.)memoryduel\.com$/,
      read: '/api/md/me',
      write: '/api/md/me/rename',
      field: 'name',
      ls: 'mm_name',
      session: '/api/md/session',
      unwrap: function (d) {
        var p = (d && d.data) || {};
        return { name: p.name || null, avatar: null };
      }
    }
  ];

  var site = SITES[0];
  for (var i = 0; i < SITES.length; i++) {
    if (SITES[i].host.test(host)) { site = SITES[i]; break; }
  }

  /* 站点头像 id → emoji（与后端 FREE_AVATARS 同 id 集） */
  var AVATARS = {
    'a-cat': '🐱', 'a-dog': '🐶', 'a-frog': '🐸', 'a-owl': '🦉',
    'a-tiger': '🐯', 'a-bear': '🐻', 'a-penguin': '🐧', 'a-unicorn': '🦄',
    'a-robot': '🤖', 'a-ghost': '👻', 'a-turtle': '🐢', 'a-rabbit': '🐰'
  };

  /* ─── 文案 ───
     句子大小写、主动语态。空态说的是"接下来会怎样"，不是"出错了"。 */
  var T = {
    en: {
      ask: 'Pick a name', ph: 'Your name', go: 'Use this', done: 'Saved',
      hint: 'It rides along with your results on the leaderboard.',
      edit: 'Change', cancel: 'Cancel', device: 'Saved on this device',
      need: 'Type a name first', long: 'Keep it under 18 characters'
    },
    zh: {
      ask: '取个名字', ph: '你的名字', go: '就用它', done: '已记住',
      hint: '这个名字会跟着你的战绩出现在排行榜上。',
      edit: '改名', cancel: '取消', device: '已存在这台设备上',
      need: '先写个名字', long: '最多 18 个字'
    },
    ja: {
      ask: '名前を決めよう', ph: 'あなたの名前', go: 'この名前で', done: '保存しました',
      hint: 'この名前はランキングに成績と一緒に表示されます。',
      edit: '変更', cancel: 'キャンセル', device: 'この端末に保存しました',
      need: '名前を入力してください', long: '18文字以内で入力してください'
    },
    fr: {
      ask: 'Choisis un nom', ph: 'Ton nom', go: 'Utiliser', done: 'Enregistré',
      hint: 'Il apparaîtra au classement à côté de tes résultats.',
      edit: 'Changer', cancel: 'Annuler', device: 'Enregistré sur cet appareil',
      need: 'Écris d’abord un nom', long: '18 caractères maximum'
    },
    de: {
      ask: 'Wähl einen Namen', ph: 'Dein Name', go: 'Übernehmen', done: 'Gespeichert',
      hint: 'Er erscheint mit deinen Ergebnissen in der Bestenliste.',
      edit: 'Ändern', cancel: 'Abbrechen', device: 'Auf diesem Gerät gespeichert',
      need: 'Schreib zuerst einen Namen', long: 'Höchstens 18 Zeichen'
    },
    es: {
      ask: 'Elige un nombre', ph: 'Tu nombre', go: 'Usar este', done: 'Guardado',
      hint: 'Aparecerá en la clasificación junto a tus resultados.',
      edit: 'Cambiar', cancel: 'Cancelar', device: 'Guardado en este dispositivo',
      need: 'Escribe primero un nombre', long: 'Máximo 18 caracteres'
    }
  };

  function t(key) {
    var lang = (doc.documentElement && doc.documentElement.lang) || 'en';
    lang = String(lang).slice(0, 2).toLowerCase();
    var pack = T[lang] || T.en;
    return pack[key] || T.en[key] || key;
  }

  /* ─── 本机存储（永不通路也丢不了的最后一道） ─── */
  function lsGet() {
    try { return global.localStorage.getItem(site.ls) || null; } catch (e) { return null; }
  }
  function lsSet(v) {
    try { global.localStorage.setItem(site.ls, v); } catch (e) { /* 隐私模式 */ }
  }

  /* ─── 会话（仅 memoryduel 需要） ───
     memoryduel 的后端只认 X-Player-ID + X-Player-Token（它不读 cookie），
     而前端早就把这套凭证存在 md_session 里了。必须复用同一个键：
     另起一套 = 建出第二个 pid = 名字存到一个没人用的身份上，等于没存。 */
  function sess() {
    try { return JSON.parse(global.localStorage.getItem('md_session') || 'null'); } catch (e) { return null; }
  }
  function token() {
    var s = sess();
    return (s && s.token) || '';
  }
  function ensureSession() {
    if (!site.session) return Promise.resolve(true);
    if (token()) return Promise.resolve(true);
    return fetch(site.session, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: '{}'
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var s = (d && d.data) || {};
        if (s.pid && s.token) {
          try { global.localStorage.setItem('md_session', JSON.stringify({ pid: s.pid, token: s.token })); } catch (e) {}
          return true;
        }
        return false;
      }).catch(function () { return false; });
  }

  function headers(json) {
    var h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (site.session) {
      var s = sess();
      if (s && s.pid && s.token) {
        h['X-Player-ID'] = s.pid;
        h['X-Player-Token'] = s.token;
      }
    }
    return h;
  }

  /* ─── 读：服务端优先，本机兜底 ─── */
  var _me = null;
  function me() {
    if (_me) return Promise.resolve(_me);
    return ensureSession().then(function () {
      return fetch(site.read, { credentials: 'include', headers: headers(false) });
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var u = d ? site.unwrap(d) : { name: null, avatar: null };
        var name = u.name || lsGet() || null;
        _me = { name: name, avatar: u.avatar || null, where: u.name ? 'server' : (name ? 'device' : null) };
        return _me;
      }).catch(function () {
        var local = lsGet();
        _me = { name: local || null, avatar: null, where: local ? 'device' : null };
        return _me;
      });
  }

  /* ─── 写：先落本机（永不丢），再上行 ─── */
  function clean(v) {
    return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 18);
  }
  function save(raw) {
    var name = clean(raw);
    if (!name) return Promise.resolve({ ok: false, error: 'empty', name: null });
    lsSet(name);
    var body = {};
    body[site.field] = name;
    var send = function () {
      return fetch(site.write, {
        method: 'POST', credentials: 'include',
        headers: headers(true), body: JSON.stringify(body)
      });
    };
    // 先确保账号 cookie 已经下发：读端点在无 cookie 时会建号并种 cookie，
    // 否则下面的写端点直接 401，名字只落本机 —— 那是这次要修的静默失败本身。
    return (_me ? ensureSession() : me()).then(send).then(function (r) {
      if (r.ok) { _me = { name: name, avatar: _me && _me.avatar, where: 'server' }; return { ok: true, name: name, where: 'server' }; }
      // 会话过期：重建一次再试，仍失败就老实说只存了本机
      if (r.status === 401 && site.session) {
        try { global.localStorage.removeItem('md_session'); } catch (e) {}
        return ensureSession().then(send).then(function (r2) {
          var w = r2.ok ? 'server' : 'device';
          _me = { name: name, avatar: _me && _me.avatar, where: w };
          return { ok: true, name: name, where: w };
        }).catch(function () {
          _me = { name: name, avatar: _me && _me.avatar, where: 'device' };
          return { ok: true, name: name, where: 'device' };
        });
      }
      _me = { name: name, avatar: _me && _me.avatar, where: 'device' };
      return { ok: true, name: name, where: 'device' };
    }).catch(function () {
      _me = { name: name, avatar: _me && _me.avatar, where: 'device' };
      return { ok: true, name: name, where: 'device' };
    });
  }

  /* ─── 样式：只注入一次，跟着站点自己的设计变量走 ─── */
  var styled = false;
  function style() {
    if (styled || !doc.head) return;
    styled = true;
    var s = doc.createElement('style');
    s.textContent = [
      '.idt-bar{display:inline-flex;align-items:center;gap:.5rem;font:inherit;color:inherit}',
      '.idt-av{display:inline-grid;place-items:center;width:1.75rem;height:1.75rem;border-radius:50%;',
      'background:var(--brand-50,#EFF5FD);font-size:1rem;line-height:1;flex:none}',
      '.idt-name{font-family:var(--font-display,\'Space Grotesk\',inherit);font-weight:700;letter-spacing:-.01em}',
      '.idt-edit{border:0;background:none;padding:.15rem .3rem;margin:0;font:inherit;font-size:.78rem;',
      'color:var(--brand-600,#0066CC);cursor:pointer;border-radius:.35rem;text-decoration:underline;',
      'text-underline-offset:2px;min-height:0}',
      '.idt-edit:focus-visible{outline:2px solid var(--brand-600,#0066CC);outline-offset:2px}',
      '.idt-ask{padding:var(--s-4,16px);border-radius:var(--r-3,12px);background:var(--surface,#fff);',
      'border:1px solid var(--border,rgba(0,0,0,.1));max-width:26rem;text-align:left}',
      '.idt-ask h3{margin:0 0 .15rem;font-family:var(--font-display,\'Space Grotesk\',inherit);',
      'font-size:1rem;font-weight:700;color:inherit}',
      '.idt-row{display:flex;gap:.5rem;margin:.6rem 0 .4rem}',
      '.idt-in{flex:1;min-width:0;padding:.5rem .7rem;border:1px solid var(--border,rgba(0,0,0,.18));',
      'border-radius:.5rem;font:inherit;font-family:var(--font-sans,inherit);background:var(--bg,#fff);color:inherit}',
      '.idt-in:focus-visible{outline:2px solid var(--brand-600,#0066CC);outline-offset:1px;',
      'border-color:var(--brand-600,#0066CC)}',
      '.idt-go{flex:none;padding:.5rem .9rem;border:0;border-radius:.5rem;cursor:pointer;',
      'background:var(--brand-600,#0066CC);color:#fff;font:inherit;font-weight:600}',
      '.idt-go:disabled{opacity:.45;cursor:default}',
      '.idt-go:focus-visible{outline:2px solid var(--brand-600,#0066CC);outline-offset:2px}',
      '.idt-note{margin:0;font-size:.8rem;line-height:1.45;color:var(--muted,rgba(0,0,0,.55))}',
      '.idt-note.ok{color:var(--ok,#0a7d3f)}',
      /* compact：塞进顶栏那一行——没有标题，输入框收窄，提示只在出结果时出现 */
      '.idt-ask.compact{display:inline-flex;align-items:center;gap:.4rem;max-width:none;',
      'padding:0;border:0;background:none}',
      '.idt-ask.compact .idt-row{margin:0;gap:.35rem}',
      '.idt-ask.compact .idt-in{width:9rem;padding:.35rem .6rem;font-size:.85rem}',
      '.idt-ask.compact .idt-go{padding:.35rem .7rem;font-size:.85rem}',
      '.idt-ask.compact .idt-note{font-size:.75rem;white-space:nowrap}',
      '@media (prefers-reduced-motion:reduce){.idt-go,.idt-edit{transition:none}}'
    ].join('');
    doc.head.appendChild(s);
  }

  function iconFor(av) {
    if (!av) return '🙂';
    if (global.Avatars && typeof global.Avatars.icon === 'function') {
      var v = global.Avatars.icon(av);
      if (v) return v;
    }
    return AVATARS[av] || '🙂';
  }

  /* ─── 挂载：有名字显示身份条，没名字给一张内联取名卡 ─── */
  function mount(el, opts) {
    if (!el) return Promise.resolve(null);
    opts = opts || {};
    style();
    return me().then(function (m) {
      el.innerHTML = '';
      if (m.name) {
        el.appendChild(bar(m, el, opts));
        return m;
      }
      if (opts.silent) return m;   // 只想知道名字，不催用户取名
      el.appendChild(ask(el, opts));
      return m;
    });
  }

  function bar(m, root, opts) {
    var w = doc.createElement('span');
    w.className = 'idt-bar';
    var av = doc.createElement('span');
    av.className = 'idt-av';
    av.textContent = iconFor(m.avatar);
    var nm = doc.createElement('span');
    nm.className = 'idt-name';
    nm.textContent = m.name;
    w.appendChild(av);
    w.appendChild(nm);
    if (opts.editable !== false) {
      var b = doc.createElement('button');
      b.className = 'idt-edit';
      b.type = 'button';
      b.textContent = t('edit');
      b.addEventListener('click', function () {
        root.innerHTML = '';
        root.appendChild(ask(root, opts, m.name));
        var f = root.querySelector('.idt-in');
        if (f) f.focus();
      });
      w.appendChild(b);
    }
    return w;
  }

  function ask(root, opts, current) {
    var compact = !!opts.compact;
    var box = doc.createElement('div');
    box.className = 'idt-ask' + (compact ? ' compact' : '');
    var h = doc.createElement('h3');
    h.textContent = t('ask');
    var row = doc.createElement('div');
    row.className = 'idt-row';
    var inp = doc.createElement('input');
    inp.className = 'idt-in';
    inp.type = 'text';
    inp.maxLength = 18;
    inp.placeholder = t('ph');
    inp.autocomplete = 'nickname';
    if (current) inp.value = current;
    var go = doc.createElement('button');
    go.className = 'idt-go';
    go.type = 'button';
    go.textContent = t('go');
    row.appendChild(inp);
    row.appendChild(go);
    var note = doc.createElement('p');
    note.className = 'idt-note';
    note.textContent = t('hint');
    if (compact) {
      // 顶栏放不下整句说明，收进 title；只在该说话时（空名字、太長、保存结果）才占位
      inp.title = t('hint');
      note.style.display = 'none';
    }
    if (!compact) box.appendChild(h);
    box.appendChild(row);
    box.appendChild(note);

    function speak(cls, msg) {
      note.className = 'idt-note' + (cls ? ' ' + cls : '');
      note.textContent = msg;
      note.style.display = '';
    }

    function submit() {
      var v = clean(inp.value);
      if (!v) { speak('', t('need')); inp.focus(); return; }
      go.disabled = true;
      save(v).then(function (r) {
        root.innerHTML = '';
        var b = bar({ name: r.name, avatar: r.avatar || (_me && _me.avatar) }, root, opts);
        root.appendChild(b);
        if (compact) { speak(r.where === 'server' ? 'ok' : '', r.where === 'server' ? t('done') : t('device')); root.appendChild(note); }
        if (typeof opts.onNamed === 'function') opts.onNamed(r.name);
      });
    }

    go.addEventListener('click', submit);
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    return box;
  }

  /* ─── 把名字填进已有的输入框（竞赛大厅那种） ─── */
  function fill(input) {
    if (!input) return Promise.resolve(null);
    return me().then(function (m) {
      if (m.name && !input.value) input.value = m.name;
      return m;
    });
  }

  /* ─── 页面里所有 [data-identity] 自动挂载 ─── */
  function autoload() {
    var els = doc.querySelectorAll('[data-identity]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.dataset.idtDone) continue;
      var mode = el.getAttribute('data-identity');
      el.dataset.idtDone = '1';
      mount(el, { silent: mode === 'silent', compact: mode === 'compact' });
    }
  }

  /* 已解析的名字（同步）。还没问过服务端就返回本机那份，都没有则 null。
     调用方拿 null 时请生成唯一名字，别回落成 'Player' —— 服务端按名字复用座位，
     两个 'Player' 会被塞进同一个座位（这条是 boardduel 2026-10-05 PvP 实测踩过的）。 */
  function current() {
    return (_me && _me.name) || lsGet() || null;
  }

  var API = {
    site: site.id,
    me: me,
    save: save,
    mount: mount,
    fill: fill,
    current: current,
    autoload: autoload,
    icon: iconFor
  };

  global.Identity = API;

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', autoload);
  } else {
    autoload();
  }
})(window);
