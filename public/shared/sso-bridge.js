/* ═══════════════════════════════════════════════════════════════
   跨站 SSO 桥（P1, 2026-09-20）
   ────────────────────────────────────────────────────────────────
   背景：auth 模块的 /api/auth/sso/issue + /api/auth/sso/consume 早已实现（5 分钟 TTL、一次性），
   但前端把 token 存在 localStorage 里，而 localStorage 是**按源隔离**的
   ⇒ mathduel.games 写的 token，boardduel.com 永远读不到；也没有任何 ?sso= 读取或链接携带
   ⇒ 三站实际上各自登录（SSO 形同虚设）。

   本脚本补上唯一可靠的跨域通道：**URL 重定向传递**
     ① 目标站拿到 ?sso=<token> → POST /sso/consume → 立刻从地址栏抹掉 token（防进历史/Referer）
     ② 姐妹站链接点击时，若已登录 → 先 issue 一个一次性 token → 跳到 <站>?sso=<token>
   ⚠️ 安全说明：token 5 分钟过期 + 一次性消耗（服务端 used 标记）+ 到达即清 URL，
      与主流跨域 SSO 的 URL 传递做法一致；站点若是登录态则同时刷新本站 cookie。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SISTER_HOSTS = ['mathduel.games', 'boardduel.com', 'memoryduel.com'];
  var LEGACY_KEY = 'sso_token_v1';
  var RELOAD_FLAG = 'sso_reloaded_v1';

  function isSisterHost(host) {
    host = String(host || '').toLowerCase();
    for (var i = 0; i < SISTER_HOSTS.length; i++) {
      if (host === SISTER_HOSTS[i] || host.slice(-1 * (SISTER_HOSTS[i].length + 1)) === '.' + SISTER_HOSTS[i]) return true;
    }
    return false;
  }

  /* ─── ① 到达本站时消费 URL 里的 token ─── */
  function consumeFromUrl() {
    var u;
    try { u = new URL(location.href); } catch (e) { return; }
    var token = u.searchParams.get('sso');
    if (!token) return;

    /* 先清地址栏（token 不进历史、不被 Referer 带走），再发请求 */
    try {
      u.searchParams.delete('sso');
      history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + (u.hash || ''));
    } catch (e) { /* 清不掉也不阻断 */ }

    fetch('/api/auth/sso/consume', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.uuid) return;
        try { localStorage.removeItem(LEGACY_KEY); } catch (e) {}
        window.dispatchEvent(new CustomEvent('sso:consumed', { detail: d }));
        /* 站点页面多半已在"游客身份"下渲染过 → 重载一次拿新身份（sessionStorage 防循环） */
        try {
          if (!sessionStorage.getItem(RELOAD_FLAG)) {
            sessionStorage.setItem(RELOAD_FLAG, '1');
            location.reload();
          }
        } catch (e) { location.reload(); }
      })
      .catch(function () { /* 失败就当没带 token，不打扰用户 */ });
  }

  /* ─── ② 姐妹站链接：已登录则附一次性 token ─── */
  var loggedState = null;   // null=未探测

  function checkLogged(cb) {
    if (loggedState !== null) { cb(loggedState); return; }
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { loggedState = !!(d && d.uuid); cb(loggedState); })
      .catch(function () { loggedState = false; cb(false); });
  }

  function issueToken(cb) {
    fetch('/api/auth/sso/issue', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { cb(d && d.token ? d.token : null); })
      .catch(function () { cb(null); });
  }

  function decorateSisterLinks() {
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      (function (a) {
        if (a.__ssoBound) return;
        var abs;
        try { abs = new URL(a.getAttribute('href') || '', location.href); } catch (e) { return; }
        if (abs.protocol !== 'https:' && abs.protocol !== 'http:') return;
        if (!isSisterHost(abs.hostname)) return;
        if (abs.hostname === location.hostname) return;      // 同站链接不需要
        if (a.dataset && a.dataset.ssoSkip === '1') return;  // 允许单条豁免
        a.__ssoBound = true;
        a.addEventListener('click', function (ev) {
          if (ev.defaultPrevented) return;
          if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
          if (a.target && a.target !== '_self') return;
          ev.preventDefault();
          checkLogged(function (ok) {
            if (!ok) { location.href = abs.toString(); return; }
            issueToken(function (tk) {
              var dest = new URL(abs.toString());
              if (tk) dest.searchParams.set('sso', tk);
              location.href = dest.toString();
            });
          });
        });
      })(links[i]);
    }
  }

  consumeFromUrl();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', decorateSisterLinks);
  } else {
    decorateSisterLinks();
  }
  /* 站点头部/页脚常由 JS 后注入 → 再扫两次 */
  setTimeout(decorateSisterLinks, 1200);
  setTimeout(decorateSisterLinks, 3000);
})();
