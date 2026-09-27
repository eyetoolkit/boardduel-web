/* ============================================================
 * BoardDuel · 内容页共用脚本（2026-09-28）
 * ------------------------------------------------------------
 * 供 /rank/ /stats/ /shop/ /how-to-play/ 引入：
 *   1. 接上站点 chrome（侧栏抽屉 / 桌面收起 / 主题切换）
 *   2. 按 <body data-page="…"> 分派各页的数据初始化
 * 数据全部走真实接口，任何接口失败都降级为可读提示，不写假数据。
 * ============================================================ */

import { wireLobbyChrome } from './lobby-chrome';

type Json = Record<string, unknown>;

const qs = <T extends HTMLElement>(sel: string): T | null =>
  document.querySelector<T>(sel);

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c] ?? c;
  });

async function api(path: string, init?: RequestInit): Promise<Json> {
  const res = await fetch(path, Object.assign({ credentials: 'include' }, init));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return (await res.json()) as Json;
}

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0);

/* ══════════════════ /rank/ 排行榜 ══════════════════ */

interface LbEntry {
  nickname?: string | null;
  score?: number;
  solved?: number;
  streak?: number;
  uuid?: string;
}
interface Tier {
  name?: string;
  color?: string;
  emoji?: string;
}

function nick(e: LbEntry): string {
  const n = String(e.nickname ?? '');
  return n || 'Anonymous';
}

async function loadBoard(limit = 100): Promise<void> {
  const list = qs('#pp-board');
  const me = qs('#pp-me');
  if (!list || !me) return;
  try {
    const d = await api('/api/leaderboard?limit=' + limit);
    const entries = (Array.isArray(d.entries) ? d.entries : []) as LbEntry[];
    const self = (d.me ?? null) as LbEntry | null;

    if (!entries.length) {
      list.innerHTML =
        '<div class="pp-state">No rankings yet — finish a match to get on the board.</div>';
    } else {
      list.innerHTML = entries
        .map(
          (e, i) =>
            '<div class="pp-row' +
            (self && self.uuid && e.uuid === self.uuid ? ' mine' : '') +
            '">' +
            '<div class="pos' +
            (i < 3 ? ' top' : '') +
            '">#' +
            (i + 1) +
            '</div>' +
            '<div class="name">' +
            esc(nick(e)) +
            '</div>' +
            '<div class="sub">' +
            num(e.solved) +
            ' games</div>' +
            '<div class="val">' +
            num(e.score) +
            '</div>' +
            '</div>'
        )
        .join('');
    }

    me.innerHTML = self
      ? '<div class="pos">Your rank #' +
        num((self as unknown as { rank?: number }).rank) +
        '</div><div class="det">' +
        num(self.score) +
        ' pts · ' +
        num(self.solved) +
        ' games · ' +
        num(self.streak) +
        ' win streak</div>'
      : '<div class="pos">Unranked</div><div class="det">Finish a match to appear on the leaderboard.</div>';
  } catch {
    list.innerHTML = '<div class="pp-state">Leaderboard is unavailable right now.</div>';
    me.innerHTML = '<div class="pos">Unranked</div><div class="det">Could not load your standing.</div>';
  }
}

function tierClass(name: string): string {
  const n = (name || '').toLowerCase();
  for (const k of ['bronze', 'silver', 'gold', 'plat', 'diamond', 'master']) {
    if (n.indexOf(k) === 0) return 't-' + k;
  }
  return '';
}

