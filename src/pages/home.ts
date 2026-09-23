/**
 * BoardDuel 首页 · papergames 皮肤装配层
 * ---------------------------------------------------------------------------
 * 设计稿：design-reference/boardduel-homepage-papergames.html
 * CSS：   src/styles/home-papergames.css（body.home-v2 作用域，不影响游戏页）
 *
 * 页面上的四个动态件：
 *   1. 今日列表倒计时 —— UTC 午夜重置（与 MathDuel 首页同规则）
 *   2. 今日勾选进度   —— localStorage 记录当天点开了哪几张盘，真实进度，非假数据
 *   3. 排行榜       —— 真实 GET /api/leaderboard，拿不到就显示本站点暂无记录
 *   4. 抽屉 / 收窄导航
 */

const SHOW_BETA = import.meta.env.VITE_SHOW_BETA === '1';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

/* ── 阶段兜底：构建期已剔除 beta 元素，这里防 CDN 缓存住旧 HTML ───────── */
if (!SHOW_BETA) {
  document.querySelectorAll<HTMLElement>('[data-stage="beta"]').forEach((el) => el.remove());
}

/* ── 1. UTC 午夜倒计时 ──────────────────────────────────────────────── */
function utcMidnightKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(
    now.getUTCDate(),
  ).padStart(2, '0')}`;
}

function msUntilUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, next - now.getTime());
}

function paintCountdown(): void {
  const el = $('dailyCountdown');
  if (!el) return;
  const total = Math.floor(msUntilUtcMidnight(new Date()) / 1000);
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  el.textContent = `${hh}:${mm}:${ss}`;
}

/* ── 2. 今日勾选进度（真实：记录在 localStorage，按 UTC 日期归零） ──────── */
const DAILY_KEY = 'bd:daily';

function readDaily(): Record<string, string[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(DAILY_KEY) || '{}') as Record<string, string[]>;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeDaily(data: Record<string, string[]>): void {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(data));
  } catch {
    /* 隐私模式下写不进去，页面照样可用 */
  }
}

function paintDaily(): void {
  const tiles = Array.from(document.querySelectorAll<HTMLAnchorElement>('.dtile[data-daily]'));
  if (!tiles.length) return;
  const today = utcMidnightKey(new Date());
  const store = readDaily();
  const done = store[today] || [];

  tiles.forEach((tile) => {
    const id = tile.dataset.daily!;
    const isDone = done.includes(id);
    tile.classList.toggle('done', isDone);
    let ok = tile.querySelector('.ok');
    if (isDone && !ok) {
      ok = document.createElement('span');
      ok.className = 'ok';
      ok.textContent = '✓';
      tile.appendChild(ok);
    } else if (!isDone && ok) {
      ok.remove();
    }
    tile.addEventListener('click', () => markDone(id), { once: true });
  });

  const bar = $('dailyBar');
  const doneEl = $('dailyDone');
  const totalEl = $('dailyTotal');
  const msg = $('dailyMsg');
  if (bar) bar.style.width = `${Math.round((done.length / tiles.length) * 100)}%`;
  if (doneEl) doneEl.textContent = String(Math.min(done.length, tiles.length));
  if (totalEl) totalEl.textContent = String(tiles.length);
  if (msg) {
    msg.textContent =
      done.length === 0
        ? 'Play a board to tick it off today'
        : done.length >= tiles.length
          ? 'Every board ticked off today — nice'
          : `${done.length} of ${tiles.length} down, keep going`;
  }
}

function markDone(id: string): void {
  const today = utcMidnightKey(new Date());
  const store = readDaily();
  const done = store[today] || [];
  if (!done.includes(id)) done.push(id);
  store[today] = done;
  // 只留最近 7 天，避免无限增长
  for (const key of Object.keys(store)) {
    if (key < utcMidnightKey(new Date(Date.now() - 7 * 86400000))) delete store[key];
  }
  writeDaily(store);
}

/* ── 3. 排行榜（真实 API） ─────────────────────────────────────────── */
interface LbEntry {
  nickname?: string;
  score?: number;
  solved?: number;
  streak?: number;
}

async function loadLeaderboard(): Promise<void> {
  const rows = $('lbRows');
  const sub = $('lbSub');
  if (!rows) return;

  const empty = (text: string) => {
    if (sub) sub.textContent = text;
    rows.innerHTML = '';
  };

  try {
    const res = await fetch('/api/leaderboard', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { entries?: LbEntry[]; count?: number; me?: LbEntry | null };
    const list = Array.isArray(json.entries) ? json.entries.slice(0, 5) : [];

    if (!list.length) {
      empty('No ranked players yet — be the first one on the board.');
      return;
    }

    rows.innerHTML = list
      .map(
        (p, i) =>
          `<div class="wrow"><span class="rk">${i + 1}</span>` +
          `<span class="nm"></span>` +
          `<span class="pt">${Number(p.score ?? 0)}</span></div>`,
      )
      .join('');
    // 昵称用 textContent 写入，避免把用户可控字符串拼进 HTML
    rows.querySelectorAll<HTMLElement>('.nm').forEach((cell, i) => {
      cell.textContent = list[i]?.nickname || `Player ${i + 1}`;
    });

    if (sub) {
      sub.textContent = `${json.count ?? list.length} ranked ${json.count === 1 ? 'player' : 'players'} · score = puzzles solved, speed and streak`;
    }
  } catch {
    empty('Leaderboard is warming up — try refreshing in a moment.');
  }
}

/* ── 4. 抽屉与收窄 ─────────────────────────────────────────────────── */
function bindNav(): void {
  const burger = $<HTMLButtonElement>('burger');
  const overlay = $('overlay');
  const collapse = $<HTMLButtonElement>('collapse');

  const close = () => {
    document.body.classList.remove('nav-open');
    burger?.setAttribute('aria-expanded', 'false');
  };

  burger?.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    burger.setAttribute('aria-expanded', String(open));
  });
  overlay?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  collapse?.addEventListener('click', () => document.body.classList.toggle('rail'));
}

paintCountdown();
setInterval(paintCountdown, 1000);
paintDaily();
// 跨过 UTC 午夜时把勾选进度重画一次
setInterval(() => {
  paintDaily();
}, 60_000);
bindNav();
void loadLeaderboard();
