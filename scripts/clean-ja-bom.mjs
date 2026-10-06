/**
 * 清理 ja.json 里的 BOM 污染伪 key（2026-10-06）
 *
 * 症状：ja.json 比其他语种多出 9 个 key，且 key 名带 U+FEFF 前缀、
 * 以 "." 开头（如 "﻿.home.footer"）。成因是某次写入时 JSON 文件带了
 * BOM，被当成根 key 的一部分。
 *
 * 危害：
 *   1. 这些 key 永远匹配不上代码里的 "home.footer"（代码不带 BOM）
 *   2. 其中 contact.email_desc 的值是未转义的 HTML
 *      （"<a href="mailto:...">..." ），是潜在的注入面
 *   3. 脏数据会持续污染后续所有字典维护
 *
 * 处理：只删这 9 个 BOM key，其余原样保留。真实内容若别处有定义
 * （如 home.footer）会在别的 key 下，不受影响。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'D:/GAME/boardduel-web/public/i18n/ja.json';
const BOM = '\uFEFF';

const raw = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''));

let removed = 0;
for (const [k, v] of Object.entries(raw)) {
  if (k.includes(BOM)) {
    console.log(`  删除伪 key: ${JSON.stringify(k)} = "${String(v).slice(0, 40)}"`);
    delete raw[k];
    removed++;
  }
  // 一并清掉根层内可能残留的 BOM 子 key
  else if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k2 of Object.keys(v)) {
      if (k2.includes(BOM)) {
        console.log(`  删除伪 key: ${k}.${JSON.stringify(k2)}`);
        delete v[k2];
        removed++;
      }
    }
  }
}

writeFileSync(FILE, JSON.stringify(raw, null, 2) + '\n', 'utf8');
console.log(`\n✅ 清理 ${removed} 个 BOM 污染伪 key`);

// 复核
const flat = (o, p = '', out = {}) => {
  for (const [k, v] of Object.entries(o || {})) {
    const key = p ? p + '.' + k : k;
    if (v && typeof v === 'object') flat(v, key, out);
    else out[key] = v;
  }
  return out;
};
const ja = flat(raw);
const en = flat(JSON.parse(readFileSync('D:/GAME/boardduel-web/public/i18n/en.json', 'utf8').replace(/^\uFEFF/, '')));
const stillBom = Object.keys(ja).filter((k) => k.includes(BOM));
const jaMiss = Object.keys(en).filter((k) => !(k in ja));
console.log(`复核：ja 现有 ${Object.keys(ja).length} key`);
console.log(`  残留 BOM key: ${stillBom.length}`);
console.log(`  相对 en 缺失: ${jaMiss.length}${jaMiss.length ? '  ' + jaMiss.slice(0, 5).join(', ') : ''}`);