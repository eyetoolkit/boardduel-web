(function () {
  /* ═══════════════════════════════════════════════════════
     auth-modal 组件
     ───────────────────────────────────────────────────────────────
     功能：
       - 注册 / 登录 Tab 切换
       - 邮箱 + 密码 + 昵称注册（POST /api/auth/register）
       - 邮箱 + 密码登录（POST /api/auth/login）
       - 忘记密码（POST /api/auth/forgot-password）
       - 匿名账号绑定邮箱升级（POST /api/auth/bind-old）
     事件：open-auth-modal / open-login-tab（可被任意元素触发）
     ═══════════════════════════════════════════════════════ */
  'use strict';

  const API_BASE = (typeof window !== 'undefined' && window.API_BASE ? window.API_BASE + '/auth' : '/api/auth');
  let turnstileReady = false;
  let turnstileToken = 'skip';

  function t(key, fallback) {
    if (typeof window !== 'undefined' && window.t) {
      try {
        var v = window.t(key);
        if (v && v !== key) return v;
      } catch (e) {}
    }
    return fallback || key;
  }

  /* ─── Turnstile 加载 ─── */
  function loadTurnstile() {
    if (typeof window !== 'undefined' && window.turnstile) return;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
    s.onload = () => {
      if (window.turnstile) {
        window.turnstile.render('#turnstile-container', {
          sitekey: window.__TURNSITE_KEY__ || '0x4AAAAAAE9UnLMYQbPPsK5Q',
          callback: (token) => { turnstileToken = token; },
          'error-callback': () => { turnstileToken = 'error'; },
          'expired-callback': () => { turnstileToken = 'expired'; },
          theme: 'light',
        }, (el, status) => {
          if (status === 'rendered') turnstileReady = true;
        });
      }
    };
  }

  /* ─── 工具函数 ─── */
  function qs(sel) { return document.querySelector(sel); }
  function qsa(sel) { return [...document.querySelectorAll(sel)]; }

  function showError(msg) {
    const el = qs('#auth-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }
  function clearError() { showError(''); qs('#auth-error').style.display = 'none'; }

  function setLoading(on) {
    qsa('.auth-submit-btn').forEach(b => {
      b.disabled = on;
      b.textContent = on ? t('auth.processing') : b.dataset.label || t('auth.register');
    });
  }

  async function apiFetch(path, body, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, turnstile_token: turnstileToken }),
      credentials: 'same-origin',
      ...opts,
    });
    const data = await res.json().catch(() => ({ error: 'network_error' }));
    return { ok: res.ok, status: res.status, data };
  }

  function switchTab(tab) {
    qsa('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    qsa('.auth-panel').forEach(p => p.style.display = p.dataset.panel === tab ? 'block' : 'none');
    clearError();
    if (tab === 'register') loadTurnstile();
  }

  /* ─── 注册表单提交 ─── */
  async function handleRegister(e) {
    e.preventDefault();
    clearError();
    const email = qs('#auth-email')?.value.trim();
    const password = qs('#auth-password')?.value;
    const nickname = qs('#auth-nickname')?.value.trim();
    if (!email || !password || !nickname) { showError(t('auth.fill_all')); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError(t('auth.invalid_email')); return; }
    if (password.length < 8) { showError(t('auth.password_short')); return; }
    setLoading(true);
    try {
      const { ok, status, data } = await apiFetch('/register', { email, password, nickname });
      if (ok) {
        showSuccess(t('auth.verification_sent'));
        qs('.auth-panel[data-panel="register"]').innerHTML = '<p style="text-align:center;padding:20px 0;color:#166534">' + t('auth.verification_sent') + '</p>';
      } else {
        const msgs = {
          email_already_registered: t('auth.email_used'),
          ip_register_limit: t('auth.ip_limit'),
          turnstile_failed: t('auth.turnstile_fail'),
          invalid_email: t('auth.invalid_email'),
          password_too_short: t('auth.password_short'),
          password_need_uppercase: t('auth.password_uppercase'),
          body_too_large: t('auth.body_too_large'),
        };
        showError(msgs[data.error] || data.error || t('auth.register_fail'));
      }
    } catch (err) {
      showError(t('auth.network_error'));
    } finally {
      setLoading(false);
    }
  }

  /* ─── 登录表单提交 ─── */
  async function handleLogin(e) {
    e.preventDefault();
    clearError();
    const email = qs('#login-email')?.value.trim();
    const password = qs('#login-password')?.value;
    if (!email || !password) { showError(t('auth.fill_all')); return; }
    setLoading(true);
    try {
      const { ok, status, data } = await apiFetch('/login', { email, password });
      if (ok) {
        location.reload();
      } else {
        const msgs = {
          invalid_credentials: t('auth.invalid_credentials'),
          email_not_verified: t('auth.email_not_verified'),
          turnstile_failed: t('auth.turnstile_fail'),
        };
        showError(msgs[data.error] || data.error || t('auth.login_fail'));
      }
    } catch (err) {
      showError(t('auth.network_error'));
    } finally {
      setLoading(false);
    }
  }

  /* ─── 忘记密码表单 ─── */
  async function handleForgot(e) {
    e.preventDefault();
    const email = qs('#forgot-email')?.value.trim();
    if (!email) return;
    setLoading(true);
    try {
      const { ok } = await apiFetch('/forgot-password', { email });
      qs('#forgot-panel').innerHTML = '<p style="text-align:center;padding:20px;color:#166534">' + t('auth.password_reset_email_sent') + '</p>';
    } catch {
      showError(t('auth.network_error'));
    } finally {
      setLoading(false);
    }
  }

  /* ─── 匿名账号升级为注册账号 ───
     2026-09-20: 改用 /guest-bind。游客没有 auth 会话，调 /bind-old 必返 401；
     guest-bind 验签站点匿名 cookie（boardduel = pid）后**用原 uuid 建号**，
     头像/Elo/战绩/金币自动继承。昵称留空 = 保留匿名期昵称。 */
  async function handleBindOld(e) {
    e.preventDefault();
    clearError();
    const email = qs('#bind-email')?.value.trim();
    const password = qs('#bind-password')?.value;
    const nickname = (qs('#bind-nickname')?.value || '').trim();   // 可选：留空=继承匿名昵称
    if (!email || !password) { showError(t('auth.fill_all')); return; }
    setLoading(true);
    try {
      const payload = { email, password };
      if (nickname) payload.nickname = nickname;
      const { ok, data } = await apiFetch('/guest-bind', payload);
      if (ok) {
        location.reload();
      } else {
        showError(data.error || t('auth.bind_fail'));
      }
    } catch {
      showError(t('auth.network_error'));
    } finally {
      setLoading(false);
    }
  }

  /* ─── 登出 ─── */
  async function handleLogout(e) {
    e?.preventDefault?.();
    try {
      await fetch(`${API_BASE}/logout`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {}
    localStorage.removeItem('oauth_login_success');
    localStorage.removeItem('sso_token_v1');
    location.reload();
  }

  /* ─── 设置新密码（重置） ─── */
  async function handleResetPassword(e) {
    e.preventDefault();
    clearError();
    const token = new URLSearchParams(location.search).get('token')
      || (location.pathname.match(/\/reset-password\/([^/]+)/)?.[1])
      || qs('#reset-token')?.value?.trim();
    const newPassword = qs('#reset-new-password')?.value;
    const confirm = qs('#reset-confirm')?.value;
    if (!token) { showError(t('auth.reset_token_missing')); return; }
    if (!newPassword || newPassword.length < 8) { showError(t('auth.password_min')); return; }
    if (newPassword !== confirm) { showError(t('auth.password_mismatch')); return; }
    setLoading(true);
    try {
      const { ok, data } = await apiFetch('/reset-password', { token, new_password: newPassword });
      if (ok) {
        qs('.auth-panel[data-panel="reset"]').innerHTML =
          '<p style="text-align:center;padding:20px 0;color:#166534">' + t('auth.password_reset_success') + '</p>';
        setTimeout(() => { switchTab('login'); }, 1500);
      } else {
        const msgs = {
          invalid_or_expired_token: t('auth.reset_link_invalid'),
          password_too_short: t('auth.password_min'),
        };
        showError(msgs[data.error] || data.error || t('auth.reset_fail'));
      }
    } catch {
      showError(t('auth.network_error'));
    } finally {
      setLoading(false);
    }
  }

  /* ─── 检查登录状态 + SSO 跨域免登 ─── */
  let currentUser = null;

  async function tryConsumeSso() {
    // 从另一个站跳过来时，localStorage 里可能有 SSO token
    const token = localStorage.getItem('sso_token_v1');
    if (!token) return false;
    try {
      const res = await fetch(`${API_BASE}/sso/consume`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        localStorage.removeItem('sso_token_v1'); // 一次性
        return true;
      }
    } catch {}
    localStorage.removeItem('sso_token_v1'); // 消费失败也清掉
    return false;
  }

  async function issueSsoToken() {
    try {
      const res = await fetch(`${API_BASE}/sso/issue`, { credentials: 'same-origin' });
      if (res.ok) {
        const d = await res.json();
        if (d.token) {
          localStorage.setItem('sso_token_v1', d.token);
          return true;
        }
      }
    } catch {}
    return false;
  }

  async function checkAuthStatus() {
    // Step 1: 先尝试消费其他站带来的 SSO token
    await tryConsumeSso();

    // Step 2: 检查本站登录态
    try {
      const res = await fetch(`${API_BASE}/me`, { credentials: 'same-origin' });
      if (res.ok) {
        const d = await res.json();
        if (d && d.uuid) {
          currentUser = d;
          // 更新页面上的登录态按钮
          document.querySelectorAll('[data-open-auth]').forEach(btn => {
            /* P1: 优先用共享模块渲染「[段位] 头像 昵称」（与 mathduel 一致）；未加载时降级为 👤+昵称 */
            let handled = false;
            if (typeof window !== 'undefined' && window.MDAuthExtras && window.MDAuthExtras.decorateUserButton) {
              handled = window.MDAuthExtras.decorateUserButton(btn, currentUser);
            }
            if (!handled) {
              const label = currentUser.nickname || '用户';
              btn.textContent = '👤 ' + label;
            }
            btn.removeAttribute('data-open-auth');
            btn.setAttribute('data-user-logged', '');
            btn.dataset.action = 'logout';
          });
          // Step 3: 已登录 → 再发一个 SSO token 到 localStorage（供其他站消费）
          issueSsoToken();
        }
      }
    } catch {}
    return currentUser;
  }

  /* ─── 打开弹窗 ─── */
  function openModal(tab) {
    const overlay = qs('#auth-modal-overlay');
    if (!overlay) return;
    overlay.classList.add('open');
    overlay.style.display = 'flex';
    switchTab(tab || 'register');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    const overlay = qs('#auth-modal-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      overlay.style.display = 'none';
    }
    document.body.style.overflow = '';
  }

  function showSuccess(msg) {
    const el = qs('#auth-error');
    if (el) {
      el.textContent = msg;
      el.style.color = '#166534';
      el.style.display = 'block';
    }
  }

  /* ─── 挂载事件 ─── */
  function mount() {
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!target) return;
      if (target.closest('[data-open-auth]')) { openModal(target.dataset.openAuthTab || 'register'); return; }
      if (target.closest('[data-open-login]')) { openModal('login'); return; }
      if (target.closest('#auth-modal-close') || target.id === 'auth-modal-overlay') closeModal();
      if (target.closest('#auth-close')) closeModal();
      if (target.closest('.auth-tab')) switchTab(target.dataset.tab);
      if (target.closest('#auth-submit-register')) handleRegister(e);
      if (target.closest('#auth-submit-login')) handleLogin(e);
      if (target.closest('#auth-submit-forgot')) handleForgot(e);
      if (target.closest('#auth-submit-bind')) handleBindOld(e);
      if (target.closest('#auth-switch-login')) switchTab('login');
      if (target.closest('#auth-switch-register')) switchTab('register');
      if (target.closest('#auth-switch-login2')) switchTab('login');
      if (target.closest('#auth-submit-reset')) handleResetPassword(e);
      if (target.closest('#oauth-google-register') || target.closest('#oauth-google-login')) {
        location.href = '/api/auth/oauth/google';
        return;
      }
      if (target.closest('#oauth-github-register') || target.closest('#oauth-github-login')) {
        location.href = '/api/auth/oauth/github';
        return;
      }
      if (target.closest('#auth-logout') || target.closest('[data-action="logout"]')) {
        handleLogout(e);
        return;
      }
    });

    document.addEventListener('open-auth-modal', (e) => openModal(e.detail?.tab || 'register'));
    document.addEventListener('open-login-tab', () => openModal('login'));
  }

  /* ─── 注入样式 ─── */
  function injectStyles() {
    if (qs('#auth-modal-styles')) return;
    const css = document.createElement('style');
    css.id = 'auth-modal-styles';
    css.textContent = `
      #auth-modal-overlay {
        position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9998;
        display:none;align-items:center;justify-content:center;
      }
      #auth-modal-overlay.open { display:flex !important }
      #auth-modal {
        background:#fff;border-radius:16px;width:min(440px,96vw);
        padding:32px 28px 24px;position:relative;
        box-shadow:0 20px 60px rgba(0,0,0,0.18);
      }
      #auth-close {
        position:absolute;top:12px;right:16px;
        background:none;border:none;font-size:22px;cursor:pointer;color:#9ca3af;
        line-height:1;padding:4px 8px;border-radius:6px;transition:.15s;
      }
      #auth-close:hover { background:#f3f4f6;color:#374151 }
      .auth-title { text-align:center;font-size:1.25rem;font-weight:700;margin-bottom:4px;color:#1f2937 }
      .auth-sub { text-align:center;color:#6b7280;font-size:.85rem;margin-bottom:20px }
      .auth-tabs { display:flex;gap:0;margin-bottom:20px;border-bottom:1px solid #e5e7eb }
      .auth-tab {
        flex:1;padding:8px 0;text-align:center;cursor:pointer;
        font-size:.9rem;font-weight:500;color:#6b7280;
        border-bottom:2px solid transparent;margin-bottom:-1px;background:none;border-top:none;border-left:none;border-right:none;transition:.15s;
      }
      .auth-tab.active { color:#4f46e5;border-bottom-color:#4f46e5 }
      .auth-panel { display:none }
      .form-group { margin-bottom:14px }
      .form-group label { display:block;font-size:.82rem;font-weight:600;color:#374151;margin-bottom:5px }
      .form-group input {
        width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;
        font-size:.95rem;outline:none;transition:border-color .15s;box-sizing:border-box;
      }
      .form-group input:focus { border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.1) }
      .auth-error {
        background:#fef2f2;border:1px solid #fecaca;color:#dc2626;
        padding:10px 14px;border-radius:8px;font-size:.85rem;margin-bottom:14px;display:none;
      }
      #turnstile-container { min-height:65px;margin-bottom:16px;display:flex;align-items:center;justify-content:center }
      .auth-submit-btn {
        width:100%;padding:12px;background:#4f46e5;color:#fff;border:none;
        border-radius:10px;font-size:.95rem;font-weight:600;cursor:pointer;margin-bottom:12px;
        transition:background .15s;
      }
      .auth-submit-btn:hover { background:#4338ca }
      .auth-submit-btn:disabled { background:#a5b4fc;cursor:not-allowed }
      .auth-divider { text-align:center;margin:8px 0 12px;position:relative }
      .auth-divider::before {
        content:'';position:absolute;top:50%;left:0;right:0;height:1px;background:#e5e7eb;
      }
      .auth-divider span { background:#fff;padding:0 12px;position:relative;color:#9ca3af;font-size:.82rem }
      .auth-switch { text-align:center;font-size:.85rem;color:#6b7280;margin-top:8px }
      .auth-switch button {
        background:none;border:none;color:#4f46e5;font-weight:600;cursor:pointer;font-size:.85rem;padding:0;
      }
      .auth-switch button:hover { text-decoration:underline }
      .auth-note { font-size:.78rem;color:#9ca3af;text-align:center;margin-top:12px;line-height:1.5 }
      .auth-divider { text-align:center;margin:16px 0 12px;position:relative;color:#9ca3af;font-size:.8rem }
      .auth-divider::before { content:'';position:absolute;top:50%;left:0;right:0;height:1px;background:#e5e7eb }
      .auth-divider span { background:#fff;padding:0 12px;position:relative }
      .oauth-btn { width:100%;display:flex;align-items:center;justify-content:center;gap:10px;padding:11px;border:1.5px solid #e5e7eb;background:#fff;border-radius:10px;font-size:.92rem;font-weight:600;cursor:pointer;margin-bottom:8px;transition:.15s;color:#374151 }
      .oauth-btn:hover { border-color:#d1d5db;background:#f9fafb;transform:translateY(-1px);box-shadow:0 2px 8px rgba(0,0,0,.06) }
      .oauth-btn svg { flex-shrink:0 }
    `;
    document.head.appendChild(css);
  }

  /* ─── 注入 HTML ─── */
  function injectHTML() {
    if (qs('#auth-modal')) return;
    const html = document.createElement('div');
    html.id = 'auth-modal-overlay';
    html.innerHTML = `
      <div id="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button id="auth-close" aria-label="${t('common.close')}">✕</button>
        <h2 class="auth-title" id="auth-title" data-i18n="auth.welcome">${t('auth.welcome')}</h2>
        <p class="auth-sub" data-i18n="auth.register_bonus">${t('auth.register_bonus')}</p>
        <div class="auth-tabs">
          <button class="auth-tab active" data-tab="register" data-i18n="auth.register">${t('auth.register')}</button>
          <button class="auth-tab" data-tab="login" data-i18n="auth.login">${t('auth.login')}</button>
        </div>
        <div id="auth-error" class="auth-error" style="display:none"></div>

        <!-- 注册面板 -->
        <div class="auth-panel" data-panel="register">
          <div class="form-group">
            <label for="auth-email" data-i18n="auth.email">${t('auth.email')}</label>
            <input id="auth-email" type="email" placeholder="you@example.com" autocomplete="email" />
          </div>
          <div class="form-group">
            <label for="auth-password" data-i18n="auth.password_hint_label">${t('auth.password')}</label>
            <input id="auth-password" type="password" placeholder="••••••••" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label for="auth-nickname" data-i18n="auth.nickname_hint_label">${t('auth.nickname')}</label>
            <input id="auth-nickname" type="text" data-i18n-placeholder="auth.nickname_placeholder" placeholder="${t('auth.nickname_placeholder')}" maxlength="20" />
          </div>
          <div id="turnstile-container"></div>
          <button class="auth-submit-btn" id="auth-submit-register" data-label="${t('auth.submit_register')}" data-i18n="auth.submit_register">${t('auth.submit_register')}</button>

          <div class="auth-divider"><span data-i18n="auth.or_social">${t('auth.or_social')}</span></div>

          <button class="oauth-btn oauth-google" id="oauth-google-register" type="button">
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            <span data-i18n="auth.use_google">${t('auth.use_google')}</span>
          </button>
          <button class="oauth-btn oauth-github" id="oauth-github-register" type="button">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#1f2937"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
            <span data-i18n="auth.use_github">${t('auth.use_github')}</span>
          </button>

          <p class="auth-note" data-i18n="auth.terms_agree">${t('auth.terms_agree')}</p>
          <p class="auth-switch"><span data-i18n="auth.already_account">${t('auth.already_account')}</span><button id="auth-switch-login" data-i18n="auth.login_now">${t('auth.login_now')}</button></p>
        </div>

        <!-- 登录面板 -->
        <div class="auth-panel" data-panel="login" style="display:none">
          <div class="form-group">
            <label for="login-email" data-i18n="auth.email">${t('auth.email')}</label>
            <input id="login-email" type="email" placeholder="you@example.com" autocomplete="email" />
          </div>
          <div class="form-group">
            <label for="login-password" data-i18n="auth.password">${t('auth.password')}</label>
            <input id="login-password" type="password" placeholder="••••••••" autocomplete="current-password" />
          </div>
          <button class="auth-submit-btn" id="auth-submit-login" data-label="${t('auth.login')}" data-i18n="auth.login">${t('auth.login')}</button>

          <div class="auth-divider"><span data-i18n="auth.or_social">${t('auth.or_social')}</span></div>

          <button class="oauth-btn oauth-google" id="oauth-google-login" type="button">
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            <span data-i18n="auth.use_google_login">${t('auth.use_google')}</span>
          </button>
          <button class="oauth-btn oauth-github" id="oauth-github-login" type="button">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#1f2937"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
            <span data-i18n="auth.use_github_login">${t('auth.use_github')}</span>
          </button>

          <p class="auth-switch" style="margin-top:4px;text-align:right">
            <button id="auth-forgot" data-i18n="auth.forgot_password" style="background:none;border:none;color:#6b7280;font-size:.8rem;cursor:pointer;padding:0">${t('auth.forgot_password')}</button>
          </p>
          <p class="auth-switch"><span data-i18n="auth.no_account">${t('auth.no_account')}</span><button id="auth-switch-register" data-i18n="auth.register_now">${t('auth.register_now')}</button></p>
        </div>

        <!-- 忘记密码面板 -->
        <div class="auth-panel" data-panel="forgot" style="display:none">
          <p style="color:#374151;margin-bottom:16px" data-i18n="auth.forgot_desc">${t('auth.enter_email')}</p>
          <div class="form-group">
            <label for="forgot-email" data-i18n="auth.email">${t('auth.email')}</label>
            <input id="forgot-email" type="email" placeholder="you@example.com" />
          </div>
          <button class="auth-submit-btn" id="auth-submit-forgot" data-label="${t('auth.submit_reset')}" data-i18n="auth.submit_reset">${t('auth.submit_reset')}</button>
          <p class="auth-switch"><button id="auth-switch-login2" data-i18n="auth.remember_password">${t('auth.remember_password')}</button></p>
        </div>

        <!-- 重置密码面板 -->
        <div class="auth-panel" data-panel="reset" style="display:none">
          <p style="color:#374151;margin-bottom:16px" data-i18n="auth.reset_desc">${t('auth.reset_desc')}</p>
          <input id="reset-token" type="hidden" />
          <div class="form-group">
            <label for="reset-new-password" data-i18n="auth.new_password">${t('auth.new_password')}</label>
            <input id="reset-new-password" type="password" placeholder="••••••••" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label for="reset-confirm" data-i18n="auth.confirm_password">${t('auth.confirm_password')}</label>
            <input id="reset-confirm" type="password" data-i18n-placeholder="auth.confirm_placeholder" placeholder="${t('auth.confirm_placeholder')}" autocomplete="new-password" />
          </div>
          <button class="auth-submit-btn" id="auth-submit-reset" data-label="${t('auth.submit_set_password')}" data-i18n="auth.submit_set_password">${t('auth.submit_set_password')}</button>
          <p class="auth-switch"><button id="auth-switch-login3" data-i18n="auth.back_to_login">${t('auth.back_to_login')}</button></p>
        </div>
      </div>
    `;
    document.body.appendChild(html);

    qs('#auth-switch-login')?.addEventListener('click', () => switchTab('login'));
    qs('#auth-switch-register')?.addEventListener('click', () => switchTab('register'));
    qs('#auth-forgot')?.addEventListener('click', () => switchTab('forgot'));
    qs('#auth-switch-login2')?.addEventListener('click', () => switchTab('login'));
    qs('#auth-switch-login3')?.addEventListener('click', () => switchTab('login'));
  }

  /* ─── 公开接口 ─── */
  function open(tab) { openModal(tab || 'register'); }
  function close() { closeModal(); }

  /* ─── 初始化 ─── */
  function init() {
    if (typeof document === 'undefined') return;
    injectStyles();
    injectHTML();
    mount();
    window.AuthModal = { open, close };

    // 检测 OAuth 登录成功信号
    try {
      const oauthSignal = localStorage.getItem('oauth_login_success');
      if (oauthSignal) {
        localStorage.removeItem('oauth_login_success');
      }
    } catch {}

    // 检测 URL 中的重置 token — 自动打开 reset 面板
    const urlParams = new URLSearchParams(location.search);
    const resetToken = urlParams.get('token');
    if (resetToken && urlParams.get('mode') === 'reset') {
      const hiddenToken = qs('#reset-token');
      if (hiddenToken) hiddenToken.value = resetToken;
      openModal('reset');
    }

    // 异步检查登录状态，更新页面按钮
    setTimeout(() => checkAuthStatus(), 300);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { open, close };
})();
