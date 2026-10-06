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
 * 2026-10-06 改造：面板 DOM 原本注入 aside.bd-side，但移动端对局页
 * 有 `body.bd-in-match .bd-side { display: contents }`，面板被摊平成
 * 裸流 —— 扫码图铺在棋盘下方、房码被挤出视口（用户 10-06 实测截图）。
 * 现改为全屏遮罩弹窗卡片（范式抄 MathDuel 24-game 的 .share-overlay），
 * 挂在 body 上，避开侧栏摊平。详见 ./invite-card.ts。
 *
 * data-i18n 交给 i18n.js 的 MutationObserver（R-2）自动翻译。
 *
 * 🔴 红线（2026-10-05 19:58 实践）：JS 全权管理 textContent 的元素
 *    （这里是房码 code 元素）绝不能带 data-i18n，否则会被字典
 *    re-apply 覆盖掉房码。
 */
import { myName } from './online-core';
import { showBoardDuelToast as toast } from './shared';
import { mountInviteCard, showInviteCard } from './invite-card';
import '../styles/invite-card.css';

export type { InviteCard } from './invite-card';
export { mountInviteCard, showInviteCard };
export { hideInviteCard as closeInviteCard, onOpponentJoined } from './invite-card';

/** 各游戏展示名（卡片副标题） */
const GAME_LABEL: Record<string, string> = {
  tictactoe: 'Tic-Tac-Toe',
  connect4: 'Connect Four',
  reversi: 'Reversi',
  chess: 'Chess',
  checkers: 'Checkers',
  xiangqi: 'Xiangqi',
  gomoku: 'Gomoku',
  go: 'Go',
};

/** 旧 API 兼容别名：现在是弹窗卡片 */
export const mountInvitePanel = mountInviteCard;
export const showInvite = showInviteCard;

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

/**
 * 一站式建房流程：进对局页空盘 → 建房 → 进房 → 弹出邀请卡片。
 * 失败不静默：toast 提示 + onFail（各游戏自定，通常回模式大厅）。
 */
export async function openFriendRoom(
  game: string,
  prefix: string,
  opts: { enter: (code: string) => void; onFail: () => void },
): Promise<void> {
  mountInviteCard(prefix, game, GAME_LABEL[game] || game);
  const code = await createFriendRoom(game);
  if (!code) {
    toast('Could not open a friend room — check your connection');
    opts.onFail();
    return;
  }
  opts.enter(code);
  showInviteCard(prefix, game, code);
}
