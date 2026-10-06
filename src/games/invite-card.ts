/**
 * BoardDuel · 好友房邀请卡片（2026-10-06）
 * ─────────────────────────────────────────────────────────────
 * 改造背景：原 .go-invite 是**侧栏内联流式面板**。移动端对局页
 * 有 `body.bd-in-match .bd-side { display: contents }`（gomoku-paper.css:305），
 * 面板被摊平成裸流元素 —— 扫码图直接铺在棋盘下方、房码被挤出视口、
 * 再叠两条 toast 就彻底乱了（用户 10-06 实测截图）。
 *
 * 改成与 MathDuel 24-game `shareOverlay` 同范式的**全屏遮罩弹窗**：
 *   fixed inset:0 + 居中 .go-invite-card（白卡 + 软靛影 + 圆角16）
 *   遮罩点击关闭 / ✕ 关闭 / 好友进房后自动收起
 * 房码 + 短链 + 二维码三件套保留，后端契约一字不改：
 *   · 建房 GET /api/gp/room?game=<id>&name=<n> → { ok, code }
 *   · 短链 /b/<game>/<CODE>（worker 302）
 *   · QR   /api/qr?game=<id>&code=<CODE>&size=220（服务端 SVG，免前端库）
 *
 * 🔴 红线（2026-10-05 实践，2026-10-06 保留）：JS 全权管理 textContent 的元素
 *    （房码 code 元素）绝不能带 data-i18n，否则被字典 re-apply 覆盖掉房码。
 * 🔴 移动端 .bd-side 是 display:contents，所以卡片 root 必须挂 body 而不是侧栏，
 *    否则照样被摊平。
 */

import { showBoardDuelToast as toast } from './shared';
import '../styles/invite-card.css';
import '../styles/share-card.css';

export interface InviteCard {
  root: HTMLDivElement;
  codeEl: HTMLElement;
  copyBtn: HTMLButtonElement;
  copyCodeBtn: HTMLButtonElement;
  qrImg: HTMLImageElement;
  linkEl: HTMLInputElement;
  close: () => void;
}

const cards = new Map<string, InviteCard>();
/** 已进房后自动关卡的定时器（玩家可能还在看二维码） */
let autoCloseTimer = 0;

