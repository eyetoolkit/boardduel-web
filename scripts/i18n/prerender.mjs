/* ═══════════════════════════════════════════════════════════════════════════
   scripts/i18n/prerender.mjs — 构建期产出每语言静态页（SEO 可索引）
   ───────────────────────────────────────────────────────────────────────────
   在 vite build + copy-legacy + filter-sitemap 之后跑：
     node scripts/i18n/prerender.mjs [--min-coverage 0.95] [--dist dist] [--dry]

   产出：
     dist/[lang]/…/index.html      六语静态页（en 留在根，不加前缀）
     dist/sitemap.xml              重写：每条 URL 带 xhtml:link alternates
     dist/i18n-coverage.json       发布台账（哪些页 / 哪些语言过了门禁）

   门禁：某页某语言译文覆盖率 < min-coverage → 该语言该页**不产出**，
   也不进 hreflang、不进 sitemap。宁可整页保持英文，也不给半中半英。
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS, walkDocument, norm, isProse, localizeHref, attr, tokenize, ORIGIN } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const MIN_COV = Number(flag('min-coverage', '0.95'));
const DIST = join(ROOT, flag('dist', 'dist'));
const DRY = argv.includes('--dry');

if (!existsSync(DIST)) { console.error('找不到 dist，请先 vite build'); process.exit(1); }

/* ─── 1. 载入翻译记忆库 ─── */
const TM = {};
for (const L of LANGS) {
  const f = join(ROOT, 'i18n', 'tm', L + '.json');
  TM[L] = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
}
const tr = (L, en) => { const v = TM[L][norm(en)]; return v == null || !String(v).trim() ? null : String(v); };

/* ─── 2. 收集页面 ─── */
function htmls(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'legacy' || name === 'en' || name === 'zh' || name === 'ja' || name === 'de' || name === 'es' || name === 'fr') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) htmls(p, acc);
    else if (name.endsWith('.html')) acc.push(p);
  }
  return acc;
}
const pages = htmls(DIST).sort();
const rel = p => relative(DIST, p).split(sep).join('/');

/* ─── 3. 覆盖率预扫描（决定每页每语言是否发布）─── */
const doc = {};                                   // rel → html
for (const p of pages) doc[rel(p)] = readFileSync(p, 'utf8');

function unitKeys(html) {
  const set = new Set();
  walkDocument(html, u => set.add(u.text));
  return [...set];
}
const gate = {};                                  // rel → { lang: {cov, ok} }
for (const r of Object.keys(doc)) {
  const ks = unitKeys(doc[r]);
  gate[r] = { units: ks.length, lang: {} };
  for (const L of LANGS) {
    if (!ks.length) { gate[r].lang[L] = { cov: 1, ok: true }; continue; }
    const have = ks.filter(k => L === 'en' || tr(L, k)).length;
    const cov = have / ks.length;
    gate[r].lang[L] = { cov: L === 'en' ? 1 : cov, ok: L === 'en' ? true : cov >= MIN_COV };
  }
}
const published = {};                             // rel → [lang...]
for (const r of Object.keys(gate)) published[r] = LANGS.filter(L => gate[r].lang[L].ok);

/* ─── 4. 渲染 ─── */
function urlFor(r, L) {
  const dirPath = '/' + r.replace(/(^|\/)index\.html$/, '$1').replace(/^\.?\//, '');
  const base = L === 'en' ? dirPath : '/' + L + (dirPath === '/' ? '/' : dirPath);
  return ORIGIN + base.replace(/([^/])$/, '$1/');
}

function hreflangBlock(r) {
  const langs = published[r];
  const lines = langs.map(L =>
    `<link rel="alternate" hreflang="${L}" href="${urlFor(r, L)}">`);
  if (langs.includes('en')) lines.push(`<link rel="alternate" hreflang="x-default" href="${urlFor(r, 'en')}">`);
  return lines.join('\n');
}

function render(r, L) {
  let html = doc[r];
  if (L === 'en') {
    html = swapHreflang(html, hreflangBlock(r));
    return html;
  }
  const cov = gate[r].lang[L].cov;
  html = walkDocument(html, u => { const v = tr(L, u.text); if (v) u.set(v); });
  // <html lang> + dir
  html = html.replace(/<html([^>]*?)lang="[^"]*"/i, (m, pre) => `<html${pre}lang="${L}"`);
  // 内部链接加前缀（只动 <a href>；css/js/img/canonical/alternate 单独处理）
  html = html.replace(/<a\b([^>]*?)\bhref="([^"]*)"([^>]*)>/gi,
    (m, a, h, b) => `<a${a}href="${localizeHref(h, L)}"${b}>`);
  // canonical / og:url → 本语言版本
  const self = urlFor(r, L);
  html = html.replace(/<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${self}">`)
             .replace(/<meta property="og:url" content="[^"]*">/i, `<meta property="og:url" content="${self}">`);
  html = swapHreflang(html, hreflangBlock(r));
  html = html.replace('<!--i18n-->', `<!-- i18n: ${L} coverage ${(cov * 100).toFixed(0)}% built ${new Date().toISOString().slice(0, 16)} -->`);
  return `<!--i18n-->` + html;
}

