#!/usr/bin/env node
/**
 * bump / 校验字典 cache-buster 版本号（boardduel，2026-10-26 新增）
 * ----------------------------------------------------------------
 * 背景：public/i18n/*.json 是运行时按需 fetch 的静态资源，
 * 浏览器/CDN 会按 URL 缓存。要让玩家拿到新文案，必须让 URL 变一下 ——
 * 也就是各页面 <script>window.__I18N_CONFIG__={...dictVersion:86...}</script>
 * 里的那个数字。
 *
 * 🔴 本仓有 98 个页面各写一份 dictVersion，手改必然漏改 ——
 *    漏改的那几个页面会把旧字典留在玩家浏览器缓存里，表现为
 *    「我改了文案但部分页面没变」，极难定位。
 *    所以：改词典后跑 `node scripts/bump-dict-version.mjs 87`，
 *    一次改全部；跑 `node scripts/bump-dict-version.mjs --check`
 *    只校验全站一致（进 build 前置）。
 *
 * 用法：
 *   node scripts/bump-dict-version.mjs 87     # 全部设成 87
 *   node scripts/bump-dict-version.mjs --check # 校验一致性，不写盘
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RE = /dictVersion\s*:\s*(\d+)/g;

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist' || f === '.git' || f === '_build-verify-2026' || f.startsWith('_build-verify')) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.html$/.test(f)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const hits = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const versions = [...src.matchAll(RE)].map((m) => Number(m[1]));
  if (versions.length) hits.push({ f, src, versions });
}

const args = process.argv.slice(2);
if (args[0] === '--check') {
  const distinct = [...new Set(hits.flatMap((h) => h.versions))];
  if (distinct.length <= 1) {
    console.log(`✓ 全站 dictVersion 一致：${distinct[0]}（${hits.length} 个页面）`);
    process.exit(0);
  }
  console.error(`✗ dictVersion 不一致：${distinct.join(', ')}`);
  for (const h of hits) {
    if (h.versions.some((v) => v !== distinct[0])) {
      console.error(`   ${relative(ROOT, h.f)}: ${h.versions.join(',')}`);
    }
  }
  process.exit(1);
}

const target = Number(args[0]);
if (!Number.isInteger(target)) {
  console.error('用法：node scripts/bump-dict-version.mjs <版本号> | --check');
  process.exit(1);
}

let changed = 0;
for (const h of hits) {
  if (h.versions.every((v) => v === target)) continue;
  // 🔴 保留原来的写法风格（dictVersion:86 / dictVersion: 86 各页面可能不同）。
  //    直接写死 `dictVersion: ${target}` 会给全站凭空加一个空格，
  //    49 个页面各多一行噪音 diff，真正的改动就被淹了。
  const out = h.src.replace(RE, (m, num) => {
    const sep = m.slice('dictVersion'.length, m.length - num.length); // ":" 或 ": "
    return `dictVersion${sep}${target}`;
  });
  writeFileSync(h.f, out, 'utf8');
  changed++;
}
console.log(`✓ dictVersion → ${target}（改动 ${changed} 个页面 / 共 ${hits.length} 个带版本的页面）`);
