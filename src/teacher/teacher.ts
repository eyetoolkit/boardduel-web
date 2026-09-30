interface Board { code: string; link: string; game: string; }
interface Session { game: string; clock: string | null; boards: Board[]; }

const GAME_TITLE: Record<string, string> = {
  gomoku: 'Gomoku · 五子棋',
  connect4: 'Connect 4 · 四子棋',
  tictactoe: 'Tic-Tac-Toe · 井字棋',
  reversi: 'Othello · 黑白棋',
  chess: 'Chess · 国际象棋',
};
const LS_KEY = 'bd-teacher-session';
const MAX_BOARDS = 16;

/* ── 教师端实时进度（2026-09-30）──
   服务端：对局开始/终局由 GameRoom DO 把 {status, winner} 回写 KV room:<code>，
   本页每 5s 轮询 GET /api/gp/room/<code>?fresh=1（绕 worker 实例内存缓存）。
   隐私设计：胜方只存座位号（0/1/'draw'），投影默认只显示进度（✓），
   「Show winners」勾选后才显示 🏆P1/P2/🤝 —— 防攀比压力开关。 */
interface BoardMeta { status?: unknown; winner?: unknown }
const liveState = new Map<string, { status: string; winner: string | null }>();
const cellByCode = new Map<string, HTMLElement>();
let pollTimer: number | undefined;
let pollBusy = false;

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error('missing #' + id);
  return el;
}

function save(s: Session): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
function load(): Session | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (s && Array.isArray(s.boards)) return s;
  } catch { /* ignore */ }
  return null;
}

async function mintCode(game: string, clock: string | null): Promise<string> {
  const u = new URL('/api/gp/room', location.origin);
  u.searchParams.set('game', game);
  u.searchParams.set('name', 'Class');
  if (clock) u.searchParams.set('clock', clock);
  const r = await fetch(u.toString(), { method: 'POST' });
  if (!r.ok) throw new Error('http_' + r.status);
  const j = (await r.json()) as { code?: string };
  if (!j.code) throw new Error('no_code');
  return j.code;
}

function renderBoards(s: Session): void {
  const wrap = $('boards');
  wrap.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'boards-head';
  const g = document.createElement('span');
  g.className = 'bh-game';
  g.textContent = GAME_TITLE[s.game] ?? s.game;
  const c = document.createElement('span');
  c.className = 'bh-count';
  c.textContent = s.boards.length + ' boards';
  head.appendChild(g);
  head.appendChild(c);
  wrap.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'bgrid';
  s.boards.forEach((b, i) => {
    const card = document.createElement('div');
    card.className = 'bcard';
    const num = document.createElement('div');
    num.className = 'bnum';
    num.textContent = '#' + (i + 1);
    const code = document.createElement('div');
    code.className = 'bcode';
    code.textContent = b.code;
    const link = document.createElement('div');
    link.className = 'blink';
    link.textContent = b.link;
    const row = document.createElement('div');
    row.className = 'bacts';
    const c1 = document.createElement('button');
    c1.className = 'copy';
    c1.type = 'button';
    c1.textContent = 'Copy link';
    c1.addEventListener('click', () => void copy(b.link));
    const c2 = document.createElement('button');
    c2.className = 'copy';
    c2.type = 'button';
    c2.textContent = 'Copy code';
    c2.addEventListener('click', () => void copy(b.code));
    row.appendChild(c1);
    row.appendChild(c2);
    card.appendChild(num);
    card.appendChild(code);
    card.appendChild(link);
    card.appendChild(row);
    grid.appendChild(card);
  });
  wrap.appendChild(grid);
}

function renderProjector(s: Session | null): void {
  const gridEl = $('projGrid');
  const empty = $('projEmpty');
  const title = $('projTitle');
  gridEl.innerHTML = '';
  cellByCode.clear();
  if (!s || s.boards.length === 0) {
    empty.style.display = '';
    gridEl.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  gridEl.style.display = 'grid';
  title.textContent = `Classroom board · ${GAME_TITLE[s.game] ?? s.game} · ${s.boards.length} boards`;
  s.boards.forEach((b, i) => {
    const cell = document.createElement('div');
    cell.className = 'pcell';
    const n = document.createElement('div');
    n.className = 'pnum';
    n.textContent = '#' + (i + 1);
    const stat = document.createElement('div');
    stat.className = 'pstat';
    stat.textContent = '○';
    const c = document.createElement('div');
    c.className = 'pcode';
    c.textContent = b.code;
    const l = document.createElement('div');
    l.className = 'plink';
    l.textContent = b.link;
    cell.appendChild(n);
    cell.appendChild(stat);
    cell.appendChild(c);
    cell.appendChild(l);
    gridEl.appendChild(cell);
    cellByCode.set(b.code, cell);
  });
  renderLive();
}

/* 状态角标（语言中立符号）：○ 等待 · ▶ 对局中 · ✓ 结束 · 🏆P1/P2/🤝 胜方(仅勾选后) · ✕ 房间过期 */
function chipText(b: Board): string {
  const st = liveState.get(b.code);
  if (!st) return '○';
  if (st.status === 'playing') return '▶';
  if (st.status === 'finished') {
    if (($('showResults') as HTMLInputElement).checked) {
      if (st.winner === '0') return '🏆 P1';
      if (st.winner === '1') return '🏆 P2';
      return '🤝';
    }
    return '✓';
  }
  if (st.status === 'expired') return '✕';
  return '○';
}

function renderLive(): void {
  const s = load();
  if (!s || s.boards.length === 0) return;
  let done = 0;
  s.boards.forEach((b) => {
    const cell = cellByCode.get(b.code);
    const st = liveState.get(b.code);
    if (cell) {
      const chip = cell.querySelector<HTMLElement>('.pstat');
      if (chip) chip.textContent = chipText(b);
    }
    if (st && st.status === 'finished') done++;
  });
  ($('projProgress') as HTMLElement).textContent = `✓ ${done}/${s.boards.length}`;
}

async function pollLive(): Promise<void> {
  if (pollBusy) return;
  const s = load();
  if (!s || s.boards.length === 0) return;
  const view = document.getElementById('viewBoard');
  if (!view || view.style.display === 'none') return; // 仅投影 tab 可见时轮询
  pollBusy = true;
  try {
    await Promise.all(s.boards.map(async (b) => {
      try {
        const r = await fetch(`/api/gp/room/${b.code}?fresh=1`);
        if (r.status === 404) { liveState.set(b.code, { status: 'expired', winner: null }); return; }
        if (!r.ok) return; // 429/5xx：保留上次状态
        const m = (await r.json()) as BoardMeta;
        const w = m.winner;
        liveState.set(b.code, {
          status: typeof m.status === 'string' ? m.status : 'waiting',
          winner: w === 0 || w === 1 || w === 'draw' ? String(w) : null,
        });
      } catch { /* 网络抖动：保留上次状态 */ }
    }));
  } finally {
    pollBusy = false;
  }
  renderLive();
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('Copied');
    } catch {
      toast('Copy failed');
    }
    document.body.removeChild(ta);
  }
}

