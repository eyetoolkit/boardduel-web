/* ═══════════════════════════════════════════════════════════════════════════
   scripts/i18n/seed.mjs — 从既有字典「免费」捞出一批译文，灌进翻译记忆库
   ───────────────────────────────────────────────────────────────────────────
   public/i18n/{en,zh,ja,de,es,fr}.json 里躺着 1475 个键（旧版页面时代留下的，
   翻译是完整的）。新页面文案只要英文值相同，译文可以直接复用 —— 实测能覆盖约 22%。
   用法：node scripts/i18n/seed.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm, isProse } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const TM = join(ROOT, 'i18n', 'tm');
const LANGS = ['zh', 'ja', 'de', 'es', 'fr'];

function flatten(o, p = '', acc = {}) {
  for (const [k, v] of Object.entries(o)) {
    const q = p ? p + '.' + k : k;
    if (v && typeof v === 'object') flatten(v, q, acc);
    else if (typeof v === 'string') acc[q] = v;
  }
  return acc;
}

const enFlat = flatten(JSON.parse(readFileSync(join(ROOT, 'public/i18n/en.json'), 'utf8')));

let bootstrapped = 0;
for (const L of LANGS) {
  const f = join(ROOT, 'public/i18n', L + '.json');
  if (!existsSync(f)) { console.log(`  ! 缺 ${L}.json，跳过`); continue; }
  const trFlat = flatten(JSON.parse(readFileSync(f, 'utf8')));

  // 英文值 → 候选译文（同值多译时取出现次数最多的）
  const byEn = new Map();
  for (const [k, en] of Object.entries(enFlat)) {
    const tr = trFlat[k];
    if (tr == null) continue;
    const key = norm(en);
    if (!isProse(key)) continue;
    if (!byEn.has(key)) byEn.set(key, new Map());
    const c = byEn.get(key);
    c.set(tr, (c.get(tr) || 0) + 1);
  }

  const out = {};
  for (const [en, cands] of byEn) {
    let best = null, bn = 0;
    for (const [t, n] of cands) if (n > bn) { bn = n; best = t; }
    if (best && norm(best) !== en) out[en] = best;
  }

  mkdirSync(TM, { recursive: true });
  const dest = join(TM, L + '.json');
  let merged = out;
  if (existsSync(dest)) {
    const cur = JSON.parse(readFileSync(dest, 'utf8'));
    merged = { ...out, ...cur };          // 已有的人工译文优先，绝不被种子覆盖
  }
  writeFileSync(dest, JSON.stringify(merged, null, 1) + '\n', 'utf8');
  console.log(`  ${L}: 种子译文 ${Object.keys(out).length} 条 → 合计 ${Object.keys(merged).length} 条`);
  bootstrapped += Object.keys(out).length;
}
console.log(`\n种子完成，共导入 ${bootstrapped} 条既有人工译文到 i18n/tm/`);
