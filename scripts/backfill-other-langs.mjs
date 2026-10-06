/**
 * 补齐其余语种的 key 缺口（2026-10-06）
 *
 * en.json 回填后成为最完整基准（2454），反而暴露出 zh 缺 34 个 ——
 * checkers 整组 18 个只有日语有译文，中文站会直接漏显示。
 * 其余语种各缺 5-6 个（match / player.player.* / gomoku.How_to_play / contact.Title）。
 *
 * 与 backfill-en.mjs 同样排除 BOM 污染伪 key。
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
const readRaw = (l) => JSON.parse(readFileSync(`${BASE}/${l}.json`, 'utf8').replace(/^\uFEFF/, ''));
const load = (l) => flat(readRaw(l));

const en = load('en');
const validKeys = Object.keys(en).filter((k) => !k.includes(BOM));

const setPath = (obj, dotted, value) => {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
};

// ── 各语种译文 ────────────────────────────────────────────────────
const T = {
  zh: {
    '404.title_msg': '页面未找到',
    '404.message': '你访问的页面不存在或已被删除。',
    'home.boardduel_name': 'BoardDuel · 棋类游戏',
    'home.mathduel_name': 'MathDuel · 数学对决',
    'home.memoryduel_name': 'MemoryDuel · 知识对战',
    'home.badge_classic': '★ 经典',
    'home.badge_hot': '★ 热门',
    'home.badge_new': '★ 新品',
    'game_chess.meta': '♞ · 三档 AI',
    'game_tictactoe.meta': '⭕✖️ · 经典 3×3',
    'game_gomoku.meta': '⚫⚪ · 经典 15×15',
    'game_othello.meta': '⚫⚪ · 翻面棋',
    'game_connect4.meta': '🔴🔵 · 重力落子',
    'game_checkers.meta': '⛀ · 强制吃子',
    'gomoku.How_to_play': '玩法说明',
    'contact.Title': '联系我们 · BoardDuel',
    'checkers.black': '黑子',
    'checkers.white': '白子',
    'checkers.black_turn': '轮到黑方',
    'checkers.white_turn': '轮到白方',
    'checkers.your_turn': '该你了',
    'checkers.you_black': '你是 ⛀，先手',
    'checkers.you_white': '你是 ⛂',
    'checkers.you_win': '你赢了！',
    'checkers.opponent_win': '对手获胜！',
    'checkers.draw': '平局！',
    'checkers.game_over': '对局结束',
    'checkers.cpu_thinking': 'AI 思考中…',
    'checkers.waiting': '等待对手…',
    'checkers.restart': '再来一局',
    'checkers.select_piece': '选择要移动的棋子',
    'checkers.multi_capture': '连续吃子！',
    'checkers.jump_capture': '漂亮的跳吃！',
    'checkers.king_promoted': '升变为王！',
  },
  ja: {
    'match.matchmaking': '実際の選手を探しています…',
    'player.player.player1': 'プレイヤー 1',
    'player.player.player2': 'プレイヤー 2',
    'player.player.you_tag': '（あなた）',
    'gomoku.How_to_play': '遊び方',
    'contact.Title': 'お問い合わせ · BoardDuel',
  },
  es: {
    'match.matchmaking': 'Buscando un rival real…',
    'player.player.player1': 'Jugador 1',
    'player.player.player2': 'Jugador 2',
    'player.player.you_tag': '(tú)',
    'gomoku.How_to_play': 'Cómo se juega',
    'contact.Title': 'Contáctanos · BoardDuel',
  },
  fr: {
    'match.matchmaking': 'Recherche d’un joueur…',
    'player.player.player1': 'Joueur 1',
    'player.player.player2': 'Joueur 2',
    'player.player.you_tag': '(vous)',
    'gomoku.How_to_play': 'Comment jouer',
    'contact.Title': 'Contact · BoardDuel',
  },
  de: {
    'match.matchmaking': 'Suche einen echten Gegner…',
    'player.player.player1': 'Spieler 1',
    'player.player.player2': 'Spieler 2',
    'player.player.you_tag': '(du)',
    'gomoku.How_to_play': 'Spielanleitung',
    'contact.Title': 'Kontakt · BoardDuel',
  },
};

// ── 校验 + 写入 ───────────────────────────────────────────────────
let totalAdded = 0;
for (const [lang, dict] of Object.entries(T)) {
  const raw = readRaw(lang);
  const cur = flat(raw);
  const need = validKeys.filter((k) => !(k in cur));
  const toAdd = Object.keys(dict).filter((k) => need.includes(k));

  const unknown = Object.keys(dict).filter((k) => !validKeys.includes(k));
  if (unknown.length) {
    console.log(`⚠️  ${lang}: 手译表含 en.json 不存在的 key（跳过）: ${unknown.join(', ')}`);
  }

  for (const [k, v] of Object.entries(dict)) {
    if (need.includes(k)) { setPath(raw, k, v); totalAdded++; }
  }

  writeFileSync(`${BASE}/${lang}.json`, JSON.stringify(raw, null, 2) + '\n', 'utf8');

  const after = load(lang);
  const still = validKeys.filter((k) => !(k in after));
  console.log(`  ${lang}: 写入 ${toAdd.length} 个 → 现有 ${Object.keys(after).length}，仍缺 ${still.length}${still.length ? '  ' + still.slice(0, 5).join(', ') : ''}`);
}

console.log(`\n合计写入 ${totalAdded} 个 key`);

// 全语种最终复核
console.log('\n=== 最终各语种 ===');
for (const l of ['en', 'zh', 'ja', 'es', 'fr', 'de']) {
  const d = load(l);
  const miss = validKeys.filter((k) => !(k in d));
  console.log(`  ${l}: ${Object.keys(d).length} key   缺 ${miss.length}`);
}