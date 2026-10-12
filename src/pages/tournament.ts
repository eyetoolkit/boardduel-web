/* ============================================================
 * BoardDuel · 每日锦标赛页逻辑（2026-10-12）
 * ------------------------------------------------------------
 * 数据全部来自真实接口，接口失败一律降级为可读提示，不写假数据：
 *   GET  /api/tournament/list   今日三棋种赛事 + 我的参赛进度
 *   POST /api/tournament/join   报名某棋种（pid 取自 HMAC 验签 cookie）
 *
 * 后端契约（worker/src/shared/tournament-do.js handleStatus）：
 *   { date, games: [{ game, title, status, players:[{idx,name,isAI}],
 *                    joined, maxParticipants, bracket, rankings,
 *                    startAt, endAt, me:{joined,idx,round,matchId,
 *                    roomCode,actionable}|null }] }
 *   match：R1 带 p1Idx/p2Idx；后续轮带 fromMatches[2]，靠上一轮 winnerIdx 递推。
 * ============================================================ */

interface TPlayer {
  idx: number;
  name?: string;
  isAI?: boolean;
}
interface TMatch {
  id: string;
  status?: string;
  roomCode?: string | null;
  winnerIdx?: number | 'draw' | null;
  p1Idx?: number;
  p2Idx?: number;
  fromMatches?: string[];
}
interface TRank {
  rank?: number;
  name?: string;
  isAI?: boolean;
}
interface TMe {
  joined?: boolean;
  idx?: number;
  round?: number;
  matchId?: string | null;
  roomCode?: string | null;
  actionable?: boolean;
}
interface TGame {
  game: string;
  title?: string;
  status?: string;
  players?: TPlayer[];
  joined?: number;
  maxParticipants?: number;
  bracket?: TMatch[][];
  rankings?: TRank[];
  startAt?: number;
  me?: TMe | null;
}

/* ── i18n（/i18n/i18n.js 在 <head> 同步加载，window.t 必然存在） ── */
type TFn = (key: string, vars?: Record<string, string | number>) => string;
const t: TFn =
  (window as unknown as { t: TFn }).t || ((k: string) => k);

/* ── 工具 ── */
const qs = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[c] ?? c;
  });

async function api(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(path, Object.assign({ credentials: 'include' }, init));
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const e = new Error(String(body.error || 'HTTP ' + res.status));
    (e as Error & { code?: string }).code = String(body.error || '');
    throw e;
  }
  return body;
}

/* ── 错误码 → 文案 ── */
const ERR_KEY: Record<string, string> = {
  no_identity: 'tournament.err_no_identity',
  already_joined: 'tournament.err_already_joined',
  full: 'tournament.err_full',
  rate_limited: 'tournament.err_rate_limited',
  bad_json: 'tournament.err_bad_json',
};

const STATUS_KEY: Record<string, string> = {
  registration: 'tournament.st_registration',
  running: 'tournament.st_running',
  finished: 'tournament.st_finished',
  cancelled: 'tournament.st_cancelled',
  error: 'tournament.st_error',
};

const ROUND_KEY = ['tournament.round_qf', 'tournament.round_sf', 'tournament.round_f'];

/* ══════════════════ bracket 解析 ══════════════════ */

/**
 * 解出某场比赛双方的 participants 索引。
 * R1 直接读 p1Idx/p2Idx；后续轮沿 fromMatches 回上一轮取 winnerIdx。
 * 上一轮未分胜负或平局 → -1，渲染成 TBD。
 */
function resolveSides(match: TMatch, cache: Map<string, TMatch>): [number, number] {
  if (typeof match.p1Idx === 'number' && typeof match.p2Idx === 'number') {
    return [match.p1Idx, match.p2Idx];
  }
  const from = match.fromMatches;
  if (!from || from.length < 2) return [-1, -1];
  // fromMatches 顺序 = [胜者A, 胜者B]，与 p1/p2 位一一对应
  return [winnerOf(from[0], cache), winnerOf(from[1], cache)];
}

function winnerOf(id: string, cache: Map<string, TMatch>): number {
  const m = cache.get(id);
  if (!m) return -1;
  return typeof m.winnerIdx === 'number' && Number.isFinite(m.winnerIdx) ? m.winnerIdx : -1;
}

