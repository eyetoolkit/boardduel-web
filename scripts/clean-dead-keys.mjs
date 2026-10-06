/**
 * 清理字典里的死 key（2026-10-06）
 *
 * 补齐字典时发现两组「大小写不同的重复 key」：
 *   gomoku.How_to_play  vs  gomoku.how_to_play
 *   contact.Title       vs  contact.title
 *
 * 核验：全仓库（src / games / public / index.html）搜索确认，
 * 代码里从未使用这两个 —— 实际用的是
 *   home_v2.how_to_play（首页「玩法说明」）
 *   nav.contact（导航「Contact」）
 * 属于历史遗留死 key。留着会让后续维护困惑（改哪个生效？），
 * 且大小写不一致在某些 JSON 解析器（如 PowerShell ConvertFrom-Json）
 * 下会直接报「重复键」错误。
 *
 * 处理：删除 How_to_play 与 Title 两个大写变体，保留小写版本。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'D:/GAME/boardduel-web/public/i18n';
const L = ['en', 'zh', 'ja', 'es', 'fr', 'de'];

// 确认小写版本有值（删大写前先自检，避免删完变空）
const flat = (o, p = '', out = {}) => {
  for (const [k, v] of Object.entries(o || {})) {
    const key = p ? p + '.' + k : k;
    if (v && typeof v === 'object') flat(v, key, out);
    else out[key] = v;
  }
  return out;
};
const readRaw = (l) => JSON.parse(readFileSync(`${BASE}/${l}.json`, 'utf8').replace(/^\uFEFF/, ''));

console.log('=== 删除前自检：小写版本必须存在且非空 ===');
for (const l of L) {
  const f = flat(readRaw(l));
  const lower = f['gomoku.how_to_play'];
  const upper = f['gomoku.How_to_play'];
  const cl = f['contact.title'];
  const cu = f['contact.Title'];
  const ok = lower !== undefined && lower !== '' && cl !== undefined && cl !== '';
  console.log(`  ${l}: gomoku.how_to_play="${lower ?? '缺'}"  gomoku.How_to_play="${upper ?? '缺'}"`);
  console.log(`        contact.title="${cl ?? '缺'}"  contact.Title="${cu ?? '缺'}"  ${ok ? '✅' : '❌ 小写缺失，不删'}`);
  if (!ok) process.exit(1);
}

console.log('\n=== 执行删除 ===');
let total = 0;
for (const l of L) {
  const raw = readRaw(l);
  let n = 0;
  if (raw.gomoku && 'How_to_play' in raw.gomoku) { delete raw.gomoku.How_to_play; n++; }
  if (raw.contact && 'Title' in raw.contact) { delete raw.contact.Title; n++; }
  writeFileSync(`${BASE}/${l}.json`, JSON.stringify(raw, null, 2) + '\n', 'utf8');
  console.log(`  ${l}: 删除 ${n} 个`);
  total += n;
}
console.log(`\n合计删除 ${total} 个死 key`);

// 复核
console.log('\n=== 复核 ===');
const en = flat(readRaw('en'));
const valid = Object.keys(en).filter((k) => !k.includes('\uFEFF'));
for (const l of L) {
  const d = flat(readRaw(l));
  const miss = valid.filter((k) => !(k in d));
  const lc = new Map();
  const dups = [];
  const walk = (o, p = '') => {
    for (const [k, v] of Object.entries(o)) {
      const key = p ? p + '.' + k : k;
      if (v && typeof v === 'object') walk(v, key);
      else { const lower = key.toLowerCase(); if (lc.has(lower)) dups.push(key); else lc.set(lower, key); }
    }
  };
  walk(readRaw(l));
  console.log(`  ${l}: ${Object.keys(d).length} key   缺 ${miss.length}   大小写重复 ${dups.length}${dups.length ? '  ' + dups.join(',') : ''}`);
}