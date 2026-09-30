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
  }
}

export {};