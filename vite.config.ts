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
const BETA_ONLY_INPUTS = {
  tictactoe: resolve(here, 'games/tictactoe/index.html'),
  connect4: resolve(here, 'games/connect4/index.html'),
  reversi: resolve(here, 'games/reversi/index.html'),
  chess: resolve(here, 'games/chess/index.html'),
};

const META_PROD = {
  TITLE: 'BoardDuel — play Gomoku against a live engine',
  DESC: 'Play free 15×15 Gomoku against a real pattern-matching engine at three difficulty levels, or pass-and-play with a friend on one screen. No login, no ads.',
  OG_TITLE: 'BoardDuel — Gomoku, live engine',
  OG_DESC: '15×15 freestyle Gomoku with a real pattern-matching engine, three difficulty levels, and pass-and-play on one screen.',
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
        // 未上线游戏：只在 beta 构建里产出页面（生产构建 = 无页面 + 无导航 + 不进 sitemap）
        ...(process.env.VITE_SHOW_BETA === '1' ? BETA_ONLY_INPUTS : {}),
      },
    },
  },
});