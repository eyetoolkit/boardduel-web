/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' 时展示 beta 阶段的游戏，生产环境不设置 */
  readonly VITE_SHOW_BETA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
