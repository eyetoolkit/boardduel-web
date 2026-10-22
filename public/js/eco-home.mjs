/* boardduel 首页经济卡：余额 + 每日签到（#5，2026-10-22）
 * ─────────────────────────────────────────────────────
 * 用 fe-shared public/shared/coins.mjs 拉 /api/coins/me + /api/coins/checkin，
 * 让 PvP 发币在首页可见（审计 P1-4：boardduel/memoryduel 发币但无钱包 UI，
 * 留存钩子失效）。浏览器 ESM 直载，契约单一真相源在 fe-shared。
 *
 * 文案走 i18n（扁平键 home_v2.eco_*，六语）；动态数值（余额/连签天数/签到态）由 JS 写。
 * 红线：服务端为余额真相源，本脚本只读 + 触发已有签到端点，不写本地余额；
 * 任何接口失败降级为「登录看余额」可读提示，不写假数据。 */
import { coinsMe, checkin, CoinsError } from '/shared/coins.mjs';

const $ = (id) => document.getElementById(id);

/* 静态回退文案（英文）。i18n.js 的 t(key, vars, lang, fallback) 第 4 参才是兜底，
   字典就绪时用 home_v2.eco_* 键，未就绪/缺失时用它保证任何情况都有可读文案。 */
const EN = {
  eco_checkin: 'Sign in +10',
  eco_signedin: 'Signed in ✓',
  eco_btn_disabled: 'Sign in',
  eco_sub_earn: 'Earn coins every match. Sign in to see your balance.',
  eco_sub_daily: 'Sign in daily for +10, 7-day streak for +50.',
  eco_sub_ok: 'Signed in — +10 coins.',
  eco_sub_streak: '{n}-day streak — +50 bonus!',
  eco_sub_anon: 'Sign in to see your coins.',
};

function ecoT(key, n) {
  let v;
  try {
    if (typeof window.t === 'function') {
      v = window.t('home_v2.' + key, n !== undefined ? { n } : undefined, undefined, EN[key]);
    }
  } catch { /* i18n 未初始化，走兜底 */ }
  if (typeof v === 'string' && v && v.indexOf('home_v2.') !== 0) return v;
  return String(EN[key] ?? key).replace('{n}', String(n === undefined ? '' : n));
}

async function paintBalance() {
  const num = $('ecoNum');
  const sub = $('ecoSub');
  const btn = $('ecoCheckin');
  if (!num) return;

  let me;
  try {
    me = await coinsMe();
  } catch {
    num.textContent = '—';
    if (sub) sub.textContent = ecoT('eco_sub_anon');
    if (btn) { btn.disabled = true; btn.textContent = ecoT('eco_btn_disabled'); }
    return;
  }
  if (!me || me.authenticated === false || typeof me.coins !== 'number') {
    num.textContent = '—';
    if (sub) sub.textContent = ecoT('eco_sub_anon');
    if (btn) { btn.disabled = true; btn.textContent = ecoT('eco_btn_disabled'); }
    return;
  }
  num.textContent = String(me.coins);
  const streak = me.streaks ? (Number(me.streaks.login_streak) || 0) : 0;
  const lastDate = me.streaks ? me.streaks.last_checkin_date : null;
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const checkedToday = lastDate === ymd;
  if (sub) {
    sub.textContent = checkedToday
      ? (streak > 1 ? ecoT('eco_sub_streak', streak) : ecoT('eco_sub_ok'))
      : ecoT('eco_sub_daily');
  }
  if (btn) {
    if (checkedToday) {
      btn.disabled = true;
      btn.textContent = ecoT('eco_signedin');
    } else {
      btn.disabled = false;
      btn.textContent = ecoT('eco_checkin');
    }
  }
}

async function onCheckin() {
  const btn = $('ecoCheckin');
  if (!btn || btn.disabled) return;
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    await checkin();
    await paintBalance();
  } catch (e) {
    if (e instanceof CoinsError && e.code === 'already_checked_in') {
      await paintBalance();
    } else if (e instanceof CoinsError && e.code === 'not_authenticated') {
      btn.disabled = true;
      btn.textContent = ecoT('eco_btn_disabled');
    } else {
      // network / http_xxx：恢复原样，可重试
      btn.disabled = false;
      btn.textContent = old;
    }
  }
}

document.addEventListener('click', (e) => {
  const t = e.target;
  const btn = t && t.closest ? t.closest('#ecoCheckin') : null;
  if (btn) void onCheckin();
});

/* i18n.js 在字典 fetch 完成 / 切语言时派发 i18n:change —— 届时重画让
   eco 卡片文案跟随当前语言（首屏 module 执行时字典可能还没就绪，走英文兜底）。 */
window.addEventListener('i18n:change', () => void paintBalance());

void paintBalance();
