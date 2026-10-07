/**
 * 一次性脚本：从现有 how-to-play 模板派生 checkers / xiangqi 两篇教程页。
 *
 * 为什么用脚本而不是手写：模板里有 180 行结构（侧边导航 / 面包屑 / 图标 SVG /
 * 样式引入 / i18n 注入），手写必然出现类名或结构偏差。
 * 派生的好处是：类名与现有 6 篇 100% 一致，样式零风险。
 *
 * 2026-07-07 背景：死链扫描发现 /how-to-play/checkers 与 /how-to-play/xiangqi
 * 均404 —— 8 款游戏里只建了 6 篇教程，这两篇漏了，而游戏页导航栏有指向它们的链接。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TPL = path.join(ROOT, 'how-to-play/connect4/index.html');
// 🔴 readFileSync 不接受 `newline` 参数（那是 io.open 的），要保 CRLF 原样用二进制读再解码
const tpl = fs.readFileSync(TPL, 'utf8');

/* ── 每篇教程的内容配置 ── */
const PAGES = {
  checkers: {
    name: 'Checkers',
    slug: 'checkers',
    head: 'How to play Checkers · BoardDuel',
    desc: 'Learn how to play checkers — the rules, the three ways to capture, and when a piece is promoted to a king.',
    lead: 'Checkers is a classic capture game. Every move is either a step or a capture, and the moment a piece reaches the far side of the board it becomes a king and reverses direction. That one rule creates almost all of the game’s tension.',
    goal: 'capture all of your opponent’s pieces, or block them so none can move.',
    rules: [
      'The board is 8×8, played on the dark squares only',
      'Red moves first, then players alternate',
      'Pieces move diagonally forward one square',
      'A piece captures by jumping over an adjacent enemy piece into the empty square beyond',
      'If a jump is available you <em>must</em> take it — you may not choose a plain step instead',
      'A piece reaching the last row is promoted to a king and moves in both directions from then on',
    ],
    shapesTitle: 'Capturing, and promotion',
    shapes: [
      { t: 'Simple capture', d: 'One jump over an adjacent enemy piece. A piece can chain several captures in a single turn.', cells: ['you', 'op', 'you', 'empty'] },
      { t: 'Long jump', d: 'The same idea, longer range. Kings jump from further away, which is what makes them valuable.', cells: ['empty', 'empty', 'op', 'empty', 'empty', 'you', 'empty'] },
      { t: 'Promotion', d: 'A man landing on the far row flips to a king. The flip is immediate and changes which directions it can move.', cells: ['empty', 'empty', 'empty', 'you'] },
    ],
    strat: [
      { t: '1. Do not jump into a trap', b: 'A capture that leaves your piece capturable simply trades one man for one. Count the landing square before you commit.' },
      { t: '2. Get a king early', b: 'A king is worth roughly two men because it moves backwards. Trading a man to reach the far row is usually worth it.' },
      { t: '3. Force the tempo', b: 'When you have a choice between a step and a jump, the jump is forced — use that to make your opponent move the way you want.' },
      { t: '4. Push from the back', b: 'Advancing one man at a time from the rear keeps your options open. Moving everything at once rarely works.' },
    ],
    faq: [
      { q: 'What happens when a piece is blocked?', a: 'It simply cannot move. The game does not end automatically — it ends when one side has no pieces left, or no legal move for any of them.' },
      { q: 'Can a king be captured by a man?', a: 'No. Kings may only be captured by other kings. This is why a lone king against a full set of men is still a real game.' },
      { q: 'Is checkers solved?', a: 'Not fully, unlike some simpler board games. Opening theory is well documented, but middlegame play still has plenty of unsolved positions.' },
    ],
  },

  xiangqi: {
    name: 'Xiangqi',
    slug: 'xiangqi',
    head: 'How to play Xiangqi · BoardDuel',
    desc: 'Learn how to play xiangqi (Chinese chess) — the rules, how the general is checked, and why cannons capture the way they do.',
    lead: 'Xiangqi is played on the nine points of a river with seven pieces a side. It shares an ancestry with chess, but two rules set it apart: a piece may not move into check, and the cannon captures by jumping exactly one piece.',
    goal: 'checkmate or stalemate the enemy general. The side whose general is captured loses.',
    rules: [
      'The board is 9 files by 10 ranks, split by a river in the middle',
      'Red moves first, then players alternate',
      'The general moves one point orthogonally and must stay inside its own palace',
      'Your general may never be left in check — and you may not move into check',
      'The chariot moves any distance in a straight line; the horse moves one point then one diagonally, and a leg can block it',
      'The cannon moves like a chariot for normal moves, but captures by jumping exactly one intervening piece',
      'A side with no legal move loses; if its general is captured the game ends immediately',
    ],
    shapesTitle: 'The two rules that surprise newcomers',
    shapes: [
      { t: 'Cannon capture', d: 'To capture, the cannon jumps over exactly one piece — the screen — and takes the first enemy piece beyond it. Without a screen, the same cannon is a plain mover.', cells: ['empty', 'you', 'op', 'op', 'empty', 'op', 'empty'] },
      { t: 'Horse leg', d: 'The horse moves one point orthogonally then one diagonally. If the orthogonal step is occupied, the diagonal leg is blocked and the move is illegal.', cells: ['op', 'empty', 'empty', 'empty', 'you', 'empty', 'empty'] },
      { t: 'Facing generals', d: 'Two generals may not face each other on an open file with nothing between them. It is treated as an illegal position.', cells: ['you', 'empty', 'empty', 'empty', 'empty', 'empty', 'op'] },
    ],
    strat: [
      { t: '1. Keep the two generals apart', b: 'Open files between the generals let either side capture instantly. Most losses come from a file left open by an unnecessary piece move.' },
      { t: '2. Chariots before everything', b: 'The chariot is the only piece that can threaten both halves of the board. Two chariots usually beat one chariot plus two cannons.' },
      { t: '3. Use the cannon as a mobile screen', b: 'A cannon parked behind a pawn can suddenly take the piece in front of it. Screens are how you turn a passive position into a threat.' },
      { t: '4. Push a pawn to force a reply', b: 'A pawn one step from the far rank cannot be stopped, and its promotion threat often generates the only forcing line you have.' },
    ],
    faq: [
      { q: 'Can the generals face each other?', a: 'No. Two generals on the same file with nothing between them is an illegal position — the side that created it loses immediately, so you must block or move.' },
      { q: 'Is checkmate required, or is capturing the general enough?', a: 'Capturing the general ends the game at once. In practice a general is rarely captured, because leaving it capturable is itself illegal — most games end by checkmate or stalemate.' },
      { q: 'What is a perpetual check?', a: 'Checking the same general over and over to avoid losing. Rules for repetition limits vary, so repeated checks are usually drawn in friendly play.' },
    ],
  },
};

