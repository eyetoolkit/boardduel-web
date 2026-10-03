import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * BoardDuel Vite6+TS5.7 MPA
 * 入口：
 *   main         → /                          首页（pg-home 视觉：5 卡片 + family + contract + honesty + notes）
 *   gomoku       → /games/gomoku/             五子棋 15×15 视觉页（pg-gomoku 完整 6 节）
 *   gomokuLobby  → /games/gomoku/lobby/       五子棋模式选择页（6 张卡 + 侧栏，纯 <a> 深链进 ?mode=…）
 *   tictactoe    → /games/tictactoe/          井字 3×3 视觉页（pg-ttt）
 *   connect4     → /games/connect4/           四子棋 6×7 视觉页（pg-c4）
 *   reversi      → /games/reversi/            黑白棋 8×8 视觉页（pg-rev）
 *   chess        → /games/chess/              国际象棋 8×8 视觉页（pg-chess）
 *
 * 设计稿：D:/GAME/boardduel-web/boardduel-build/sections/pg-*.html 与
 *        D:/GAME/boardduel-web/src/styles/boardduel.css
 */
/**
 * 三个开关，共同描述「这个游戏现在处于哪一阶段」：
 *   1) `data-stage="beta"` 属性 → 生产构建从 HTML 里删掉该元素（卡片 / 导航项）
 *   2) `<!--stage:beta--> … <!--/stage:beta-->` 注释块 → 只给 beta 构建的文案
 *      `<!--stage:prod--> … <!--/stage:prod-->` 注释块 → 只给生产构建的文案
 *   3) `rollupOptions.input` 的 BETA_ONLY 列表 → 生产构建根本不产出该页面（无死链、无索引）
 *   另外 `%%TITLE%%` / `%%DESC%%` 占位符按环境替换，保证两套环境的 <title>/description 都准确。
 */
/**
 * 2026-09-28：tictactoe / connect4 / reversi / chess（含各自 lobby 与玩法页）已全量上线，
 * 从 beta-only 移入下方常驻 input。此列表保留为空，供后续未上线的新棋盘使用。
 *
 * 2026-10-03：围棋 /games/go/（W1 引擎 + W2 AI/棋盘/演示页完成）加入 beta-only。
 * 围棋仍是自包含孤岛（无任何页面链接到它，W3 arena + 棋钟 + i18n 后才转正），
 * 故生产构建不产出该页，避免半成品上线。转正时：移入常驻 input + 加首页/nav + sitemap。
 */
const BETA_ONLY_INPUTS: Record<string, string> = {
  go: resolve(here, 'games/go/index.html'),
};

const META_PROD = {
  TITLE: 'BoardDuel — play five classic boards online, free',
  DESC: 'Play Gomoku, Tic-Tac-Toe, Connect 4, Othello and Chess online for free. Live engines at several strengths, or pass-and-play with a friend on one screen. No login, no ads.',
  OG_TITLE: 'BoardDuel — five boards, live engines',
  OG_DESC: 'Gomoku, Tic-Tac-Toe, Connect 4, Othello and Chess — classic boards with live engines, free in your browser.',
};

const META_BETA = {
  TITLE: 'BoardDuel — five boards, five live engines',
  DESC: 'Five classic board games, each with a live engine. Play Gomoku, Tic-Tac-Toe, Connect 4, Reversi and Chess against AI or a friend on one screen.',
  OG_TITLE: 'BoardDuel — five boards, five live engines',
  OG_DESC: 'Five classic board games, each with a live engine. Play Gomoku, Tic-Tac-Toe, Connect 4, Reversi and Chess against AI or a friend on one screen.',
};

const BLOCK = (stage: string) =>
  new RegExp(`^[^\\S\\n]*<!--\\s*stage:${stage}\\s*-->[\\s\\S]*?^[^\\S\\n]*<!--\\s*/stage:${stage}\\s*-->[^\\n]*\\n?`, 'gm');
const ANY_MARKER = /^[^\S\n]*<!--\s*\/?stage:(?:beta|prod)\s*-->[^\n]*\n?/gm;
// 删掉元素后留下的连续空行（源码页面无 <pre>/<textarea>，可直接压缩）
const BLANK_RUN = /^[^\S\n]*(?:\n[^\S\n]*){2,}/gm;

export default defineConfig({
  plugins: [
    {
      name: 'filter-stage',
      // 生产构建（VITE_SHOW_BETA 未注入）时，从 index.html 剔除 beta/coming 阶段的游戏入口，
      // 保证线上源码不残留未上线游戏的链接（SEO 准确，且不依赖运行时 JS）。
      // beta 构建（VITE_SHOW_BETA=1）保留全部入口。
      transformIndexHtml(html) {
        const isBeta = process.env.VITE_SHOW_BETA === '1';
        const meta: Record<string, string> = isBeta ? META_BETA : META_PROD;
        let out = html.replace(/%%([A-Z_]+)%%/g, (m, k: string) => meta[k] ?? m);
        out = out.replace(BLOCK(isBeta ? 'prod' : 'beta'), '');
        if (!isBeta) {
          out = out
            .replace(/<li[^>]*\sdata-stage="(?:beta|coming)"[^>]*>[\s\S]*?<\/li>/g, '')
            .replace(/<a[^>]*\sdata-stage="(?:beta|coming)"[^>]*>[\s\S]*?<\/a>/g, '');
        }
        return out.replace(ANY_MARKER, '').replace(BLANK_RUN, '\n');
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(here, 'index.html'),
        gomoku: resolve(here, 'games/gomoku/index.html'),
        gomokuLobby: resolve(here, 'games/gomoku/lobby/index.html'),
        // 站内内容页（纸肤 + 侧栏 chrome，走 page-chrome.ts）
        rank: resolve(here, 'rank/index.html'),
        stats: resolve(here, 'stats/index.html'),
        shop: resolve(here, 'shop/index.html'),
        howto: resolve(here, 'how-to-play/index.html'),
        howtoGomoku: resolve(here, 'how-to-play/gomoku/index.html'),
        // 4 个棋类游戏（2026-09-28 全量上线）
        tictactoe: resolve(here, 'games/tictactoe/index.html'),
        connect4: resolve(here, 'games/connect4/index.html'),
        reversi: resolve(here, 'games/reversi/index.html'),
        chess: resolve(here, 'games/chess/index.html'),
        // 4 个棋类游戏的 lobby（以 gomoku lobby 为模板，1:1 镜像 MathDuel 24-game lobby）
        tictactoeLobby: resolve(here, 'games/tictactoe/lobby/index.html'),
        connect4Lobby: resolve(here, 'games/connect4/lobby/index.html'),
        reversiLobby: resolve(here, 'games/reversi/lobby/index.html'),
        chessLobby: resolve(here, 'games/chess/lobby/index.html'),
        // 4 篇玩法页
        howtoTictactoe: resolve(here, 'how-to-play/tictactoe/index.html'),
        howtoConnect4: resolve(here, 'how-to-play/connect4/index.html'),
        howtoReversi: resolve(here, 'how-to-play/reversi/index.html'),
        howtoChess: resolve(here, 'how-to-play/chess/index.html'),
        // 教师端（Path B：课堂发码实验室，复用真实 /api/gp/room 房间码，无 Supabase 后端）
        teacher: resolve(here, 'teacher/index.html'),
        // 未上线的新棋盘：只在 beta 构建里产出页面（生产构建 = 无页面 + 无导航 + 不进 sitemap）
        ...(process.env.VITE_SHOW_BETA === '1' ? BETA_ONLY_INPUTS : {}),
      },
    },
  },
});