/** 替换已有 hreflang 集群；没有就插到 </title> 之后（head 里） */
function swapHreflang(html, block) {
  const stripped = html.replace(/[ \t]*<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n?/gi, '');
  if (/<link rel="canonical"/i.test(stripped)) {
    return stripped.replace(/([ \t]*)<link rel="canonical"/i, (_m, sp) => `${sp}${block.split('\n').join('\n' + sp)}\n${sp}<link rel="canonical"`);
  }
  return stripped.replace(/<\/title>/i, m => `${m}\n${block}`);
}

/* ─── 5. 落盘 ─── */
let written = 0, skippedPageLang = [];
for (const r of Object.keys(doc)) {
  for (const L of LANGS) {
    if (!gate[r].lang[L].ok) { skippedPageLang.push([r, L, gate[r].lang[L].cov]); continue; }
    const out = render(r, L);
    const dest = L === 'en' ? join(DIST, r) : join(DIST, L, r);
    if (DRY) { if (L !== 'en') console.log(`  [dry] ${L}/${r}  ${(gate[r].lang[L].cov * 100).toFixed(0)}%`); continue; }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, out, 'utf8');
    written++;
  }
}

/* ─── 6. sitemap：给每条 URL 补 alternates ─── */
function buildSitemap() {
  const f = join(DIST, 'sitemap.xml');
  let urls = [];
  if (existsSync(f)) {
    const xml = readFileSync(f, 'utf8');
    urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  }
  if (!urls.length) { console.log('  sitemap.xml 不存在或为空，跳过重写'); return; }
  // loc → rel
  const byLoc = new Map();
  for (const r of Object.keys(doc)) for (const L of published[r]) byLoc.set(urlFor(r, L), { r, L });
  const kept = urls.filter(u => byLoc.has(u) || !/[?]/.test(u));
  const items = kept.map(u => {
    const hit = byLoc.get(u);
    const alts = hit ? published[hit.r].map(X => `      <xhtml:link rel="alternate" hreflang="${X}" href="${urlFor(hit.r, X)}"/>`).join('\n') : '';
    return `  <url>\n    <loc>${u}</loc>\n${alts ? alts + '\n' : ''}    <changefreq>weekly</changefreq>\n  </url>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${items.join('\n')}\n</urlset>\n`;
  if (!DRY) writeFileSync(f, xml, 'utf8');
  console.log(`  sitemap：${kept.length} 条（含 alternates）`);
}
buildSitemap();

/* ─── 7. 台账 ─── */
const report = {
  built: new Date().toISOString(), minCoverage: MIN_COV, pages: {},
};
for (const r of Object.keys(gate)) {
  report.pages[r] = { units: gate[r].units, published: published[r],
    coverage: Object.fromEntries(LANGS.map(L => [L, +(gate[r].lang[L].cov * 100).toFixed(1)])) };
}
if (!DRY) writeFileSync(join(DIST, 'i18n-coverage.json'), JSON.stringify(report, null, 1), 'utf8');

const full = Object.keys(gate).filter(r => published[r].length === LANGS.length).length;
console.log(`\n预渲染完成：${written} 个 HTML 产物｜${Object.keys(gate).length} 页中 ${full} 页六语齐全`);
if (skippedPageLang.length) {
  console.log(`被门禁拦下的「页×语言」${skippedPageLang.length} 个，覆盖率最差的前 12：`);
  skippedPageLang.sort((a, b) => a[2] - b[2]).slice(0, 12)
    .forEach(([r, L, c]) => console.log(`   ${(c * 100).toFixed(0).padStart(3)}%  ${L}  ${r}`));
  const need = new Set();
  for (const [r] of skippedPageLang) for (const k of unitKeys(doc[r])) if (!tr('zh', k)) need.add(k);
  console.log(`\n补齐这些页面还差 ${need.size} 条译文（×5 语言 = ${need.size * 5} 条字符串）`);
}
