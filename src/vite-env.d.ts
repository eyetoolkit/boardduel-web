/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' 时展示 beta 阶段的游戏，生产环境不设置 */
  readonly VITE_SHOW_BETA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    /**
     * 运行时 i18n 翻译入口（运行时由 public/i18n/i18n.js 注入）
     * 用法：window.t('bi.pass_play') 或 window.t('bj.start_ai_desc', { level: 'Hard' })
     * 返回字符串，未命中 key 时回退到 en 文案
     */
    t(key: string, vars?: Record<string, any>): string;
    /**
     * i18n 运行时对象（public/i18n/i18n.js 注入）
     * applyToDOM(root) 用于 innerHTML 动态插入 data-i18n 节点后立即翻译，
     * 不必等 MutationObserver 下一轮（否则新节点要等下一次渲染才显示译文）。
     */
    i18n?: {
      t(key: string, vars?: Record<string, any>): string;
      applyToDOM(root?: Element | Document): void;
      getLang(): string;
    };
  }
}

export {};