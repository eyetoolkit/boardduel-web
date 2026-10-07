/**
 * 一次性脚本：为 8 款游戏页注入 JSON-LD 结构化数据（schema.org/VideoGame）。
 *
 * 2026-10-07 · 阶段 2
 *
 * ## 为什么不手写进每个 HTML
 * 8 个文件 × 2 处注入（VideoGame + 缺 og:image 的补 meta），手写必然漏或不一致。
 * 生成器保证：字段结构 100% 一致，且**元数据直接取自各页已有的 title/description/canonical**
 * —— 不另编一套内容，避免 JSON-LD 与页面可见内容不一致（Google 会判为垃圾数据）。
 *
 * ## 🔴 红线：不写 aggregateRating
 * Google 明确规定 `aggregateRating` 只能标记**真实存在且对用户可见**的用户评分，
 * 自造评分数据会导致 rich result 被拒甚至处罚。
 * papergames 有 6,790 条真实评价所以能写；我们目前**零评价** → 一个字段都不能写。
 *
 * 正确路径是：先做评价功能 → 积累到一定量 → 再按真实数据标注。本脚本刻意留出该字段注释位。
 *
 * ## 注入位置
 * 紧跟 `<link rel="canonical">` 之后（Google 官方建议 JSON-LD 放 head 内，
 * 位置不影响解析，但紧跟 canonical 便于人工核查）。
 *
 * 用法：cd boardduel-web && node scripts/gen-jsonld.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/* ── 8 款游戏的元数据：description 与 URL 均取自各页现有内容，不另编 ──
   genre 走 schema.org 的 GameType 枚举；isFamilyFriendly 与我们的实际定位一致。 */
const GAMES = {
  gomoku: {
    name: 'Gomoku',
    genre: ['StrategyGame', 'BoardGame'],
    desc: '15×15 freestyle gomoku on BoardDuel. First to connect five marks in a row wins. Play a ranked online duel, take on the engine at three levels, or share one screen in pass & play.',
  },
  go: {
    name: 'Go',
    genre: ['StrategyGame', 'BoardGame'],
    desc: 'Play Go online on BoardDuel at9×9, 13×13 or 19×19 with Chinese area scoring and a byoyomi clock. Place stones, surround to capture, pass to end and score.',
  },
  chess: {
    name: 'Chess',
    genre: ['StrategyGame', 'BoardGame'],
    desc: 'Full chess on BoardDuel: castling, en passant and promotion all standard. Three engine levels powered by alpha-beta search, plus ranked online play.',
  },
  xiangqi: {
    name: 'Xiangqi',
    genre: ['StrategyGame', 'BoardGame'],
    desc: 'Play xiangqi (Chinese chess) on BoardDuel with the complete rule set: the river, the palace and the flying-general rule. Three engine levels, no login required.',
  },
  checkers: {
    name: 'Checkers',
    genre: ['StrategyGame', 'BoardGame'],
    desc: 'English draughts on BoardDuel. Jump your pieces, capture the board and crown a king on the far rank. Three engine levels to play against.',
  },
  connect4: {
    name: 'Connect 4',
    genre: ['StrategyGame', 'BoardGame'],
    desc: 'Connect 4 on BoardDuel: drop discs into a 7-column, 6-row grid and connect four in a row. Three AI levels to play against.',
  },
  reversi: {
    name: 'Othello',
    genre: ['StrategyGame', 'BoardGame'],
    desc: 'Reversi, also known as Othello, on BoardDuel. Place a disc and flip every opposing disc you bracket. Three engine levels.',
  },
  tictactoe: {
    name: 'Tic-Tac-Toe',
    genre: ['StrategyGame', 'BoardGame'],
    desc: 'Tic-Tac-Toe on BoardDuel: get three in a row on a 3×3 grid. The engine plays minimax and is genuinely optimal, or share one screen in pass & play.',
  },
};

/** 取出页面现有 description，保证 JSON-LD 与可见内容一致 */
function readMeta(html, re) {
  const m = html.match(re);
  return m ? m[1].replace(/&amp;/g, '&').trim() : '';
}

/** og.jpg 是否存在（静态资源在 public/ 下，构建时复制到 dist） */
function hasOgImage(slug) {
  return fs.existsSync(path.join(ROOT, 'public', 'games', slug, 'og.jpg'));
}

