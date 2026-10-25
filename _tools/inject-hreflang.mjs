#!/usr/bin/env node
/**
 * inject-hreflang.mjs — boardduel 全站 hreflang 注入（幂等）
 *
 * 背景（2026-10-25 深度审核 P1）：
 *   站点运行时 i18n 真实支持 6 语言，检测优先级
 *   `?lang=xx` > 路径前缀 > localStorage > 默认（zh-CN），见 public/i18n/i18n.js。
 *   但 <head> 的 hreflang 声明严重缺漏：
 *     · index.html / games/*\/index.html / games/*\/lobby/index.html 只声明
 *       en + x-default 两条，且 bare 指错（默认语言实际是 zh-CN，不是 en）；
 *     · rank / shop / stats / teacher / tournament / how-to-play 全系 0 条；
 *     · 6 语言的内容投入正在白送多语搜索信号。
 *   public/{about,blog,contact,membership,privacy,terms} 已有正确 7 条先例，
 *   本脚本把同一矩阵推广到全部 Vite input 页面 + 404。
 *
 * 声明矩阵（沿用 public/about 先例，bare = zh-CN 默认）：
 *   zh-CN      → https://boardduel.com{path}
 *   en/ja/es/fr/de → https://boardduel.com{path}?lang=xx
 *   x-default  → https://boardduel.com{path}
 *
 * 刻意跳过（勿"补全"，各有理由）：
 *   · boardduel-build/sections/     构建碎片，非页面
 *   · legacy/games/*                遗留页，已有 6 语言 hreflang
 *   · public/{de,en,es,fr,ja,zh}/   meta-refresh 语言桩页，非内容页
 *   · public/{about,blog,...}       已有正确 7 条，幂等命中即跳过
 *
 * 用法：
 *   node _tools/inject-hreflang.mjs           注入（只写需要改的文件）
 *   node _tools/inject-hreflang.mjs --check   只验证不写盘，有缺口 exit 1（CI 可复用）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['en', 'ja', 'es', 'fr', 'de'];
const CHECK_ONLY = process.argv.includes('--check');

/** 目标页面清单：vite.config.ts rollupOptions.input 全量 + public/404.html */
const GAMES = ['checkers', 'chess', 'connect4', 'go', 'gomoku', 'reversi', 'tictactoe', 'xiangqi'];
const PAGES = [
  'index.html',
  'rank/index.html',
  'shop/index.html',
  'stats/index.html',
  'teacher/index.html',
  'tournament/index.html',
  'public/404.html',
  ...GAMES.flatMap((g) => [`games/${g}/index.html`, `games/${g}/lobby/index.html`]),
  'how-to-play/index.html',
  ...['checkers', 'chess', 'connect4', 'gomoku', 'reversi', 'tictactoe', 'xiangqi'].map((g) => `how-to-play/${g}/index.html`),
  'how-to-play/go/index.html',
  ...['rules', 'capture', 'ko', 'handicap', 'scoring'].map((p) => `how-to-play/go/${p}/index.html`),
];

/**
 * 期望的 hreflang 集合：bare 从页面自身 canonical 派生（构造上保证一致），
 * zh-CN/x-default → bare，en/ja/es/fr/de → bare?lang=xx（i18n 运行时最高优先级参数）。
 * 404 页 canonical 指向首页，派生结果同样自洽（错误页本就不被索引）。
 */
function expectedLinks(canonicalHref) {
  const bare = canonicalHref.trim();
  const sep = bare.includes('?') ? '&' : '?';
  return [
    ['zh-CN', bare],
    ...LANGS.map((l) => [l, `${bare}${sep}lang=${l}`]),
    ['x-default', bare],
  ];
}

/** 从文件内容解析已有 hreflang：返回 [{lang, href}] */
function parseHreflangs(content) {
  const out = [];
  const re = /<link[^>]*hreflang="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const tag = m[0];
    const lang = m[1];
    const hrefM = tag.match(/href="([^"]+)"/);
    if (hrefM) out.push([lang, hrefM[1]]);
  }
  return out;
}

/** 期望集合与已有集合是否一致（无序比较） */
function matchesExpected(actual, expected) {
  const norm = (a) => a.map(([l, h]) => `${l}|${h}`).sort().join('\n');
  return norm(actual) === norm(expected);
}

function buildBlockLines(expected, indent) {
  return expected.map(([lang, href]) => `${indent}<link rel="alternate" hreflang="${lang}" href="${href}" />`);
}

/** 删掉所有含 hreflang 的整行，返回新内容 */
function stripHreflangLines(content) {
  return content
    .split('\n')
    .filter((line) => !line.includes('hreflang='))
    .join('\n');
}

function main() {
  const changed = [];
  const already = [];
  const missing = [];
  const problems = [];

  for (const file of PAGES) {
    const abs = join(ROOT, file);
    if (!existsSync(abs)) {
      missing.push(file);
      continue;
    }
    const before = readFileSync(abs, 'utf8');
    const actual = parseHreflangs(before);

    // canonical 行 = 注入锚点 + hreflang bare URL 的真相源（先找它再谈期望）
    const lines = before.split('\n');
    const canonIdx = lines.findIndex((l) => /<link[^>]*rel="canonical"/.test(l));
    if (canonIdx < 0) {
      problems.push(`${file}: 找不到 canonical 行，无法定位注入锚点`);
      continue;
    }
    const canonHref = lines[canonIdx].match(/href="([^"]+)"/);
    if (!canonHref) {
      problems.push(`${file}: canonical 行缺 href`);
      continue;
    }
    const expected = expectedLinks(canonHref[1]);

    if (matchesExpected(actual, expected)) {
      already.push(file);
      continue;
    }

    const indent = lines[canonIdx].match(/^\s*/)[0];

    // 重建：剥旧 hreflang 行 → canonical 后插新块
    const stripped = stripHreflangLines(before).split('\n');
    const newCanonIdx = stripped.findIndex((l) => /<link[^>]*rel="canonical"/.test(l));
    const block = buildBlockLines(expected, indent);
    const after = [...stripped.slice(0, newCanonIdx + 1), ...block, ...stripped.slice(newCanonIdx + 1)].join('\n');

    // 自校验：写盘内容必须恰好 7 条且匹配期望
    const verify = parseHreflangs(after);
    if (!matchesExpected(verify, expected) || verify.length !== 7) {
      problems.push(`${file}: 注入后自校验失败（${verify.length} 条）`);
      continue;
    }

    if (!CHECK_ONLY) writeFileSync(abs, after, 'utf8');
    changed.push(file);
  }

  // 汇总
  console.log(`hreflang 注入${CHECK_ONLY ? '（--check 只验证）' : ''}`);
  console.log(`  目标页面:   ${PAGES.length}`);
  console.log(`  已是正确:   ${already.length}`);
  console.log(`  ${CHECK_ONLY ? '待修复' : '已注入'}:     ${changed.length}`);
  if (missing.length) console.log(`  文件缺失:   ${missing.length} → ${missing.join(', ')}`);
  if (problems.length) {
    console.log(`  异常:       ${problems.length}`);
    for (const p of problems) console.log(`    · ${p}`);
  }
  if (changed.length && !CHECK_ONLY) {
    console.log('  改动文件:');
    for (const f of changed) console.log(`    · ${f}`);
  }

  const bad = missing.length + problems.length + (CHECK_ONLY ? changed.length : 0);
  if (bad > 0) {
    console.error(`FAIL: ${bad} 个问题`);
    process.exit(1);
  }
  console.log('OK: 全部页面 hreflang 矩阵就绪');
}

main();
