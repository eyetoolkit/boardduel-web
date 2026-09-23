/**
 * BoardDuel 首页 TS 装配层（pg-home）
 * - 顶部 gnav 的 .cur 类自动匹配当前路径
 * - wall 上 5 个 .wcard 锚点跳转 + hover 状态
 * - pill 状态标记（live / dead / engine 404 / page 404）
 *
 * 设计稿：D:/GAME/boardduel-web/boardduel-build/sections/pg-home.html
 * CSS: src/styles/boardduel.css
 */

// —— 兜底：若 CDN 缓存了旧 HTML（构建期未剔除 beta 元素），运行时再隐藏一次 ——
(function hideBetaStages() {
  if ((import.meta.env.VITE_SHOW_BETA ?? '') === '1') return;
  document.querySelectorAll('[data-stage="beta"],[data-stage="coming"]').forEach((el) => el.remove());
})();

// —— 自动高亮当前 section 的 nav 链接 ——
(function highlightNav() {
  const here = (location.pathname || '/').replace(/\/+$/, '') || '/';
  const map: Record<string, string> = {
    '/': 'home',
    '/games/gomoku/': 'gomoku',
    '/games/tictactoe/': 'ttt',
    '/games/connect4/': 'c4',
    '/games/reversi/': 'rev',
    '/games/chess/': 'chess',
  };
  const key = map[here];
  document.querySelectorAll<HTMLAnchorElement>('.glinks a[data-pg]').forEach((a) => {
    a.classList.toggle('cur', a.dataset.pg === key);
  });
})();

// —— 在 wall 卡片上加 hover 提升（设计稿已写 .wcard:hover 边框） ——
(function attachWallHover() {
  document.querySelectorAll<HTMLElement>('.wall .wcard').forEach((c) => {
    c.addEventListener('pointerenter', () => c.classList.add('is-hover'));
    c.addEventListener('pointerleave', () => c.classList.remove('is-hover'));
  });
})();

// —— pill 状态：live / dead / engine 404 / page 404 ——
(function annotatePills() {
  document.querySelectorAll<HTMLElement>('.wcard .pill').forEach((p) => {
    const cls = p.classList.contains('live') ? 'live' :
                p.classList.contains('dead') ? 'dead' :
                p.classList.contains('prop') ? 'prop' : '';
    if (cls) p.setAttribute('data-status', cls);
  });
})();

// —— 暴露给开发者：console 标记本页面是 homepage ——
console.info('[BoardDuel] home loaded at', new Date().toISOString());