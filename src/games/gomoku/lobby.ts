/**
 * BoardDuel · Gomoku 模式选择页（/games/gomoku/lobby/）
 * ------------------------------------------------------------
 * 这一页只是「入口层」，不含任何对局逻辑：
 *   · 六张模式卡是纯 `<a href="/games/gomoku/?mode=…">`，JS 关掉也能用，
 *     也便于抓取与分享（与 24 点模式页同一套做法）；
 *   · JS 只做两件小事 —— 侧栏拉真实的站内榜单与账号状态、邀请码校验后跳转。
 * 具体对局（引擎、联机、棋钟、复盘）全部留在 /games/gomoku/ 的 index.ts + engine.ts。
 */

import { wireLobbyChrome } from '../../lobby-chrome';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const GAME_URL = '/games/gomoku/';
/** worker 的房间码：5–8 位字母数字（见 boardduel /b/<game>/<CODE> 路由与 MatchQueue CODE_LEN） */
const INVITE_RE = /^[A-Za-z0-9]{5,8}$/;

const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

/* ===================== 侧栏 · 真实榜单 + 账号状态 ===================== */

function statRow(label: string, value: string): string {
  return `<div class="bd-stat-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
}

async function renderSide(): Promise<void> {
  const host = $('rankRows');
  if (!host) return;

  let lb: Record<string, unknown> | null = null;
  let me: Record<string, unknown> | null = null;
  try {
    // 并行两拉：榜单游客可见，账号状态用于判断是否已有归属
    const [lbRes, meRes] = await Promise.all([
      fetch('/api/leaderboard?limit=3', { credentials: 'include' }),
      fetch('/api/account/me', { credentials: 'include' }),
    ]);
    if (lbRes.ok) lb = (await lbRes.json()) as Record<string, unknown>;
    if (meRes.ok) me = (await meRes.json()) as Record<string, unknown>;
  } catch {
    host.innerHTML = '<div class="bd-side-note">Standings need a live connection.</div>';
    return;
  }

  const entries = lb && Array.isArray(lb.entries) ? (lb.entries as Record<string, unknown>[]) : [];
  const mine = lb && lb.me && typeof lb.me === 'object' ? (lb.me as Record<string, unknown>) : null;
  const loggedIn = !!(me && me.loggedIn);
  let html = '';

  if (mine && (mine.rank || mine.score != null)) {
    html += statRow('You', `#${Number(mine.rank) || '—'} · ${Number(mine.score) || 0} pts`);
  }
  if (entries.length) {
    html += entries
      .map((e, i) => statRow(`#${i + 1} ${String(e.nickname || 'Player')}`, `${Number(e.score) || 0} pts`))
      .join('');
  } else {
    html += '<div class="bd-side-note">No ranked results yet — the first win goes straight to the top.</div>';
  }
  if (!loggedIn) {
    html +=
      '<div class="bd-side-note">Playing as a guest is fine. Sign in from the board if you want your rating kept.</div>';
  } else if (me && me.nickname) {
    html += statRow('Session', String(me.nickname));
  }
  host.innerHTML = html;
}

/* ===================== 邀请码 ===================== */

function initInvite(): void {
  const input = $<HTMLInputElement>('codeInput');
  const err = $('codeErr');
  const say = (m: string) => {
    if (err) err.textContent = m;
  };

  // 本页若被 ?c= / ?room= 分享进来，直接转成游戏页深链，别让玩家多点一次
  const q = new URLSearchParams(location.search);
  const fromUrl = (q.get('c') || q.get('room') || '').trim();
  if (fromUrl && INVITE_RE.test(fromUrl)) {
    location.replace(`${GAME_URL}?c=${encodeURIComponent(fromUrl.toUpperCase())}`);
    return;
  }

  const go = () => {
    const code = (input?.value || '').trim().toUpperCase();
    if (!INVITE_RE.test(code)) {
      say('Enter the 5–8 character code from the invite.');
      input?.focus();
      return;
    }
    location.href = `${GAME_URL}?c=${encodeURIComponent(code)}`;
  };

  if (input) {
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      say('');
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
  }
  $('codeJoin')?.addEventListener('click', go);
}

/* ===================== 启动 ===================== */

function boot(): void {
  wireLobbyChrome();
  initInvite();
  void renderSide();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