/** 把嵌套 bracket 拍平成 id → match 索引表，递归解析时要用 */
function indexBracket(rounds: TMatch[][]): Map<string, TMatch> {
  const map = new Map<string, TMatch>();
  for (const r of rounds || []) for (const m of r || []) if (m && m.id) map.set(m.id, m);
  return map;
}

/** 某场比赛是否已分出胜负（平局不算） */
function decided(m: TMatch): boolean {
  return typeof m.winnerIdx === 'number' && Number.isFinite(m.winnerIdx);
}

/* ══════════════════ 渲染 ══════════════════ */

let selected: string | null = null;
let latest: TGame[] = [];
let polling = 0;
let ticker = 0;

function gameLabel(g: TGame): string {
  return g.title || g.game;
}

function statusPill(g: TGame): string {
  const key = STATUS_KEY[g.status || ''] || 'tournament.st_error';
  return '<span class="tn-pill tn-' + esc(g.status || 'error') + '">' + esc(t(key)) + '</span>';
}

/* ── 我的赛事横幅 ── */
function renderMine(): void {
  const box = qs('#tn-mine');
  if (!box) return;
  const mine = latest.filter((g) => g.me && g.me.joined);
  if (!mine.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  box.innerHTML = mine
    .map((g) => {
      const me = g.me as TMe;
      const actionable = !!me.actionable && !!me.roomCode;
      // me.round = -1 表示已出局/已夺冠；>= 0 表示有一场在等我（房没开就是 waiting）
      const state = actionable
        ? t('tournament.your_turn')
        : typeof me.round === 'number' && me.round >= 0
          ? t('tournament.waiting')
          : t('tournament.eliminated');
      // 报名中：跟官方倒计时（tick() 里每秒刷新 .tn-mine-cd，见文件末尾）
      const cd = !actionable && g.status === 'registration' && g.startAt
        ? '<span class="tn-mine-cd" data-cd="' + esc(g.startAt) + '"></span>'
        : '';
      const cta = actionable
        ? '<a class="pp-cta" href="/b/' + esc(g.game) + '/' + esc(me.roomCode) + '">' + esc(t('tournament.enter_match')) + '</a>'
        : '<a class="pp-cta ghost" href="/rank/">' + esc(t('tournament.cta_rank')) + '</a>';
      return (
        '<div class="pos">' +
        esc(t('tournament.my_event')) + ' · ' + esc(gameLabel(g)) + '</div>' +
        '<div class="det">' + esc(state) + cd + '</div>' +
        '<div class="tn-mine-cta">' + cta + '</div>'
      );
    })
    .join('');
}

/* ══════════════════ 开赛提醒（2026-10-12） ══════════════════
 * 场景：用户报名后离开/忘了，到点房间开好也不知道 → 90 分钟超时判平局，
 * 整条对阵路径作废（ Tournament DO 的兜底逻辑）。本站无推送基础设施，
 * 所以做两级提醒：
 *   ① 页面内模态 —— 轮询发现「轮到我」的 false→true 跳变时弹出
 *      （15s 轮询 + visibilitychange 补拉，前台停留时可靠）
 *   ② 系统 Notification —— 报名成功时（用户手势内）请求权限，
 *      之后跳变时若已授权则顺带发一条（用户切到其他标签页也能看到）
 * 都不授权也不弹 → 至少还有「我的赛事」卡片的倒计时与状态文案。 */

/** 已提醒过的 game（false→true 跳变去重；actionable 消失时移除以便下轮再提醒） */
const notified = new Set<string>();

/** 报名成功后请求通知权限（必须在用户手势的调用栈里，否则浏览器直接拒） */
function askNotifyPermission(): void {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') void Notification.requestPermission();
  } catch (e) { /* 老浏览器无 requestPermission 返回值，忽略 */ }
}

function fireNotification(g: TGame): void {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    new Notification(t('tournament.notify_title'), {
      body: t('tournament.notify_body', { game: gameLabel(g) }),
      tag: 'tn-' + g.game,       // 同赛事只保留一条，避免刷屏
    });
  } catch (e) { /* 权限被拒/不支持：静默 */ }
}

