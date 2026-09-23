import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(root, 'legacy');
const dest = resolve(root, 'dist');

/**
 * legacy/ 存放**尚未用新架构重写**的旧游戏页面。
 *
 * 三条规则：
 *   1) 只在测试构建（VITE_SHOW_BETA=1）时复制 —— 生产产物保持轻量，也不暴露未上线游戏；
 *   2) **不覆盖** vite build 已经产出的文件 —— 新架构页面永远优先于 legacy 旧页面
 *      （旧版曾用 `fs.cp` 无差别覆盖，导致 beta 站上 chess/connect4/reversi/gomoku
 *       四个游戏服务的是旧页面，而生产站反而服务新页面 —— 环境倒挂）；
 *   3) 目录合并复制 —— dist/games/ 下已有 public 复制来的封面图，不能整个删掉。
 */
if (process.env.VITE_SHOW_BETA !== '1') {
  console.log('[legacy] 跳过（生产构建）');
  process.exit(0);
}

if (!existsSync(src)) {
  console.log('[legacy] 源目录不存在，跳过');
  process.exit(0);
}

let copied = 0;
let skipped = 0;

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const from = join(dir, entry.name);
    const to = join(dest, relative(src, from));
    if (entry.isDirectory()) {
      await walk(from);
      continue;
    }
    if (existsSync(to)) {
      skipped++;
      continue;
    }
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    copied++;
  }
}

if (!(await stat(src)).isDirectory()) {
  console.log('[legacy] 源不是目录，跳过');
  process.exit(0);
}

await walk(src);
console.log(`[legacy] 复制 ${copied} 个旧文件 → dist/（跳过 ${skipped} 个已被新架构页面占用的路径）`);
