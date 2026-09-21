/// <reference types="vite/client" />

/**
 * 首页发布阶段兜底。
 *
 * 正常情况下不需要这段逻辑——vite.config.ts 的 filter-stage 插件
 * 已在构建时把 data-stage="beta" 的元素从 HTML 中移除。
 * 这里只为一种边缘情况兜底：用户浏览器/CDN 缓存了旧版 HTML，
 * 此时页面里可能仍残留未上线游戏的入口。
 *
 * 保持极简：首页视觉与结构完全沿用原有静态实现，不做任何改版。
 */
const SHOW_BETA = import.meta.env.VITE_SHOW_BETA === '1';

if (!SHOW_BETA) {
  document
    .querySelectorAll<HTMLElement>('[data-stage="beta"]')
    .forEach((el) => {
      el.style.display = 'none';
    });
}
