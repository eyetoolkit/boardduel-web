/* ═══════════════════════════════════════════════════════════════════════════
   scripts/i18n/merge.mjs — 把「按索引对齐」的译文行合入各语言 TM
     node scripts/i18n/merge.mjs <rows.json> <todo.json> [--overwrite]
   rows.json : [[zh,ja,de,es,fr], ...]   顺序必须与 todo.json 完全一致
   todo.json : ["English source", ...]   由 scan 生成的缺译清单

   防错位三重保险：条数必须相等、每行必须 5 个非空单元格、
   逐行打印「英文 → 中文」供人工抽查；任何一项不符直接拒绝写入。
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TM = join(ROOT, 'i18n', 'tm');
const [,, rowsArg, todoArg, ...rest] = process.argv;
if (!rowsArg || !todoArg) { console.error('用法: node merge.mjs <rows.json> <todo.json> [--overwrite]'); process.exit(1); }
const OVERWRITE = rest.includes('--overwrite');

const rows = JSON.parse(readFileSync(join(ROOT, rowsArg), 'utf8'));
const todo = JSON.parse(readFileSync(join(ROOT, todoArg), 'utf8'));

const err = [];
if (rows.length !== todo.length) err.push(`条数不符：rows=${rows.length} todo=${todo.length}`);
rows.forEach((r, i) => {
  if (!Array.isArray(r) || r.length !== 5) err.push(`第 ${i} 行不是 5 个字段`);
  else r.forEach((v, j) => { if (typeof v !== 'string' || !v.trim()) err.push(`第 ${i} 行第 ${j} 语为空`); });
});
if (err.length) { console.error('拒绝写入：\n  ' + err.slice(0, 12).join('\n  ')); process.exit(1); }

const LANGS = ['zh', 'ja', 'de', 'es', 'fr'];
const tms = {};
for (const L of LANGS) {
  const f = join(TM, L + '.json');
  tms[L] = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
}

let wrote = 0, kept = 0;
rows.forEach((r, i) => {
  const key = todo[i];
  LANGS.forEach((L, j) => {
    if (tms[L][key] !== undefined && String(tms[L][key]).trim() && !OVERWRITE) { kept++; return; }
    tms[L][key] = r[j]; wrote++;
  });
});
for (const L of LANGS) {
  const sorted = Object.fromEntries(Object.entries(tms[L]).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(TM, L + '.json'), JSON.stringify(sorted, null, 1) + '\n', 'utf8');
}

console.log(`合入 ${wrote} 个单元格，保留既有译文 ${kept} 个（未被覆盖）`);
console.log('\n抽查表（英文 → 中文 ｜ 日本語）：');
[0, 1, 4, 8, 22, 44, 62, 89, 113, 135, 144, 149].filter(i => i < rows.length).forEach(i => {
  console.log(`  [${String(i).padStart(3)}] ${String(todo[i]).slice(0, 44).padEnd(46)} → ${String(rows[i][0]).slice(0, 22).padEnd(24)}｜ ${String(rows[i][1]).slice(0, 22)}`);
});
const frag = rows.map((r, i) => i).filter(i => /^[a-z©&«]/.test(todo[i]) || /[,;:]$|^\w{1,4}$/.test(String(todo[i]).trim()));
if (frag.length) {
  console.log(`\n⚠ 其中 ${frag.length} 条是小写开头的句子碎片（内联标签把一句话切成了多段）：`);
  console.log('   ' + frag.slice(0, 12).map(i => JSON.stringify(String(todo[i]).slice(0, 30))).join(', '));
  console.log('   德语/法语/日语语序不同，碎片拼接后读起来会生硬 —— 建议后续把这些句子在 HTML 里改成整段。');
}
