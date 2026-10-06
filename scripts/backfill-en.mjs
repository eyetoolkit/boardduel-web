/**
 * 回填 en.json 缺失的 96 个 key（2026-10-06）
 *
 * 背景：en.json 是 6 个语种里 key 最少的（2358），比 de/es/fr 少 ~90 个。
 *  boardduel.com 主站是英文站，缺 key 的位置会把 key 名直接泄漏到页面
 *  （用户看到 "nav.games" 而不是 "Games"）。
 *
 * ⚠️ 不能从 de/es/fr 直接搬 —— 那些是德/西/法文，搬进英文站等于把
 *   英文站变成德文站。下面全部按 en.json 现有风格手译，基准：
 *     nav.home="Home" / player.white="White" / gomoku.waiting="Waiting for opponent..."
 *     gomoku.your_turn="Your turn" / gomoku.you_win="You win!" / gomoku.restart="Play Again"
 *
 * 排除 ja.json 里因 BOM 污染产生的 9 个伪 key（键名带 U+FEFF、值为日文），
 * 那是数据污染不是缺失，不进英文站。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'D:/GAME/boardduel-web/public/i18n';
const BOM = '\uFEFF';

const flat = (o, p = '', out = {}) => {
  for (const [k, v] of Object.entries(o || {})) {
    const key = p ? p + '.' + k : k;
    if (v && typeof v === 'object') flat(v, key, out);
    else out[key] = v;
  }
  return out;
};
const load = (l) => flat(JSON.parse(readFileSync(`${BASE}/${l}.json`, 'utf8').replace(/^\uFEFF/, '')));

const D = {};
for (const l of ['en', 'zh', 'ja', 'es', 'fr', 'de']) D[l] = load(l);

const union = new Set(
  ['zh', 'ja', 'es', 'fr', 'de'].flatMap((l) => Object.keys(D[l])),
);
const missing = [...union].filter((k) => !(k in D.en) && !k.includes(BOM)).sort();

// ── 英文译文（按 en.json 既有风格手译）─────────────────────────────
const EN = {
  // 404
  '404.title_msg': 'Page not found',
  '404.message': 'The page you visited does not exist or has been removed.',

  // 导航
  'nav.games': 'Games',
  'nav.shop': 'Shop',
  'nav.leaderboard': 'Leaderboard',
  'nav.blog': 'Blog',
  'nav.help': 'Help',

  // 账号
  'auth.signin': 'Sign in',
  'auth.signup': 'Sign up',
  'auth.signout': 'Sign out',
  'auth.username': 'Username',
  'auth.continue': 'Continue',
  'auth.reset_password': 'Reset password',

  // 通用
  'common.all': 'All',
  'common.delete': 'Delete',
  'common.filter': 'Filter',
  'common.next': 'Next',
  'common.none': 'None',
  'common.save': 'Save',
  'common.search': 'Search',
  'common.select': 'Select',

  // 错误
  'error.conflict': 'Conflict',
  'error.forbidden': 'Access denied',
  'error.network': 'Network error',
  'error.not_found': 'Not found',
  'error.server': 'Server error',
  'error.timeout': 'Request timed out',
  'error.unauthorized': 'Not authorized',
  'error.unknown': 'Unknown error',
  'error.validation': 'Invalid data',

  // 难度
  'difficulty.expert': 'Expert',

  // 游戏模式
  'games.ai': 'vs AI',
  'games.engine': 'vs AI',
  'games.friend': 'Friend Room',
  'games.pass': 'Pass & Play',
  'games.random': 'Random Match',
  'games.solo': 'Solo Practice',
  'games.tournament': 'Tournament',

  // 首页
  'home.heading': 'BoardDuel · Classic Duels',
  'home.intro': 'Challenge board game lovers worldwide — free, no sign-up, no ads.',
  'home.cta_start': 'Start a duel',
  'home.boardduel_name': 'BoardDuel · Board Games',
  'home.mathduel_name': 'MathDuel · Math Duels',
  'home.memoryduel_name': 'MemoryDuel · Knowledge Battles',
  'home.badge_classic': '★ Classic',
  'home.badge_hot': '★ HOT',
  'home.badge_new': '★ NEW',

  // 游戏卡片 meta
  'game_chess.meta': '♞ · 3 AI levels',
  'game_gomoku.meta': '⚫⚪ · Classic 15×15',
  'game_tictactoe.meta': '⭕✖️ · Classic 3×3',
  'game_othello.meta': '⚫⚪ · Flip game',
  'game_connect4.meta': '🔴🔵 · Gravity drop',
  'game_checkers.meta': '⛀ · Mandatory capture',

  // 匹配 / 玩家
  'match.matchmaking': 'Finding a real player…',
  'player.player.player1': 'Player 1',
  'player.player.player2': 'Player 2',
  'player.player.you_tag': '(you)',

  // 排行
  'rank.title': 'Leaderboard · BoardDuel',
  'rank.subtitle': 'See where you rank among players worldwide.',
  'rank.your_rank': 'Your rank',
  'rank.top10': 'Top 10%',
  'rank.season_ends': 'Season ends',
  'rank.refresh': 'Refresh',

  // 统计
  'stats.play': 'Games played',
  'stats.win_rate': 'Win rate',
  'stats.best': 'Best result',

  // 商店
  'shop.balance': 'Current balance',
  'shop.purchase': 'Buy',
  'shop.confirm_buy': 'Confirm purchase?',
  'shop.history': 'Purchase history',
  'shop.not_enough': 'Not enough coins',

  // 教师端
  'teacher.title': 'For Teachers · BoardDuel',
  'teacher.subtitle': 'Create classes, invite students, and track their results.',
  'teacher.create_class': 'Create class',
  'teacher.invite_code': 'Invite code',
  'teacher.no_class': 'No classes yet',

  // 联系 / 五子棋说明
  'contact.Title': 'Contact Us · BoardDuel',
  'gomoku.How_to_play': 'How to play',

  // checkers（对齐 gomoku/chess 既有措辞）
  'checkers.black': 'Black',
  'checkers.white': 'White',
  'checkers.black_turn': "Black's turn",
  'checkers.white_turn': "White's turn",
  'checkers.your_turn': 'Your turn',
  'checkers.you_black': 'You are ⛀, move first',
  'checkers.you_white': 'You are ⛂',
  'checkers.you_win': 'You win!',
  'checkers.opponent_win': 'Opponent wins!',
  'checkers.draw': 'Draw!',
  'checkers.game_over': 'Game Over',
  'checkers.cpu_thinking': 'AI is thinking...',
  'checkers.waiting': 'Waiting for opponent...',
  'checkers.restart': 'Play Again',
  'checkers.select_piece': 'Select a piece to move',
  'checkers.multi_capture': 'Multi-capture!',
  'checkers.jump_capture': 'Nice jump capture!',
  'checkers.king_promoted': 'Promoted to King!',
};

// ── 校验：手译表是否覆盖全部缺失 key ──────────────────────────────
const covered = Object.keys(EN);
const notCovered = missing.filter((k) => !(k in EN));
const extra = covered.filter((k) => !missing.includes(k));

console.log(`缺失 ${missing.length} 个（BOM 污染伪 key 已排除）`);
console.log(`手译表 ${covered.length} 条`);
if (notCovered.length) {
  console.log(`\n❌ 仍未覆盖 ${notCovered.length} 个：`);
  notCovered.forEach((k) => console.log(`   ${k}   (zh="${D.zh[k] ?? '—'}")`));
}
if (extra.length) {
  console.log(`\n⚠️ 手译表里有多余 key（en.json 已有）：${extra.join(', ')}`);
}
if (notCovered.length) process.exit(1);

// ── 写回 en.json（保持原 JSON 结构与缩进）────────────────────────
const enRaw = JSON.parse(readFileSync(`${BASE}/en.json`, 'utf8').replace(/^\uFEFF/, ''));

const setPath = (obj, dotted, value) => {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
};

let n = 0;
for (const [k, v] of Object.entries(EN)) {
  setPath(enRaw, k, v);
  n++;
}

writeFileSync(`${BASE}/en.json`, JSON.stringify(enRaw, null, 2) + '\n', 'utf8');
console.log(`\n✅ 已写入 en.json：${n} 个 key`);

// 复核
const after = load('en');
const stillMissing = [...union].filter((k) => !k.includes(BOM) && !(k in after));
console.log(`复核：en.json 现有 ${Object.keys(after).length} key，仍缺 ${stillMissing.length} 个`);
if (stillMissing.length) {
  stillMissing.forEach((k) => console.log(`   ${k}`));
} else {
  console.log('✅ 全部 key 齐了');
}