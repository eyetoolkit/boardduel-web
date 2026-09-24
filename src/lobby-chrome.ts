/**
 * BoardDuel · Lobby/首页 共用 chrome 接线
 * ------------------------------------------------------------
 * 与 MathDuel 的 lobby-chrome 同一思路：侧栏抽屉（移动端 burger 展开 /
 * overlay 点击关闭 / Esc 关闭）、桌面收起（rail）、主题切换（.sb-theme），
 * 全部收敛到一个模块。首页与现在及未来的各游戏 lobby 页共用，
 * 避免出现「按钮在、事件没人绑」的静默失效。
 *
 * 页面只需在启动时调用一次 wireLobbyChrome()。
 * 依赖的 DOM（topbar/sidebar/overlay/burger/collapse/.sb-theme）由各页
 * 静态 HTML 提供，缺失时静默跳过对应功能。
 */

import { initTheme } from './theme';

let wired = false;

export function wireLobbyChrome(): void {
  if (wired) return;
  wired = true;

  initTheme();

  const burger = document.getElementById('burger') as HTMLButtonElement | null;
  const overlay = document.getElementById('overlay');
  const collapse = document.getElementById('collapse') as HTMLButtonElement | null;

  const close = () => {
    document.body.classList.remove('nav-open');
    burger?.setAttribute('aria-expanded', 'false');
  };

  burger?.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    burger.setAttribute('aria-expanded', String(open));
  });
  overlay?.addEventListener('click', close);
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  });
  collapse?.addEventListener('click', () => document.body.classList.toggle('rail'));
}
