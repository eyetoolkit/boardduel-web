/**
 * BoardDuel · 白天/夜晚主题切换
 * ------------------------------------------------------------
 * 整站 papergames 浅色皮肤（首页 body.home-v2）都是浅色版，暗色层由本模块
 * 切换 html[data-theme="dark"] 触发（CSS 在 home-papergames.css 末尾定义）。
 * 本文件只负责：
 *   1. 启动时应用已保存的主题偏好（未保存过则一律浅色起步；无闪烁由各页 <head> 内联脚本兜底）
 *   2. 委托监听 .sb-theme 点击（首页与未来各 lobby 页共用）
 *   3. 持久化到 localStorage('bd-theme')，并同步切换按钮图标与 aria 状态
 *
 * 注意：游戏对局页（boardduel.css 深色对局区）本就不读 data-theme，不受影响。
 */

const KEY = 'bd-theme2';
const LEGACY_KEY = 'bd-theme';
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

/** 应用主题到 <html> 并同步所有切换按钮 + 地址栏主题色 */
export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');

  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#0E0F1E' : '#F4F5F9');

  document.querySelectorAll<HTMLElement>('.sb-theme').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(t === 'dark'));
    btn.setAttribute('title', t === 'dark' ? 'Switch to light' : 'Switch to dark');
    btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light' : 'Switch to dark');
    btn.innerHTML = t === 'dark' ? ICON_SUN : ICON_MOON;
  });
}

/** 启动时调用一次：应用已保存偏好（默认浅色，不再跟随系统深色），并绑定委托点击监听 */
export function initTheme(): void {
  // 旧键一次性清理：v1 曾跟随系统深色导致部分用户首屏即暗色，v2 一律浅色起步
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
  applyTheme(getStored() ?? 'light');

  // 委托监听：.sb-theme 在重渲染后依然存在，无需重复绑定
  document.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const btn = target && target.closest('.sb-theme');
    if (!btn) return;
    e.preventDefault();
    applyTheme(current() === 'dark' ? 'light' : 'dark');
  });
}
