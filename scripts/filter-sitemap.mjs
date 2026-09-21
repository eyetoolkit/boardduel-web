import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/**
 * 让首页 index.html 的 data-stage 成为唯一真相源：
 * 生产构建时，从 sitemap.xml 中移除未上线（非 live）游戏的条目，
 * 避免搜索引擎抓到 404 死链。测试构建保留全部条目。
 */
if (process.env.VITE_SHOW_BETA === '1') {
  console.log('[sitemap] 测试构建，保留全部条目');
  process.exit(0);
}

const html = await readFile(resolve(root, 'index.html'), 'utf8');
const live = new Set(
  [...html.matchAll(/href="\/games\/([a-z0-9-]+)\/"\s+data-stage="live"/g)].map((m) => m[1]),
);

const sitemapPath = resolve(root, 'dist', 'sitemap.xml');
const xml = await readFile(sitemapPath, 'utf8');
const removed = [];

const out = xml.replace(/<url>[\s\S]*?<\/url>\s*/g, (block) => {
  const m = block.match(/<loc>[^<]*\/games\/([a-z0-9-]+)\//);
  if (m && !live.has(m[1])) {
    removed.push(m[1]);
    return '';
  }
  return block;
});

if (removed.length) {
  await writeFile(sitemapPath, out, 'utf8');
  console.log('[sitemap] 已移除未上线游戏条目: ' + removed.join(', '));
} else {
  console.log('[sitemap] 无需调整');
}