async function loadTiers(game: string): Promise<void> {
  const box = qs('#pp-tiers');
  if (!box) return;
  box.innerHTML = '<div class="pp-state">Loading…</div>';
  try {
    const d = await api(
      '/api/leaderboard/tiers?game=' + encodeURIComponent(game) + '&limit=50'
    );
    const raw = (d.list ?? d.entries ?? []) as unknown[];
    const list = raw as Array<{ nickname?: string | null; elo?: number; tier?: Tier }>;
    if (!list.length) {
      box.innerHTML =
        '<div class="pp-state">No rated players yet — the tier ladder fills up as matches are played.</div>';
      return;
    }
    box.innerHTML = list
      .map((e, i) => {
        const t = e.tier ?? {};
        const nm = String(t.name ?? '');
        const badge =
          '<span class="tier ' +
          tierClass(nm) +
          '">' +
          esc(t.emoji ?? '') +
          ' ' +
          esc(nm) +
          '</span>';
        return (
          '<div class="pp-row">' +
          '<div class="pos' +
          (i < 3 ? ' top' : '') +
          '">#' +
          (i + 1) +
          '</div>' +
          '<div class="name">' +
          esc(nick({ nickname: e.nickname })) +
          '</div>' +
          '<div class="sub">' +
          badge +
          '</div>' +
          '<div class="val">' +
          num(e.elo) +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  } catch {
    box.innerHTML = '<div class="pp-state">Tier ladder is unavailable right now.</div>';
  }
}

/* ══════════════════ /stats/ 我的战绩 ══════════════════ */

async function loadStats(): Promise<void> {
  const grid = qs('#pp-stats');
  if (!grid) return;

  let nickname = 'Player';
  let avatar = '';
  let coins = 0;
  let streak = 0;
  let solved = 0;
  let score = 0;
  let rank = 0;

  try {
    const me = await api('/api/account/me');
    const acc = (me.account ?? {}) as Record<string, unknown>;
    nickname = String(me.nickname ?? acc.nickname ?? '') || 'Player';
    avatar = String(me.avatar ?? acc.avatar ?? '');
    coins = num(me.coins ?? acc.coins ?? (me.wallet as Json | undefined)?.coins);
    streak = num(me.streak ?? acc.streak);
  } catch {
    /* 未登录也继续：排行榜里可能仍有本站记录 */
  }

  try {
    const d = await api('/api/leaderboard?limit=100');
    const self = (d.me ?? null) as
      | (LbEntry & { rank?: number })
      | null;
    if (self) {
      rank = num(self.rank);
      streak = streak || num(self.streak);
      solved = num(self.solved);
      score = num(self.score);
    }
  } catch {
    /* 忽略：下方按 0 渲染 */
  }

  const card = (k: string, v: string, cls = ''): string =>
    '<div class="pp-stat"><div class="k">' +
    k +
    '</div><div class="v ' +
    cls +
    '">' +
    v +
    '</div></div>';

  grid.innerHTML =
    card('Player', esc(nickname) + (avatar ? ' <span aria-hidden="true">' + esc(avatar) + '</span>' : '')) +
    card('Coins', String(coins), 'amber') +
    card('Win streak', String(streak), 'teal') +
    card('Global rank', rank ? '#' + rank : '—') +
    card('Games played', String(solved)) +
    card('Points', String(score));
}

/* ══════════════════ /shop/ 皮肤商店 ══════════════════ */

interface ShopItem {
  id: string;
  kind: string;
  icon: string;
  name: string;
  cost: number;
}

let coins = 0;

async function loadWallet(): Promise<void> {
  const box = qs('#pp-wallet');
  if (!box) return;
  try {
    const d = await api('/api/coins/me');
    coins = num(d.coins ?? d.balance ?? d.amount);
    box.innerHTML =
      '<span class="coin" aria-hidden="true">🪙</span>' +
      '<span class="amt">' +
      coins +
      '</span>' +
      '<span class="hint">Win a match to earn +10 coins</span>';
  } catch {
    box.innerHTML =
      '<span class="coin" aria-hidden="true">🪙</span>' +
      '<span class="amt">—</span>' +
      '<span class="hint">Sign in to see your coins</span>';
  }
}

async function loadShop(): Promise<void> {
  const box = qs('#pp-shop');
  if (!box) return;
  box.innerHTML = '<div class="pp-state">Loading…</div>';
  try {
    const d = await api('/api/shop/catalog');
    const items = (Array.isArray(d.catalog) ? d.catalog : []) as ShopItem[];
    if (!items.length) {
      box.innerHTML = '<div class="pp-state">No items in the shop yet.</div>';
      return;
    }
    box.innerHTML = items
      .map(
        (it) =>
          '<div class="pp-item">' +
          '<div class="icon" aria-hidden="true">' +
          esc(it.icon) +
          '</div>' +
          '<div class="nm">' +
          esc(it.name) +
          '</div>' +
          '<div class="cost">' +
          num(it.cost) +
          ' coins</div>' +
          '<button class="pp-buy" type="button" data-buy="' +
          esc(it.id) +
          '" data-cost="' +
          num(it.cost) +
          '"' +
          (coins < num(it.cost) ? ' disabled' : '') +
          '>' +
          (coins < num(it.cost) ? 'Need more coins' : 'Redeem') +
          '</button>' +
          '</div>'
      )
      .join('');
  } catch {
    box.innerHTML = '<div class="pp-state">Shop is unavailable right now.</div>';
  }
}

function wireShop(): void {
  document.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement | null;
    const btn = t && t.closest ? t.closest<HTMLButtonElement>('[data-buy]') : null;
    if (!btn) return;
    const id = btn.dataset.buy;
    if (!id) return;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '…';
    try {
      await api('/api/shop/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await loadWallet();
      await loadShop();
    } catch {
      btn.disabled = false;
      btn.textContent = old ?? 'Redeem';
    }
  });
}

/* ══════════════════ 分派 ══════════════════ */

function boot(): void {
  wireLobbyChrome();

  const page = document.body.dataset.page || '';

  if (page === 'rank') {
    void loadBoard();
    void loadTiers('all');
    const sel = qs<HTMLSelectElement>('#pp-tier-game');
    sel?.addEventListener('change', () => void loadTiers(sel.value));
  } else if (page === 'stats') {
    void loadStats();
  } else if (page === 'shop') {
    void loadWallet().then(loadShop);
    wireShop();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
