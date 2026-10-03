/**
 * BoardDuel · Go 模式选择页（/games/go/lobby/）
 * ------------------------------------------------------------
 * 镜像 gomoku lobby 的行为：模式卡全部是纯 `<a href="?mode=...">`，
 * JS 关掉也能用（利于抓取与分享）；JS 只负责通用 chrome（wireLobbyChrome）。
 *
 * 与 gomoku lobby 的差异：围棋目前只有两种可玩模式（vs AI / pass-and-play），
 * 联机好友房与让子棋排在后续里程碑，故这里不发 /api/leaderboard 榜单、
 * 也没有邀请码输入（那是 online 模式上线后才有的，见 W5）。
 */

import { wireLobbyChrome } from '../../lobby-chrome';

function boot(): void {
  wireLobbyChrome();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
