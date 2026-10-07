/**
 * 给 8 款游戏页补「规则」区块。
 *
 * 为什么要做：同一个 gomoku 页，papergames 有 2650 字符正文 + h1 + 4 个 h2
 * （Rules / multiplayer / Similar games / History）；我们只有 h1、0 个 h2。
 * 一个没有 h2 的页面在 Google 眼里几乎没有可索引的文本 ——
 * 「gomoku rules」「history of gomoku」这类长尾词一个都吃不到。
 *
 * 内容从哪来：不新写。how-to-play/{slug}/ 已经有 8 篇打磨过的教程，
 * 这里只提炼第一段规则列表 + 链回完整教程。既避免重复内容，又强化内链。
 *
 * 关键点：教程里的 h2 和每个 li 都带 data-i18n（如 bh.bh_chess_rule1），
 * 内容完全由字典驱动。注入时**必须原样保留这些属性**，否则切到别的语言
 * 时这块会变成英文硬编码。
 *
 * 用法：node scripts/gen-game-rules.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/* 每款游戏的教程源。默认是 how-to-play/{slug}/index.html，
 * go 是唯一的结构例外：它的 how-to-play/go/ 是个索引页，
 * 「The rules」只是一张指向 how-to-play/go/rules/ 的卡片，
 * 真正的规则列表在子页里 —— 所以单独指定源与标题。 */
const GAMES = [
  { slug: 'gomoku' },
  { slug: 'tictactoe' },
  { slug: 'connect4' },
  { slug: 'reversi' },
  { slug: 'chess' },
  { slug: 'checkers' },
  { slug: 'go', src: 'how-to-play/go/rules/index.html', title: 'Rules', link: 'how-to-play/go/rules/' },
  { slug: 'xiangqi' },
];

const MARK_BEGIN = '<!-- gen:rules begin -->';
const MARK_END = '<!-- gen:rules end -->';

/* ── 从教程里挖出第一段规则 ──────────────────────────────────────────
 * 8 篇教程结构并不统一，这是实测出来的，不是猜的：
 *   chess / connect4 / gomoku / reversi / tictactoe → <h2 class="pp-h2" data-i18n>Rules</h2> + <ul class="pp-ul">
 *   checkers / xiangqi                              → <h2>Rules</h2>（无 class/i18n）+ <ul>
 *   go                                              → 只有 <h3>The rules</h3>，没有 h2
 * 所以标题按「层级 h2|h3」+「文本含 rules」来匹配，不假设层级。
 */
function extractRules(game) {
  const { slug } = game;
  const rel = game.src || `how-to-play/${slug}/index.html`;
  const src = readFileSync(resolve(root, rel), 'utf8');
  const body = src.replace(/<script[\s\S]*?<\/script>/g, '');

  // go 走这条：子页的 h2 叫「The board」而不是 Rules，按标题文本找会扑空，
  // 直接取全页第一段规则列表，标题用配置里给的。
  if (game.title) {
    const ul = body.match(/<ul\b[^>]*>[\s\S]*?<\/ul>/i);
    return ul ? { title: game.title, titleAttrs: 'data-i18n="bh.bh_h2p_rules"', list: ul[0] } : null;
  }

  // 其余 7 款：找 h2 或 h3，文本含 rules，取它之后到下一个 h1/h2 之间的列表
  const headRe = /<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  let m;
  let hit = null;
  while ((m = headRe.exec(body))) {
    const text = m[3].replace(/<[^>]+>/g, '').trim();
    if (/rules/i.test(text)) {
      hit = { attrs: m[2], text, end: m.index + m[0].length };
      break;
    }
  }
  if (!hit) return null;

  const rest = body.slice(hit.end);
  const stop = rest.search(/<h[12]\b/i);
  const seg = stop > 0 ? rest.slice(0, stop) : rest;

  const ul = seg.match(/<ul\b[^>]*>[\s\S]*?<\/ul>/i);
  if (!ul) return null;

  const key = (hit.attrs.match(/data-i18n="([^"]+)"/i) || [])[1] || null;
  // checkers / xiangqi 两篇的 h2 是纯文本「Rules」，没挂 data-i18n，
  // 照搬过去就成了英文硬编码。这是同一个词，统一借用 bh_h2p_rules。
  const finalKey = key || (/^rules$/i.test(hit.text.trim()) ? 'bh.bh_h2p_rules' : null);
  return {
    title: hit.text,
    titleAttrs: finalKey ? `data-i18n="${finalKey}"` : '',
    list: ul[0],
  };
}

/* ── 组装要注入的区块 ──────────────────────────────────────────────── */
function blockFor(slug, r, game) {
  const link = game.link || `how-to-play/${slug}/`;
  return [
    MARK_BEGIN,
    `  <section class="bd-howto" aria-labelledby="bd-howto-h">`,
    `    <h2 id="bd-howto-h" class="bd-howto-h"${r.titleAttrs ? ' ' + r.titleAttrs : ''}>${r.title}</h2>`,
    `    ${r.list}`,
    `    <p class="bd-howto-more">`,
    `      <a href="/${link}" data-i18n="bg.bg_rules_more">Full rules, strategy and FAQ</a>`,
    `    </p>`,
    `  </section>`,
    MARK_END,
  ].join('\n');
}

/* ── 注入（幂等：已有标记就替换） ───────────────────────────────────── */
function inject(file, block) {
  const src = readFileSync(file, 'utf8');
  const b = src.indexOf(MARK_BEGIN);
  const e = src.indexOf(MARK_END);
  if (b >= 0 && e > b) {
    return { next: src.slice(0, b) + block + src.slice(e + MARK_END.length), mode: 'replace' };
  }
  const close = src.lastIndexOf('</main>');
  if (close < 0) return null;
  return {
    next: src.slice(0, close) + block + '\n' + src.slice(close),
    mode: 'insert',
  };
}

/* ── 入口 ──────────────────────────────────────────────────────────── */
const check = process.argv.includes('--check');
const report = [];
let failed = 0;

for (const game of GAMES) {
  const slug = game.slug;
  const file = resolve(root, `games/${slug}/index.html`);
  if (!existsSync(file)) {
    report.push(`  ❌ ${slug}: 游戏页不存在`);
    failed++;
    continue;
  }
  const r = extractRules(game);
  if (!r) {
    report.push(`  ❌ ${slug}: 教程里没挖到规则列表 —— 结构可能又变了，需人工看`);
    failed++;
    continue;
  }
  const block = blockFor(slug, r, game);
  const res = inject(file, block);
  if (!res) {
    report.push(`  ❌ ${slug}: 游戏页找不到 </main>，跳过`);
    failed++;
    continue;
  }
  const items = (r.list.match(/<li\b/gi) || []).length;
  if (check) {
    report.push(`  ${res.mode === 'insert' ? '＋' : '⟳'} ${slug}: ${res.mode} · ${r.title} · ${items} 条要点`);
  } else {
    writeFileSync(file, res.next, 'utf8');
    report.push(`  ✅ ${slug}: ${res.mode === 'insert' ? '新增' : '替换'} · ${r.title} · ${items} 条要点`);
  }
}

console.log(check ? '[check] 将要做的改动：' : '已写入：');
console.log(report.join('\n'));
console.log(`\n合计 ${GAMES.length - failed}/${GAMES.length} 款成功${failed ? `，${failed} 款失败` : ''}`);
if (failed) process.exit(1);
