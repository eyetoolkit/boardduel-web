/* site-header.nav.js — Board Duel 本站 Games 导航数据（站点定制文件）
 *
 * 2026-10-22 shared 收敛阶段3：从 site-header.js 内联 GAMES 表外置。
 * 本文件按站不同（boardduel 8 款 / memoryduel 3 项），天然不进
 * 漂移契约（不是共享契约，是站点数据）。
 *
 * 消费方：site-header.js 动态加载后读 window.__SH_NAV__.games。
 * 新增游戏时改这里，不动 site-header.js。
 *
 * 2026-10-22 修正：原内联表缺 checkers/go/xiangqi 三款已上线游戏
 * （public/games/ 有目录但顶栏导航不可达），本次补齐为 8 款全量。 */
window.__SH_NAV__ = {
  games: [
    { key: "nav.ttt", label: "Tic-Tac-Toe", href: "/games/tictactoe/" },
    { key: "nav.gomoku", label: "Gomoku", href: "/games/gomoku/" },
    { key: "nav.connect4", label: "Connect 4", href: "/games/connect4/" },
    { key: "nav.chess", label: "Chess", href: "/games/chess/" },
    { key: "nav.reversi", label: "Reversi", href: "/games/reversi/" },
    { key: "nav.checkers", label: "Checkers", href: "/games/checkers/" },
    { key: "nav.go", label: "Go", href: "/games/go/" },
    { key: "nav.xiangqi", label: "Xiangqi", href: "/games/xiangqi/" }
  ]
};