function cells(c) {
  return c.map((k) => `<div class="pp-cell ${k}" aria-hidden="true">${k === 'empty' ? '·' : '●'}</div>`).join('');
}

function build(cfg) {
  let h = tpl;

  // 头部的 title / description / canonical
  h = h.replace(/<title>[^<]*<\/title>/, `<title>${cfg.head}</title>`);
  h = h.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${cfg.desc}">`);
  h = h.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="https://boardduel.com/how-to-play/${cfg.slug}/">`);

  // 面包屑末项
  h = h.replace(/<span class="sep">\/<\/span><span>Connect 4<\/span>/, `<span class="sep">/</span><span>${cfg.name}</span>`);

  // H1 + lead
  h = h.replace(/<h1 class="pp-h1">How to play Connect 4<\/h1>/, `<h1 class="pp-h1">How to play ${cfg.name}</h1>`);
  h = h.replace(/<p class="pp-lead"[^>]*>[\s\S]*?<\/p>/, `<p class="pp-lead">${cfg.lead}</p>`);

  // goal note
  h = h.replace(
    /<div class="pp-note">[\s\S]*?<\/div>\s*\n/,
    `<div class="pp-note">\n    <p class="pp-p"><strong>The goal:</strong> ${cfg.goal}</p>\n  </div>\n`
  );

  // Rules list
  h = h.replace(
    /<h2 class="pp-h2"[^>]*>Rules<\/h2>\s*\n\s*<ul class="pp-ul">[\s\S]*?<\/ul>/,
    `<h2 class="pp-h2">Rules</h2>\n    <ul class="pp-ul">\n` +
    cfg.rules.map((r) => `      <li>${r}</li>`).join('\n') +
    `\n    </ul>`
  );

  // shapes grid
  h = h.replace(
    /<h2 class="pp-h2"[^>]*>The shapes that win<\/h2>\s*\n\s*<div class="pp-grid">[\s\S]*?\n    <\/div>/,
    `<h2 class="pp-h2">${cfg.shapesTitle}</h2>\n    <div class="pp-grid">\n` +
    cfg.shapes.map((s) => `      <div class="pp-card">\n        <h3 class="pp-h3">${s.t}</h3>\n        <div class="pp-cells">${cells(s.cells)}</div>\n        <p class="pp-muted">${s.d}</p>\n      </div>`).join('\n') +
    `\n    </div>`
  );

  // strategy cards
  h = h.replace(
    /<h2 class="pp-h2"[^>]*>Strategy<\/h2>[\s\S]*?\n(?=\s*<h2 class="pp-h2")/,
    `<h2 class="pp-h2">Strategy</h2>\n` +
    cfg.strat.map((s) => `    <div class="pp-card" style="margin-top:12px">\n      <h3 class="pp-h3">${s.t}</h3>\n      <p class="pp-p">${s.b}</p>\n    </div>`).join('\n') +
    `\n`
  );

  // FAQ
  h = h.replace(
    /<h2 class="pp-h2"[^>]*>(?:FAQ|Frequently asked)[\s\S]*?\n(?=\s*<div class="pp-cta-row">)/,
    `<h2 class="pp-h2">FAQ</h2>\n` +
    cfg.faq.map((f) => `    <details class="pp-faq">\n      <summary>${f.q}</summary>\n      <p class="pp-p">${f.a}</p>\n    </details>`).join('\n') +
    `\n\n`
  );

  // CTA 按钮
  h = h.replace(
    /<a class="pp-cta" href="\/games\/connect4\/lobby\/"[^>]*>Play Connect 4<\/a>/,
    `<a class="pp-cta" href="/games/${cfg.slug}/lobby/" data-stage="live">Play ${cfg.name}</a>`
  );

  return h;
}

let n = 0;
for (const [slug, cfg] of Object.entries(PAGES)) {
  const dir = path.join(ROOT, 'how-to-play', slug);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'index.html');
  fs.writeFileSync(out, build(cfg), 'utf8');
  console.log('written:', out.replace(ROOT + '\\', ''));
  n++;
}
console.log(`\ndone: ${n} pages`);