/** 构造 VideoGame JSON-LD 对象 */
function buildVideoGame(slug, cfg, pageDesc, canonical) {
  const obj = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: `${cfg.name} — BoardDuel`,
    url: canonical || `https://boardduel.com/games/${slug}/`,
    description: pageDesc || cfg.desc,
    playMode: 'MultiPlayer',
    applicationCategory: 'BoardGame',
    genre: cfg.genre,
    inLanguage: 'en',
    operatingSystem: 'Any',
    isFamilyFriendly: true,
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
    // 🔴 刻意不放aggregateRating —— 需先有真实评价功能，见文件头红线说明
    publisher: { '@type': 'Organization', name: 'BoardDuel', url: 'https://boardduel.com/' },
  };

  // 🔴 image 只在文件真实存在时才写。
  // 缺失时写一个 404 URL 等于给 Google 一个坏链接 —— 结构化数据的价值在于可信，
  // 一条坏 image 可能让整条VideoGame 被降权。不写 image 仍是合法且有价值的 VideoGame。
  if (hasOgImage(slug)) {
    // 放在 description 之后，贴近其他内容字段
    const rebuilt = {};
    for (const [k, v] of Object.entries(obj)) {
      rebuilt[k] = v;
      if (k === 'description') rebuilt.image = `https://boardduel.com/games/${slug}/og.jpg`;
    }
    return rebuilt;
  }
  return obj;
}

/** 面包屑 —— 让 Google 理解层级（首页 > 游戏） */
function buildBreadcrumb(slug, cfg) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://boardduel.com/' },
      { '@type': 'ListItem', position: 2, name: cfg.name, item: `https://boardduel.com/games/${slug}/` },
    ],
  };
}

let changed = 0;
let ldCount = 0;
let ogAdded = 0;

for (const [slug, cfg] of Object.entries(GAMES)) {
  const file = path.join(ROOT, 'games', slug, 'index.html');
  if (!fs.existsSync(file)) { console.log(`  skip (缺文件): ${slug}`); continue; }

  let html = fs.readFileSync(file, 'utf8');
  const before = html;

  // 幂等：先清掉上次注入的（避免重复执行叠加）。
  // 🔴 og:image 这组 meta 也必须一起清 —— 否则文件被删后重跑脚本会留下指向 404 的破图。
  html = html.replace(/<script type="application\/ld\+json" data-bd-jsonld="(?:videoGame|breadcrumb)">[\s\S]*?<\/script>\n?/g, '');
  html = html.replace(/<meta property="og:image[^"]*"[^>]*>\n?/g, '');
  html = html.replace(/<meta name="twitter:image"[^>]*>\n?/g, '');

  const pageDesc = readMeta(html, /<meta name="description" content="([^"]*)"/);
  const canonical = readMeta(html, /<link rel="canonical" href="([^"]*)"/);

  // ── 注入 JSON-LD（紧跟 canonical）──
  const anchor = html.match(/<link rel="canonical"[^>]*>/);
  if (anchor) {
    const at = html.indexOf(anchor[0]) + anchor[0].length;
    const block =
      `<script type="application/ld+json" data-bd-jsonld="videoGame">\n` +
      `  ${JSON.stringify(buildVideoGame(slug, cfg, pageDesc, canonical), null, 2).replace(/\n/g, '\n  ')}\n` +
      `</script>\n` +
      `<script type="application/ld+json" data-bd-jsonld="breadcrumb">\n` +
      `  ${JSON.stringify(buildBreadcrumb(slug, cfg), null, 2).replace(/\n/g, '\n  ')}\n` +
      `</script>`;
    html = html.slice(0, at) + '\n' + block + html.slice(at);
    ldCount += 2;
  } else {
    console.log(`  ⚠️ ${slug}: 找不到 canonical 锚点，跳过注入`);
  }

  // ── 顺带补 og:image（8 款游戏页原本都没有这组 meta）──
  // 🔴 同样只在文件真实存在时才补：og:image 指向 404 会让社交分享显示破图，
  // 且与 JSON-LD 保持一致（不存在就都不写）。
  if (!/property="og:image"/.test(html) && hasOgImage(slug)) {
    const image = `https://boardduel.com/games/${slug}/og.jpg`;
    const m = /<meta property="og:description"[^>]*>/.exec(html);
    if (m) {
      const at = html.indexOf(m[0]) + m[0].length;
      html = html.slice(0, at) + '\n' +
        `<meta property="og:image" content="${image}">\n` +
        `<meta property="og:image:width" content="2560">\n` +
        `<meta property="og:image:height" content="1440">\n` +
        `<meta name="twitter:image" content="${image}">` +
        html.slice(at);
      ogAdded++;
    }
  }

  if (html !== before) {
    fs.writeFileSync(file, html, 'utf8');
    changed++;
    console.log(`  ✅ ${slug}`);
  }
}

console.log(`\ndone. 改动文件 ${changed} 个 · 注入 JSON-LD ${ldCount} 条（VideoGame+Breadcrumb）· 补og:image ${ogAdded} 处`);
console.log('🔴 未写aggregateRating —— 需先有真实评价功能（见文件头红线）');
