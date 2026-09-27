/**
 * BoardDuel · Tic-Tac-Toe 模式选择页（/games/tictactoe/lobby/）
 * ------------------------------------------------------------
 * 完全镜像 MathDuel 24-game lobby / gomoku lobby 的 JS 行为：
 *   · 5 张可点模式卡 + 1 张 SOON 灰态，全部用纯 `<a href="?mode=...">`，
 *     JS 关掉也能用，方便抓取与分享；
 *   · JS 只做两件小事 —— 侧栏拉真实 /api/leaderboard、邀请码校验后跳转；
 *   · wireLobbyChrome 处理 sidebar 缩放、顶部 chip 抽屉等通用 chrome。
 * 与 gomoku 的差异：tictactoe 只支持 `ai` 和 `pass` 两种 mode，所以
 * 5 张可点卡的 href 大部分回落到 `?mode=ai` 或 `?mode=pass`。
 */

import { wireLobbyChrome } from '../../lobby-chrome';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const GAME_URL = '/games/tictactoe/';
/** worker 的房间码：6 位字母数字（gomoku v5 同款；worker /b/<game>/<CODE> 路由） */
const INVITE_RE = /^[A-Za-z0-9]{6}$/;

const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

/* ===================== 侧栏 · 真实榜单 ===================== */

function statRow(rank: string, label: string, pt: string, me = false): string {
  return `<div class="rank-row${me ? ' me' : ''}"><span class="rank">${esc(rank)}</span><span class="nm">${esc(label)}</span><span class="pt num">${esc(pt)}</span></div>`;
}

async function renderSide(): Promise<void> {
  const host = $('rankRows');
  if (!host) return;

  let lb: Record<string, unknown> | null = null;
  let me: Record<string, unknown> | null = null;
  try {
    const [lbRes, meRes] = await Promise.all([
      fetch('/api/leaderboard?limit=3', { credentials: 'include' }),
      fetch('/api/account/me', { credentials: 'include' }),
    ]);
    if (lbRes.ok) lb = (await lbRes.json()) as Record<string, unknown>;
    if (meRes.ok) me = (await meRes.json()) as Record<string, unknown>;
  } catch {
    host.innerHTML = '<div class="rank-empty">The global ladder needs a live connection.</div>';
    return;
  }

  const entries = lb && Array.isArray(lb.entries) ? (lb.entries as Record<string, unknown>[]) : [];
  const mine = lb && lb.me && typeof lb.me === 'object' ? (lb.me as Record<string, unknown>) : null;
  const loggedIn = !!(me && me.loggedIn);
  let html = '';

  if (entries.length) {
    html += entries
      .map((e, i) => statRow(String(i + 1), String(e.nickname || 'Player'), `${Number(e.score) || 0} pts`))
      .join('');
  } else {
    html += '<div class="rank-empty">Nobody has finished a rated game yet — take the first spot.</div>';
  }

  if (mine && (mine.rank || mine.score != null)) {
    html += statRow('you', 'You', `${Number(mine.score) || 0} pts`, true);
  } else if (loggedIn) {
    html += statRow('You', 'You', '0 pts', true);
  }
  host.innerHTML = html;
}

/* ===================== 邀请码 ===================== */

function initInvite(): void {
  const input = $<HTMLInputElement>('roomInput');
  const err = $('roomErr');
  const say = (m: string) => {
    if (err) err.textContent = m;
  };

  const q = new URLSearchParams(location.search);
  const fromUrl = (q.get('c') || q.get('room') || '').trim();
  if (fromUrl && INVITE_RE.test(fromUrl)) {
    location.replace(`${GAME_URL}?c=${encodeURIComponent(fromUrl.toUpperCase())}`);
    return;
  }

  const go = () => {
    const code = (input?.value || '').trim().toUpperCase();
    if (!INVITE_RE.test(code)) {
      say('Please enter the 6-character room code.');
      input?.focus();
      return;
    }
    say('');
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
  $('joinRoom')?.addEventListener('click', go);
}

/* ===================== 启动 ===================== */

function boot(): void {
  wireLobbyChrome();
  initInvite();
  void renderSide();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();