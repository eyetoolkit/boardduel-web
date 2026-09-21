import { cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(root, 'legacy');
const dest = resolve(root, 'dist');

/**
 * legacy/ 存放尚未用新架构重写的旧游戏页面。
 * 只在测试构建（VITE_SHOW_BETA=1）时复制进产物，
 * 生产产物因此保持轻量，也不会暴露未上线的游戏。
 */
if (process.env.VITE_SHOW_BETA !== '1') {
  console.log('[legacy] 跳过（生产构建）');
  process.exit(0);
}

if (!existsSync(src)) {
  console.log('[legacy] 源目录不存在，跳过');
  process.exit(0);
}

// 合并复制：dist/games/ 下已有 public 复制来的封面图，不能整个删掉。
// 已重写进新架构的游戏不会出现在 legacy/ 里，自然不会被覆盖。
await cp(src, dest, { recursive: true });
console.log('[legacy] 已复制 legacy/ → dist/');
