/**
 * BoardDuel 通用 game-page TS 装配层
 * - nav 高亮
 * - 各 game engine 的 selfTest（启动时跑一次确保 AI 工作）
 * - 棋盘 demo 区域可点（接入 engine）
 */

import type { Mode } from './game-core';

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

/**
 * F-002 修复（2026-09-28）：从 URL ?mode= 读取初始 mode。
 * 与 inviteCode()（读 ?c= 用于 online 房码）并存；online 模式优先级最高——
 * 若 URL 同时带 ?c= 和 ?mode=pass，仍走 online（防分享链接被中间参数覆写）。
 * gomoku 的 ?mode= 走 lobby 卡片机制（独立），不要重写它。
 */
export function modeFromUrl(fallback: Mode = 'ai'): Mode {
  try {
    if (typeof window === 'undefined') return fallback;
    const q = new URLSearchParams(window.location.search).get('mode');
    if (q === 'pass' || q === 'ai' || q === 'human' || q === 'online') return q as Mode;
  } catch {
    /* SSR / window 不可用时优雅降级 */
  }
  return fallback;
}

/**
 * F-002 修复：把 ?mode=xxx 的 is-cur class 同步到对应 mode 卡上。
 * 必须在 state.mode 设定之后、render() 之前调用。
 * 只动 .is-cur class，不影响 .is-disabled / disabled 属性。
 */
export function syncModeCardUI(mode: Mode): void {
  const cards = document.querySelectorAll<HTMLElement>('.bd-mode-card');
  cards.forEach((c) => {
    const m = c.dataset.mode as Mode | undefined;
    if (m === mode) c.classList.add('is-cur');
    else c.classList.remove('is-cur');
  });
}