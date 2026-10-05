/**
 * BoardDuel · 好友房通用模块（2026-10-05）
 * ─────────────────────────────────────────────────────────────
 * 给 tictactoe / connect4 / reversi / chess / xiangqi 补齐
 * 「建房 → 房码 + 二维码 + 邀请链接」——与 gomoku/go 的 go-invite 面板
 * 同一套视觉与后端契约（参考 MathDuel 24-game 的分享面板范式）：
 *
 *   · 建房：GET /api/gp/room?game=<id>&name=<n> → { ok, code }
 *     （码必须由服务端生成：/ws 只认 KV 里已存在的房间，前端自造码会被拒）
 *   · 短链：/b/<game>/<CODE>（worker 302 → /games/<game>/?c=<CODE>）
 *   · QR：  /api/qr?game=<id>&code=<CODE>&size=160（服务端 SVG，
 *           免前端 6KB qrcode 库 → 无 CSP wasm 风险）
 *
 * 面板 DOM 由本模块注入 aside.bd-side（聊天块之前），
 * data-i18n 交给 i18n.js 的 MutationObserver（R-2）自动翻译。
 *
 * 🔴 红线（2026-10-05 19:58 实践）：JS 全权管理 textContent 的元素
 *    （这里是房码 code 元素）绝不能带 data-i18n，否则会被字典
 *    re-apply 覆盖掉房码。
 */
import { myName } from './online-core';
import { showBoardDuelToast as toast } from './shared';

export interface InvitePanel {
  root: HTMLDivElement;
  codeEl: HTMLElement;
  copyBtn: HTMLButtonElement;
  qrImg: HTMLImageElement;
}

const panels = new Map<string, InvitePanel>();

/** 向侧栏注入邀请面板（幂等；插在 .go-chat 之前，无聊天块则追加到末尾） */
export function mountInvitePanel(prefix: string, game: string): InvitePanel {
  const existing = panels.get(prefix);
  if (existing && existing.root.isConnected) return existing;

  const root = document.createElement('div');
  root.className = 'go-invite';
  root.id = prefix + '-invite';
  root.hidden = true;
  root.innerHTML = `
    <div class="go-invite-h" data-i18n="bg.bg_gomoku_invite">Invite a friend</div>
    <div class="go-invite-row">
      <code class="go-invite-code" id="${prefix}-invite-code">------</code>
      <button type="button" class="go-btn" id="${prefix}-invite-copy" data-i18n="bg.bg_invite_copy">Copy link</button>
    </div>
    <div class="go-invite-qr">
      <img id="${prefix}-invite-qr-img" alt="QR code for invite link" width="160" height="160" decoding="async">
      <span class="go-invite-qr-hint" data-i18n="bg.bg_gomoku_invite_qr_hint">Scan to join</span>
    </div>
    <p class="go-invite-note" data-i18n="bg.bg_invite_note">Send this code or link — your friend lands on the same board.</p>`;

  const side = document.querySelector('aside.bd-side') || document.body;
  const chat = side.querySelector('.go-chat');
  side.insertBefore(root, chat); // chat 为 null 时等价 appendChild

  const panel: InvitePanel = {
    root,
    codeEl: root.querySelector('#' + prefix + '-invite-code') as HTMLElement,
    copyBtn: root.querySelector('#' + prefix + '-invite-copy') as HTMLButtonElement,
    qrImg: root.querySelector('#' + prefix + '-invite-qr-img') as HTMLImageElement,
  };

  const copyLink = (): string => location.origin + '/b/' + game + '/' + (panel.codeEl.textContent || '');

  panel.copyBtn.addEventListener('click', () => {
    const text = copyLink();
    const code = panel.codeEl.textContent || '';
    const done = () => toast('Invite link copied');
    const fail = () => toast('Copy failed — code ' + code);
    try {
      void navigator.clipboard.writeText(text).then(done, fail);
    } catch (e) {
      fail();
    }
  });

  panels.set(prefix, panel);
  return panel;
}

/** 建房：成功返回 6 位房码，失败返回 null（网络/限流/非法响应一律 null） */
export async function createFriendRoom(game: string): Promise<string | null> {
  try {
    const r = await fetch(
      '/api/gp/room?name=' + encodeURIComponent(myName()) + '&game=' + encodeURIComponent(game),
      { credentials: 'include' },
    );
    const j = (await r.json()) as { ok?: boolean; code?: string };
    const code = String((j && j.code) || '').toUpperCase();
    if (!r.ok || !/^[A-Z2-9]{6}$/.test(code)) return null;
    return code;
  } catch (e) {
    return null;
  }
}

/** 面板亮出：房码 + QR + （复制按钮已就绪） */
export function showInvite(prefix: string, game: string, code: string): void {
  const p = panels.get(prefix);
  if (!p) return;
  p.codeEl.textContent = code;
  try {
    // cb 防 CF 边缘缓存；浏览器原生 onerror 不阻塞 UI
    p.qrImg.src = '/api/qr?game=' + encodeURIComponent(game) + '&code=' + encodeURIComponent(code) + '&size=160&cb=' + Date.now();
  } catch (e) { /* 图片缺失也别炸 */ }
  p.root.hidden = false;
}

/**
 * 一站式建房流程：进对局页空盘 → 建房 → 进房 → 亮邀请面板。
 * 失败不静默：toast 提示 + onFail（各游戏自定，通常回模式大厅）。
 */
export async function openFriendRoom(
  game: string,
  prefix: string,
  opts: { enter: (code: string) => void; onFail: () => void },
): Promise<void> {
  mountInvitePanel(prefix, game);
  const code = await createFriendRoom(game);
  if (!code) {
    toast('Could not open a friend room — check your connection');
    opts.onFail();
    return;
  }
  opts.enter(code);
  showInvite(prefix, game, code);
  toast('Room ' + code + ' created — waiting for your friend');
}
