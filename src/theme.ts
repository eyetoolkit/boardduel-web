/**
 * BoardDuel · 白天/夜晚主题切换
 * ------------------------------------------------------------
 * 整站 papergames 浅色皮肤（首页 body.home-v2）都是浅色版，暗色层由本模块
 * 切换 html[data-theme="dark"] 触发（CSS 在 home-papergames.css 末尾定义）。
 * 本文件只负责：
 *   1. 启动时解析主题偏好：**用户没手动切过 → 跟随系统 prefers-color-scheme**；
 *      手动切过之后 → 锁定 localStorage 里的显式偏好，不再被系统变更打扰。
 *   2. 委托监听 .sb-theme 点击（首页与未来各 lobby 页共用）
 *   3. 持久化到 localStorage('bd-theme2')，并同步切换按钮图标与 aria 状态
 *
 * 2026-10-11：v2 曾一律浅色起步（注释理由「部分用户首屏即暗色」）。改为跟随系统，
 * 因为面向欧美 iPhone 用户时，装成 APP 后首屏白底是最明显的「不像原生 APP」信号。
 * 三档语义：未设置=跟随系统 / 'light'=用户显式要浅色 / 'dark'=用户显式要深色。
 *
 * ⚠ 关键：applyTheme() 会写 localStorage，所以「跟随系统」这一档**不能**用它来应用，
 *    否则首次访问就把系统值固化成显式偏好，用户之后再切系统主题就不会跟随了。
 *    故 applySystemOnly() 只改 DOM 不落盘。
 *
 * 注意：游戏对局页（boardduel.css 深色对局区）本就不读 data-theme，不受影响。
 */

const KEY = 'bd-theme2';
const LEGACY_KEY = 'bd-theme';
/** 迁移标记：v2 曾在启动时无条件 applyTheme('light')，把所有老用户的偏好固化成
 *  'light'（他们其实从没手动选过）。2026-10-11 上线三档跟随后，这批脏值会让
 *  老用户永远进不了「跟随系统」档。用一次性标记清掉，之后不再干预。 */
const MIGRATED_KEY = 'bd-theme-followed';
type Theme = 'dark' | 'light';

const ICON_MOON =
  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13A8 8 0 1 1 11 4a6.5 6.5 0 0 0 9 9z"/></svg>';
const ICON_SUN =
  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7 1.7"/></svg>';

function getStored(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'dark' || t === 'light') return t;
  } catch {
    /* private mode */
  }
  return null;
}

function current(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** 系统是否偏好深色。缺 matchMedia（老浏览器）时按浅色处理。 */
function prefersDark(): boolean {
  try {
    return !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** 只改 DOM 与按钮/状态栏，**不写 localStorage** —— 用于「跟随系统」这一档 */
function paint(t: Theme): void {
  const root = document.documentElement;
  if (t === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#0E0F1E' : '#F4F5F9');

  document.querySelectorAll<HTMLElement>('.sb-theme').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(t === 'dark'));
    btn.setAttribute('title', t === 'dark' ? 'Switch to light' : 'Switch to dark');
    btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light' : 'Switch to dark');
    btn.innerHTML = t === 'dark' ? ICON_SUN : ICON_MOON;
  });
}

/** 应用主题到 <html> 并同步所有切换按钮 + 地址栏主题色，同时**落盘为显式偏好** */
export function applyTheme(t: Theme): void {
  paint(t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
}

/** 启动时调用一次：解析偏好并应用，随后绑定委托点击 + 跟随系统实时变更 */
export function initTheme(): void {
  // 旧键一次性清理：v1 曾用 bd-theme 存偏好，与新键语义不一致
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }

  const stored = getStored();

  // 一次性迁移：清掉 v2 时代无条件写死的 'light' 脏值，让老用户重新进入「跟随系统」档。
  // 只清 light —— 'dark' 是用户可能真选过的，不能动。
  let migrated = false;
  try {
    migrated = localStorage.getItem(MIGRATED_KEY) === '1';
    if (!migrated) {
      if (stored === 'light') localStorage.removeItem(KEY);
      localStorage.setItem(MIGRATED_KEY, '1');
      migrated = true;
    }
  } catch {
    /* private mode：清不掉脏值，退回按显式偏好处理，不影响功能 */
  }

  const effective = migrated ? getStored() : stored;

  if (effective) {
    paint(effective); // 显式偏好优先，不跟随系统
  } else {
    paint(prefersDark() ? 'dark' : 'light'); // 未手动切过 → 跟随系统，且不落盘
    // 用户中途改系统主题时实时跟随（仅在「未设置」档有效）
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = (e: MediaQueryListEvent) => {
        if (getStored()) return; // 期间用户已手动选过 → 交还控制权
        paint(e.matches ? 'dark' : 'light');
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange); // 老 Safari
    } catch {
      /* ignore */
    }
  }

  // 委托监听：.sb-theme 在重渲染后依然存在，无需重复绑定
  document.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const btn = target && target.closest('.sb-theme');
    if (!btn) return;
    e.preventDefault();
    applyTheme(current() === 'dark' ? 'light' : 'dark');
  });
}
