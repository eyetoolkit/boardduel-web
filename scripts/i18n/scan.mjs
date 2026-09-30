/* ═══════════════════════════════════════════════════════════════════════════
   scripts/i18n/scan.mjs — 抽取全部可翻译单元 + 报告 TM 覆盖率
   用法：node scripts/i18n/scan.mjs [--write]   （--write 会把未收录的键补进 TM 骨架）
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkDocument, LANGS } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const TM = join(ROOT, 'i18n', 'tm');

const PAGES = [
  'index.html',
  'games/gomoku/index.html', 'games/gomoku/lobby/index.html',
  'games/tictactoe/index.html', 'games/tictactoe/lobby/index.html',
  'games/connect4/index.html', 'games/connect4/lobby/index.html',
  'games/reversi/index.html', 'games/reversi/lobby/index.html',
  'games/chess/index.html', 'games/chess/lobby/index.html',
  'rank/index.html', 'stats/index.html', 'shop/index.html',
  'how-to-play/index.html', 'how-to-play/gomoku/index.html', 'how-to-play/tictactoe/index.html',
  'how-to-play/connect4/index.html', 'how-to-play/reversi/index.html', 'how-to-play/chess/index.html',
  'teacher/index.html',
];

const units = new Map();      // english → { pages:Set, scopes:Set }
for (const p of PAGES) {
  const f = join(ROOT, p);
  if (!existsSync(f)) { console.log('  ! 缺页', p); continue; }
  const html = readFileSync(f, 'utf8');
  walkDocument(html, u => {
    if (!units.has(u.text)) units.set(u.text, { pages: new Set(), scopes: new Set() });
    const rec = units.get(u.text);
    rec.pages.add(p); rec.scopes.add(u.scope);
  });
}

// 载入 TM，算覆盖率
const tm = {};
for (const L of LANGS) {
  const f = join(TM, L + '.json');
  tm[L] = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
}
const need = LANGS.filter(L => L !== 'en');
const cov = {};
for (const L of need) cov[L] = [...units.keys()].filter(k => (tm[L][k] || '').trim()).length;

console.log(`\n抽取：${PAGES.length} 页 → ${units.size} 个去重可翻译单元\n`);
console.log('语言   已译    覆盖率   缺口');
for (const L of need) {
  const c = cov[L], t = units.size;
  console.log(` ${L}   ${String(c).padStart(4)}   ${(c / t * 100).toFixed(1).padStart(5)}%   ${String(t - c).padStart(4)}`);
}
console.log('\n按页面的译文覆盖率（以最差语言计，决定该页能否发布）：');
for (const p of PAGES) {
  const ks = [...units.entries()].filter(([, r]) => r.pages.has(p)).map(([k]) => k);
  if (!ks.length) continue;
  const per = need.map(L => [L, ks.filter(k => (tm[L][k] || '').trim()).length / ks.length]);
  const worst = per.reduce((a, b) => (b[1] < a[1] ? b : a));
  console.log(`  ${(worst[1] * 100).toFixed(0).padStart(3)}% (${String(ks.length).padStart(3)} 条, 最差 ${worst[0]})  ${p.replace('/index.html', '/').padEnd(34)}`
    + per.map(([L, v]) => `${L}:${(v * 100).toFixed(0).padStart(3)}%`).join(' '));
}

// 写 units.json（给 fill / prerender 用）
const OUT = join(ROOT, 'i18n');
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'units.json'),
  JSON.stringify(Object.fromEntries([...units.entries()].sort().map(([k, r]) =>
    [k, { pages: [...r.pages].sort(), scopes: [...r.scopes].sort() }])), null, 1) + '\n', 'utf8');
console.log(`\n→ i18n/units.json 已写出（${units.size} 条）`);

if (process.argv.includes('--write')) {
  for (const L of need) {
    const f = join(TM, L + '.json'); mkdirSync(TM, { recursive: true });
    const cur = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
    let added = 0;
    for (const k of units.keys()) if (!(k in cur)) { cur[k] = ''; added++; }
    const sorted = Object.fromEntries(Object.entries(cur).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(f, JSON.stringify(sorted, null, 1) + '\n', 'utf8');
    console.log(`  ${L}: 补 ${added} 个空槽 → 共 ${Object.keys(sorted).length} 条`);
  }
}