/** 挂载（幂等）—— 全屏遮罩挂 body，避开侧栏的 display:contents 摊平 */
export function mountInviteCard(prefix: string, game: string, label: string): InviteCard {
  const existing = cards.get(prefix);
  if (existing && existing.root.isConnected) return existing;

  const root = document.createElement('div');
  root.className = 'go-invite-overlay';
  root.id = prefix + '-invite-overlay';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Invite a friend');
  root.hidden = true;
  // 🔴 id 一律加 "card-" 前缀：gomoku/go 的 HTML 里已有 #go-invite-code /
  //    #go-invite-qr / #go-invite-copy 等旧内联面板节点，同 id 会让
  //    querySelector 命中旧节点（房码写进旧面板、卡片永远显示 '------'）。
  root.innerHTML = `
    <div class="go-invite-card">
      <div class="go-invite-head">
        <h3 class="go-invite-title" data-i18n="bg.bg_gomoku_invite">Invite a friend</h3>
        <button type="button" class="go-invite-x" data-role="close" aria-label="Close" data-i18n-aria-label="bg.bg_invite_close">✕</button>
      </div>

      <div class="go-invite-game" data-role="game">${label}</div>

      <div class="go-invite-qr">
        <img data-role="qr" alt="QR code for invite link" width="200" height="200" decoding="async">
        <span class="go-invite-qr-hint" data-i18n="bg.bg_gomoku_invite_qr_hint">Scan to join</span>
      </div>

      <div class="go-invite-codebox">
        <span class="go-invite-code-l" data-i18n="bg.bg_invite_room_code">Room code</span>
        <code class="go-invite-code" data-role="code">------</code>
        <button type="button" class="go-btn go-invite-sm" data-role="copy-code" data-i18n="bg.bg_invite_copy_code">Copy</button>
      </div>

      <div class="go-invite-linkbox">
        <input class="go-invite-link" data-role="link" readonly aria-label="Invite link">
        <button type="button" class="go-btn go-invite-sm" data-role="copy-link" data-i18n="bg.bg_invite_copy">Copy link</button>
      </div>

      <button type="button" class="go-btn go-invite-card-btn" data-role="make-card" data-i18n="bg.bg_share_save_image">🖼 Save invite card</button>

      <p class="go-invite-note" data-i18n="bg.bg_invite_note">Send this code or link — your friend lands on the same board.</p>
    </div>`;

  document.body.appendChild(root);

  // 🔴 用 root 作用域 + [data-role] 选取，不能用 #id：
  //    gomoku/go 的 HTML 里本来就存在 #go-invite-code / #go-invite-qr /
  //    #go-invite-copy（旧的侧栏内联面板），同 id 会让 querySelector 命中
  //    旧节点 —— 房码写进旧面板、卡片里永远停在 '------'（10-06 实测踩到）。
  const q = <T extends Element>(role: string): T =>
    root.querySelector('.go-invite-card [data-role="' + role + '"]') as T;
  const codeEl = q<HTMLElement>('code');
  const linkEl = q<HTMLInputElement>('link');
  const card: InviteCard = {
    root,
    codeEl,
    copyBtn: q<HTMLButtonElement>('copy-link'),
    copyCodeBtn: q<HTMLButtonElement>('copy-code'),
    qrImg: q<HTMLImageElement>('qr'),
    linkEl,
    close: () => hideInviteCard(prefix),
  };

  const link = (): string => location.origin + '/b/' + game + '/' + codeEl.textContent.trim();

  const copy = async (text: string, okMsg: string, fallback: string): Promise<void> => {
    if (!text || text === '------') { toast(fallback); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch {
      // 剪贴板被拒（非 HTTPS / 权限）→ 退回 execCommand，输入框要可见才能选中
      const inp = linkEl;
      inp.removeAttribute('readonly');
      inp.select();
      try { document.execCommand('copy'); toast(okMsg); } catch { toast(fallback); }
      inp.setAttribute('readonly', '');
    }
  };

  const flash = (btn: HTMLButtonElement, mark: string, back: string): void => {
    const old = btn.getAttribute('data-i18n') || '';
    btn.setAttribute('data-i18n', '');
    btn.textContent = mark;
    window.setTimeout(() => { btn.textContent = back; if (old) btn.setAttribute('data-i18n', old); }, 1400);
  };

  const copyLinkBtn = card.copyBtn;
  card.copyBtn.addEventListener('click', () => {
    void copy(link(), 'Invite link copied', 'Copy failed — code ' + codeEl.textContent.trim());
    flash(copyLinkBtn, '✅ Copied', '📋 Copy link');
  });

  const copyCodeBtn = card.copyCodeBtn;
  card.copyCodeBtn.addEventListener('click', () => {
    const c = codeEl.textContent.trim();
    void copy(c, 'Room code copied', 'Copy failed');
    flash(copyCodeBtn, '✅ Copied', 'Copy');
  });

  // 「保存邀请卡」→ 打开 Canvas 绘制的大图分享卡片（MathDuel 范式）
  // 延迟引入避免 invite-card → share-card 的循环依赖
  q<HTMLButtonElement>('make-card').addEventListener('click', async () => {
    const c = codeEl.textContent.trim();
    if (!c || c === '------') { toast('Room code not ready yet'); return; }
    const m = await import('./share-card');
    hideInviteCard(prefix);
    // game 是 worker 用的 id（决定 /b/<game>/<CODE>），label 是展示名 —— 别搞混
    m.shareInvite(game, label || game, c);
  });

  // 点遮罩空白处关闭（点卡片本体不关）
  root.addEventListener('click', (e) => { if (e.target === root) hideInviteCard(prefix); });
  q<HTMLButtonElement>('close').addEventListener('click', () => hideInviteCard(prefix));

  // ESC 关闭
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideInviteCard(prefix);
  });

  cards.set(prefix, card);
  return card;
}

/** 亮出卡片：房码 + 短链 + 二维码（自动聚焦关闭键，方便键盘/读屏） */
export function showInviteCard(prefix: string, game: string, code: string): void {
  const c = cards.get(prefix);
  if (!c) return;
  c.codeEl.textContent = code;
  c.linkEl.value = location.origin + '/b/' + game + '/' + code;
  try {
    c.qrImg.src = '/api/qr?game=' + encodeURIComponent(game) +
      '&code=' + encodeURIComponent(code) + '&size=200&cb=' + Date.now();
  } catch (e) { /* 二维码挂了也别挡住房码 */ }
  c.root.hidden = false;
  c.root.classList.add('show');
  document.body.classList.add('bd-invite-open');
  (c.root.querySelector('.go-invite-x') as HTMLButtonElement)?.focus();
}

/** 收起卡片（好友进房时调用；延迟一点让对方有机会扫码） */
export function hideInviteCard(prefix: string, auto = false): void {
  const c = cards.get(prefix);
  if (!c) return;
  if (auto) {
    window.clearTimeout(autoCloseTimer);
    autoCloseTimer = window.setTimeout(() => hideInviteCard(prefix), 9000);
    return;
  }
  window.clearTimeout(autoCloseTimer);
  c.root.classList.remove('show');
  c.root.hidden = true;
  document.body.classList.remove('bd-invite-open');
}

/** 对手进房 → 收卡片（避免遮住棋盘） */
export function onOpponentJoined(prefix: string): void {
  const c = cards.get(prefix);
  if (!c || c.root.hidden) return;
  hideInviteCard(prefix, true);
  toast('Opponent joined — good luck!');
}
