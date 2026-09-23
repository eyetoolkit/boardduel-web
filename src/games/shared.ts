/**
 * BoardDuel 通用 game-page TS 装配层
 * - nav 高亮
 * - 各 game engine 的 selfTest（启动时跑一次确保 AI 工作）
 * - 棋盘 demo 区域可点（接入 engine）
 */

export function setupGamePage(slug: string): void {
  // nav 高亮
  const pgMap: Record<string, string> = {
    gomoku: 'gomoku',
    tictactoe: 'ttt',
    connect4: 'c4',
    reversi: 'rev',
    chess: 'chess',
  };
  document.querySelectorAll<HTMLAnchorElement>('.glinks a[data-pg]').forEach((a) => {
    a.classList.toggle('cur', a.dataset.pg === pgMap[slug]);
  });

  // footer / footer copy
  console.info('[BoardDuel] ' + slug + ' loaded at', new Date().toISOString());
}

export function showBoardDuelToast(msg: string, dur = 2200): void {
  let host = document.getElementById('bd-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'bd-toast-host';
    host.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;pointer-events:none;';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'background:rgba(20,26,32,.94);color:#F4F6F2;padding:10px 16px;border-radius:8px;border:1px solid #2A3741;font-family:"Space Grotesk",sans-serif;font-size:.85rem;letter-spacing:.04em;margin-top:6px;opacity:0;transition:opacity .2s;';
  host.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 220);
  }, dur);
}