/**
 * BoardDuel · Xiangqi 模式选择页（/games/xiangqi/lobby/）
 * 完全镜像 chess/lobby.ts，仅 GAME_URL 改为 xiangqi。
 * 5 张可点模式卡全用 `<a href="?mode=...">`，JS 关掉也能用。
 */
import { wireLobbyChrome } from '../../lobby-chrome';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const GAME_URL = '/games/xiangqi/';
/** worker 的房间码：6 位字母数字 */
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
  const say = (m: string) => { if (err) err.textContent = m; };

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
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
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
