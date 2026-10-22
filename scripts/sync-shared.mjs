#!/usr/bin/env node
/* sync-shared.mjs — 从 eyetoolkit/fe-shared 同步共享契约文件到本站 public/shared/
 *
 * 用法:
 *   node scripts/sync-shared.mjs <site>          同步（写入）
 *   node scripts/sync-shared.mjs <site> --check  只比对不写，不一致 exit 1（CI 门禁）
 *
 * site: boardduel | memoryduel | mathduel（决定从 fe-shared 的 manifest.json 取哪份清单）
 *
 * 2026-10-22 shared 收敛阶段4：替代三仓手工复制。真相源
 * https://github.com/eyetoolkit/fe-shared（shared/ 目录）。
 * 改共享文件的流程：fe-shared 改 → 各站跑本脚本 sync → commit。
 * 直接改本站 public/shared/ 契约文件会被 sync 覆盖、CI check 拦。 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* FE_SHARED_RAW 覆盖仅用于本地/离线调试（指向本地静态服务），CI 不设走官方 raw */
const RAW_BASE = process.env.FE_SHARED_RAW || 'https://raw.githubusercontent.com/eyetoolkit/fe-shared/main';
const site = process.argv[2];
const checkMode = process.argv.includes('--check');
if (!site) { console.error('usage: node scripts/sync-shared.mjs <boardduel|memoryduel|mathduel> [--check]'); process.exit(2); }

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'shared');

/* 带退避的拉取（raw 偶发 502/超时，漂移门禁同款先例） */
async function fetchText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === tries - 1) throw new Error(`${url} 拉取失败（${tries} 次重试）: ${e.message}`);
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}

/* 1. 拉 manifest 拿本站清单 */
const manifest = JSON.parse(await fetchText(`${RAW_BASE}/manifest.json`));
const files = manifest[site];
if (!Array.isArray(files)) { console.error(`manifest 无本站「${site}」清单`); process.exit(2); }

/* 2. 逐文件同步 / 比对 */
let drift = 0;
for (const f of files) {
  const text = await fetchText(`${RAW_BASE}/shared/${f}`);
  if (text === null) { console.error(`FAIL ${f}: 真相源不存在`); drift++; continue; }
  const dest = join(outDir, f);
  if (checkMode) {
    const local = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
    /* 行尾归一化比对（CRLF 不干扰，与 check-shared-drift 同规则） */
    const norm = s => s.replace(/\r\n/g, '\n');
    if (local === null || norm(local) !== norm(text)) {
      console.error(`DRIFT ${f}: 与 fe-shared 不一致${local === null ? '（本地缺失）' : ''} — 跑 npm run sync:shared 修复`);
      drift++;
    } else {
      console.log(`ok ${f}`);
    }
  } else {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(dest, text);
    console.log(`synced ${f}`);
  }
}

if (drift > 0) {
  console.error(checkMode ? `sync:shared:check 失败：${drift} 个文件漂移` : `sync:shared 失败：${drift} 个文件异常`);
  process.exit(1);
}
console.log(checkMode ? `sync:shared:check 通过（${site} ${files.length} 个文件与真相源一致）` : `sync:shared 完成（${site} ${files.length} 个文件）`);
