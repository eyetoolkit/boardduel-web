import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 发布阶段过滤（feature flag）
 *
 * 首页的游戏卡片与侧边栏入口带 data-stage="live" | "beta"。
 * 生产构建（VITE_SHOW_BETA 未设置）直接把 beta 元素从 HTML 中移除，
 * 因此线上源码里不会残留未上线游戏的链接，也不需要 JS 参与，SEO 准确。
 * 测试构建（VITE_SHOW_BETA=1）保留全部入口。
 */
function filterStage() {
  return {
    name: 'filter-stage',
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string) {
        if (process.env.VITE_SHOW_BETA === '1') return html;
        return html.replace(/<a\b[^>]*\bdata-stage="beta"[^>]*>[\s\S]*?<\/a>\s*/g, '');
      },
    },
  };
}

/** 清理 index.html 里用于构建标记的环境变量占位符 */
function stripEnvPlaceholders() {
  return {
    name: 'strip-env-placeholders',
    transformIndexHtml(html: string) {
      return html.replace(/%VITE_[A-Z0-9_]+%/g, '');
    },
  };
}

export default defineConfig({
  plugins: [filterStage(), stripEnvPlaceholders()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(here, 'index.html'),
      },
    },
  },
});