function showRemind(g: TGame): void {
  const modal = qs('#tn-remind');
  const go = qs<HTMLAnchorElement>('#tn-remind-go');
  if (!modal) return;
  if (go) go.href = '/b/' + esc(g.game) + '/' + esc((g.me as TMe).roomCode || '');
  modal.hidden = false;
  fireNotification(g);
}

function hideRemind(): void {
  const modal = qs('#tn-remind');
  if (modal) modal.hidden = true;
}

/** 每次 load 后调用：检测「轮到我」的跳变并提醒 */
function checkReminders(games: TGame[]): void {
  for (const g of games) {
    const me = g.me;
    const live = !!(me && me.joined && me.actionable && me.roomCode);
    if (live) {
      if (!notified.has(g.game)) {
        notified.add(g.game);
        showRemind(g);
      }
    } else if (notified.has(g.game)) {
      // 房间关了（打完/流局）：下轮再开房时允许重新提醒
      notified.delete(g.game);
    }
  }
}

/* ── 赛事卡 ── */
function renderEvents(): void {
  const box = qs('#tn-events');
  if (!box) return;
  if (!latest.length) {
    box.innerHTML = '<div class="pp-state">' + esc(t('tournament.no_events')) + '</div>';
    return;
  }
  box.innerHTML = latest
    .map((g) => {
      const joined = Number(g.joined ?? (g.players ? g.players.length : 0));
      const max = Number(g.maxParticipants ?? 8);
      const me = g.me && g.me.joined;
      const open = g.status === 'registration';
      const btn = me
        ? '<span class="tn-btn is-joined">' + esc(t('tournament.joined')) + '</span>'
        : open
          ? '<button class="tn-btn" data-join="' + esc(g.game) + '">' + esc(t('tournament.join')) + '</button>'
          : '<span class="tn-btn is-off">' + esc(t('tournament.closed')) + '</span>';
      const cd = open && g.startAt ? t('tournament.starts_in', { time: countdown(g.startAt) }) : '';
      return (
        '<button class="tn-event' + (selected === g.game ? ' is-sel' : '') + '" data-sel="' + esc(g.game) + '">' +
        '<span class="tn-event-top">' + statusPill(g) +
        '<span class="tn-seats">' + joined + ' / ' + max + '</span></span>' +
        '<span class="tn-event-name">' + esc(gameLabel(g)) + '</span>' +
        '<span class="tn-event-cd">' + esc(cd) + '</span>' +
        '<span class="tn-event-act">' + btn + '</span>' +
        '</button>'
      );
    })
    .join('');
}

/* ── bracket ── */
function renderBracket(): void {
  const box = qs('#tn-bracket');
  if (!box) return;
  const g = latest.find((x) => x.game === selected);
  if (!g) {
    box.innerHTML = '<div class="pp-state">' + esc(t('tournament.pick_event')) + '</div>';
    return;
  }
  const rounds = g.bracket || [];
  if (!rounds.length) {
    box.innerHTML = '<div class="pp-state">' + esc(t('tournament.no_bracket')) + '</div>';
    return;
  }
  const cache = indexBracket(rounds);
  const players = g.players || [];
  const nameOf = (i: number): string => {
    const p = players[i];
    if (!p) return t('tournament.tbd');
    return p.name || t('tournament.anonymous');
  };
  const myIdx = g.me && g.me.joined ? Number(g.me.idx) : -1;

  const cols = rounds
    .map((r, ri) => {
      const head = '<div class="tn-round-h">' + esc(t(ROUND_KEY[ri] || 'tournament.round_x', { n: ri + 1 })) + '</div>';
      const rows = (r || [])
        .map((m) => {
          const [a, b] = resolveSides(m, cache);
          const w = m.winnerIdx;
          const cell = (idx: number) => {
            if (idx < 0) return '<div class="tn-side is-tbd">' + esc(t('tournament.tbd')) + '</div>';
            const win = decided(m) && w === idx;
            const cls =
              'tn-side' + (win ? ' is-win' : '') + (idx === myIdx ? ' is-me' : '');
            return '<div class="' + cls + '">' + esc(nameOf(idx)) + '</div>';
          };
          const canPlay = g.me && g.me.matchId === m.id && g.me.actionable && m.roomCode;
          const act = canPlay
            ? '<a class="tn-play" href="/b/' + esc(g.game) + '/' + esc(m.roomCode as string) + '">' + esc(t('tournament.enter_match')) + '</a>'
            : '';
          return '<div class="tn-match">' + cell(a) + cell(b) + act + '</div>';
        })
        .join('');
      return '<div class="tn-round">' + head + rows + '</div>';
    })
    .join('');

  const ranks = (g.rankings || []).length
    ? '<div class="tn-ranks"><div class="tn-ranks-h">' + esc(t('tournament.final_h')) + '</div>' +
      (g.rankings || [])
        .map((r) => '<div class="tn-rank"><span>' + (r.rank === 1 ? '👑' : '#' + esc(r.rank)) + '</span>' + esc(r.name || '') + '</div>')
        .join('') +
      '</div>'
    : '';

  box.innerHTML = '<div class="tn-bracket-row">' + cols + '</div>' + ranks;
}