let toastTimer: number | undefined;
function toast(msg: string): void {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 1800);
}

/* ─── CSV export (P1-2 教师复访触发器) ───
 * 列：board_index, room_code, join_url, status, winner_seat, ts
 * 胜方只存座位号（0/1/draw），不含真实姓名；隐私设计见 data-retention.md
 */
function exportCsv(): void {
  const s = load();
  if (!s || s.boards.length === 0) {
    toast('No boards to export');
    return;
  }
  const rows: string[][] = [
    ['board_index', 'room_code', 'game', 'join_url', 'status', 'winner_seat', 'exported_at_iso'],
  ];
  const nowIso = new Date().toISOString();
  s.boards.forEach((b, i) => {
    const st = liveState.get(b.code);
    const status = st ? String(st.status) : 'unknown';
    const winner = st && st.winner != null ? String(st.winner) : '';
    rows.push([String(i + 1), b.code, b.game || s.game, b.link, status, winner, nowIso]);
  });
  const csv = rows.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `boardduel-${s.game}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('📊 CSV exported');
}

function setTab(name: string): void {
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('on', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const views: Record<string, string> = { session: 'viewSession', board: 'viewBoard', guide: 'viewGuide' };
  Object.keys(views).forEach((v) => {
    const el = document.getElementById(views[v]);
    if (el) el.style.display = v === name ? '' : 'none';
  });
}

async function buildSession(): Promise<void> {
  const gameSel = $('fGame') as HTMLSelectElement;
  const countEl = $('fCount') as HTMLInputElement;
  const clockSel = $('fClock') as HTMLSelectElement;
  const game = gameSel.value;
  const count = Math.max(1, Math.min(MAX_BOARDS, parseInt(countEl.value, 10) || 8));
  const clock = clockSel.value || null;
  const hint = $('genHint');
  hint.textContent = 'Minting…';
  const boards: Board[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const code = await mintCode(game, clock);
      boards.push({ code, game, link: `${location.origin}/games/${game}/?c=${code}` });
      await new Promise((r) => setTimeout(r, 120)); // respect RL_LIMIT_GP = 20 / window
    }
    const sess: Session = { game, clock, boards };
    liveState.clear();
    save(sess);
    renderBoards(sess);
    renderProjector(sess);
    hint.textContent = `✓ ${boards.length} boards ready`;
    toast('Session ready — share the links or open Projector.');
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed';
    hint.textContent = '⚠ ' + msg;
    toast('Could not mint all codes. Try fewer boards or wait a moment.');
  }
}

function init(): void {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
    b.addEventListener('click', () => setTab(b.dataset.tab || 'session'));
  });
  $('genBtn').addEventListener('click', () => void buildSession());
  $('copyAllBtn').addEventListener('click', async () => {
    const s = load();
    if (!s || s.boards.length === 0) {
      toast('No links yet');
      return;
    }
    await copy(s.boards.map((b) => b.link).join('\n'));
  });
  // CSV 导出（房间状态 + 胜方座位号）—— 教师复访触发器
  $('exportCsvBtn').addEventListener('click', () => exportCsv());
  const saved = load();
  if (saved && saved.boards.length) {
    renderBoards(saved);
    renderProjector(saved);
    ($('genHint') as HTMLElement).textContent = `Restored ${saved.boards.length} boards from last session`;
  }
  // 隐私开关：勾选才显示胜方；切换即时重绘角标
  $('showResults').addEventListener('change', () => renderLive());
  // 每 5s 轮询盘位进度（仅投影 tab 可见时真正发请求）
  pollTimer = window.setInterval(() => void pollLive(), 5000);
  void pollLive();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
