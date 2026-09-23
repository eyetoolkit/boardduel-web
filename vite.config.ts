import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * BoardDuel Vite6+TS5.7 MPA
 * 入口：
 *   main         → /                          首页（pg-home 视觉：5 卡片 + family + contract + honesty + notes）
 *   gomoku       → /games/gomoku/             五子棋 15×15 视觉页（pg-gomoku 完整 6 节）
 *   tictactoe    → /games/tictactoe/          井字 3×3 视觉页（pg-ttt）
 *   connect4     → /games/connect4/           四子棋 6×7 视觉页（pg-c4）
 *   reversi      → /games/reversi/            黑白棋 8×8 视觉页（pg-rev）
 *   chess        → /games/chess/              国际象棋 8×8 视觉页（pg-chess）
 *
 * 设计稿：D:/GAME/boardduel-web/boardduel-build/sections/pg-*.html 与
 *        D:/GAME/boardduel-web/src/styles/boardduel.css
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(here, 'index.html'),
        gomoku: resolve(here, 'games/gomoku/index.html'),
        tictactoe: resolve(here, 'games/tictactoe/index.html'),
        connect4: resolve(here, 'games/connect4/index.html'),
        reversi: resolve(here, 'games/reversi/index.html'),
        chess: resolve(here, 'games/chess/index.html'),
      },
    },
  },
});