/* ── 倒计时 ── */
function countdown(startAt: number): string {
  const ms = startAt - Date.now();
  if (ms <= 0) return t('tournament.starts_now');
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return t('tournament.cd_days', { d, h: h % 24, m: m % 60 });
  if (h >= 1) return t('tournament.cd_hours', { h, m: m % 60 });
  return t('tournament.cd_mins', { m });
}

function tick(): void {
  renderEvents();
  // 「我的赛事」卡里的开赛倒计时每秒走字（只改文本，不重建 DOM，避免打断点击）
  document.querySelectorAll<HTMLElement>('.tn-mine-cd').forEach((el) => {
    const at = Number(el.getAttribute('data-cd') || '0');
    if (at > 0) el.textContent = ' · ' + t('tournament.starts_in', { time: countdown(at) });
  });
}

/* ══════════════════ 数据流 ══════════════════ */

async function load(): Promise<void> {
  const events = qs('#tn-events');
  try {
    const d = await api('/api/tournament/list');
    latest = (Array.isArray(d.games) ? d.games : []) as TGame[];
    renderMine();
    checkReminders(latest);
    renderEvents();
    renderBracket();
  } catch {
    latest = [];
    if (events) events.innerHTML = '<div class="pp-state">' + esc(t('tournament.error')) + '</div>';
    renderBracket();
  }
}

async function join(game: string): Promise<void> {
  try {
    await api('/api/tournament/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game }),
    });
    askNotifyPermission();   // 用户手势内请求，浏览器才会弹权限框
    await load();
  } catch (e) {
    const code = (e as Error & { code?: string }).code || '';
    const box = qs('#tn-events');
    if (box) {
      const prev = box.querySelector('.tn-flash');
      if (prev) prev.remove();
      const d = document.createElement('div');
      d.className = 'pp-state tn-flash';
      d.textContent = t(ERR_KEY[code] || 'tournament.err_generic');
      box.prepend(d);
    }
    await load();
  }
}

/* ══════════════════ 启动 ══════════════════ */

export function bootTournament(): void {
  const events = qs('#tn-events');

  events?.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    // 报名按钮优先于卡片选中，否则点按钮会同时触发选中
    const joinBtn = target.closest<HTMLElement>('[data-join]');
    if (joinBtn) {
      ev.preventDefault();
      const g = joinBtn.getAttribute('data-join') || '';
      if (g) void join(g);
      return;
    }
    const card = target.closest<HTMLElement>('[data-sel]');
    if (card) {
      selected = card.getAttribute('data-sel') || null;
      renderEvents();
      renderBracket();
    }
  });

  // 提醒模态： dismiss / 点进入比赛 后关闭；ESC 同效
  qs('#tn-remind-x')?.addEventListener('click', hideRemind);
  qs('#tn-remind-go')?.addEventListener('click', hideRemind);
  document.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Escape') hideRemind();
  });

  void load();

  // 自动刷新：页面隐藏时暂停，回到前台立刻补一次
  polling = window.setInterval(() => {
    if (document.visibilityState === 'visible') void load();
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void load();
  });

  ticker = window.setInterval(tick, 1000);

  window.addEventListener('pagehide', () => {
    window.clearInterval(polling);
    window.clearInterval(ticker);
  });
}