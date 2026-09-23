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
export default defineConfig({
  plugins: [
    {
      name: 'filter-stage',
      // 生产构建（VITE_SHOW_BETA 未注入）时，从 index.html 剔除 beta/coming 阶段的游戏入口，
      // 保证线上源码不残留未上线游戏的链接（SEO 准确，且不依赖运行时 JS）。
      // beta 构建（VITE_SHOW_BETA=1）保留全部入口。
      transformIndexHtml(html) {
        if (process.env.VITE_SHOW_BETA === '1') return html;
        return html
          .replace(/<li[^>]*\sdata-stage="(?:beta|coming)"[^>]*>[\s\S]*?<\/li>/g, '')
          .replace(/<a[^>]*\sdata-stage="(?:beta|coming)"[^>]*>[\s\S]*?<\/a>/g, '');
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
        tictactoe: resolve(here, 'games/tictactoe/index.html'),
        connect4: resolve(here, 'games/connect4/index.html'),
        reversi: resolve(here, 'games/reversi/index.html'),
        chess: resolve(here, 'games/chess/index.html'),
      },
    },
  },
});