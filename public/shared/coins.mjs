/* fe-shared/shared/coins.mjs — 三站统一金币经济 SDK（#5 共享化，2026-10-22）
 * ─────────────────────────────────────────────────────────────
 * 抽自 mathduel-web/src/shared/coins.ts（TS 版仍由 mathduel Vite import），
 * 转成原生 ESM：纯 fetch、零 UI 字符串、浏览器可 <script type="module"> 直载，
 * 让 boardduel / memoryduel 的静态首页与 TS 入口共用同一份契约，不各写各的。
 *
 * 红线（设计文档 §0，与 mathduel coins.ts 一致）：
 *   - 服务端（tri-sites worker /api/coins/*、/api/membership/*）是单一真相源，
 *     本 SDK 只读 + 触发已有写端点，绝不在本地写余额
 *   - 不新增任何服务端端点（P0 边界）
 *   - 所有文案由调用方走 i18n，本文件零 UI 字符串（JS 注释除外）
 *
 * 端点契约来源：worker/src/membership/index.js（跨站共享路由，三站均可命中）
 *   GET  /api/coins/me           → 余额 + 今日已赚 + 日上限 + ad_free + streaks + daily
 *   POST /api/coins/checkin      → 每日签到 +10（连签 7 天 +50）
 *   GET  /api/membership/quests  → 每日任务列表 + 进度 + 可领奖励
 *   POST /api/membership/quests/claim → 领取任务奖励（过统一日上限）
 *   GET  /api/coins/history      → 最近收支流水（最多 200 条）
 *
 * 维护流程：fe-shared 改 → 三仓 `npm run sync:shared` 拉 raw → 各仓 CI
 * `sync:shared:check` 验证逐字节一致。直接改某站 public/shared/coins.mjs
 * 会被 sync 覆盖、CI check 拦截（同 identity.js/site-header.js 的漂移门禁）。
 */

/**
 * SDK 层统一错误。code 取值：
 *   'not_authenticated'  — 匿名（401 / authenticated:false）
 *   'already_checked_in' — 当日已签到（400 already_checked_in）
 *   'network'            — 网络/服务不可达（fetch 抛错或 5xx）
 *   'bad_response'       — 2xx 但 JSON 形状不符（防御性）
 *   'http_<status>'      — 其它 HTTP 错误（含 400 参数类）
 */
export class CoinsError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'CoinsError';
    this.code = code;
    this.status = status;
  }
}

/* ─── 内部：带 credentials 的 fetch + JSON 解析 + 统一错误归一 ─── */

async function apiFetch(path, init) {
  let res;
  try {
    res = await fetch(path, {
      method: (init && init.method) || 'GET',
      credentials: 'include',
      headers: init && init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init && init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    // fetch 抛错（网络断开 / CORS / 离线）
    throw new CoinsError('network', 'coin service unreachable');
  }

  // 401 / 400 需读 body 才能区分「匿名」与「已签到」等业务错误
  let data = {};
  try {
    data = await res.json();
  } catch {
    // 非 JSON 响应（如 404 HTML）
    if (res.status === 404) throw new CoinsError('network', 'endpoint not found', 404);
  }

  if (!res.ok) {
    const err = String((data && data.error) || '');
    if (res.status === 401 || err === 'not_logged_in') {
      throw new CoinsError('not_authenticated', err || 'not_logged_in', 401);
    }
    if (err === 'already_checked_in') {
      throw new CoinsError('already_checked_in', err, 400);
    }
    throw new CoinsError(`http_${res.status}`, err || `http ${res.status}`, res.status);
  }

  return data;
}

/* ─── 公共 API（读 + 触发已有写端点，不写本地余额） ─── */

/**
 * 查余额 + 今日状态 + 连签。匿名返回 `{ authenticated:false }`（服务端 200，非 401），
 * 因此本函数**不抛 not_authenticated**，由调用方按 `authenticated` 分支渲染。
 * 登录态却缺 coins（理论上不会发生）→ 按匿名降级，避免面板崩。
 */
export async function coinsMe() {
  const out = await apiFetch('/api/coins/me');
  if (out && out.authenticated === false) return { authenticated: false };
  if (!out || typeof out.coins !== 'number') return { authenticated: false };
  return out;
}

/**
 * 每日签到。返回签到结果（含本次所得 + 新余额 + 连签天数）。
 * 已签到 → 抛 CoinsError('already_checked_in')；匿名 → 抛 'not_authenticated'。
 */
export async function checkin() {
  return apiFetch('/api/coins/checkin', { method: 'POST', body: {} });
}

/** 取每日任务列表 + 进度。匿名抛 'not_authenticated'。 */
export async function getQuests() {
  return apiFetch('/api/membership/quests');
}

/**
 * 领取任务奖励。`questIds` 传全部「可领」任务 id 即批量领。
 * 部分成功时返回 claimed/skipped 明细，调用方按 coins_earned 提示。
 */
export async function claimQuests(questIds) {
  if (!Array.isArray(questIds) || questIds.length === 0) {
    throw new CoinsError('bad_response', 'quest_ids_required');
  }
  return apiFetch('/api/membership/quests/claim', {
    method: 'POST',
    body: { quest_ids: questIds },
  });
}

/** 取最近收支流水（服务端最多保留 200 条）。`limit` 默认 20。 */
export async function getHistory(limit = 20) {
  return apiFetch(`/api/coins/history?limit=${limit}&page=1`);
}

/* ─── 任务文案键映射（UI 层用） ───
 * 服务端 DAILY_QUESTS 的 id 是固定集合。每个 id 对应一个 i18n 键
 * `coins.quest_<id>`，六语字典已建好。调用方渲染任务标题时查这张表，
 * 不要直接显示服务端的中文 title（会破坏六语一致性 —— 红线 §0）。 */
export const QUEST_KEY_MAP = {
  play_3: 'coins.quest_play_3',
  win_1: 'coins.quest_win_1',
  daily_challenge: 'coins.quest_daily_challenge',
  streak_3: 'coins.quest_streak_3',
  checkin: 'coins.quest_checkin',
};
