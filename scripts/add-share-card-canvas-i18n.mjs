/**
 * boardduel · 分享卡 Canvas 文案 i18n 键（2026-10-26 第 2 批）
 * ----------------------------------------------------------------
 * 背景：src/games/share-card.ts 在 Canvas 里硬编码了 18 处英文
 *   （Scan to play the same board / Play a free game / Victory /
 *     WIN / Moves / Time / Site …），切到中文/日文/德语后分享出去
 *   的成绩卡仍然是英文 —— 卡片是要发到站外的，英文对中文用户不友好。
 *
 * 🔴 为什么走脚本而不是手改 JSON：
 *    本仓的 public/i18n/*.json 是嵌套结构（bg 下 446 个键），
 *    6 个语言文件手改必然漏一个语种，而漏掉的语种会静默显示英文。
 *    本脚本幂等：已存在的键跳过，可重复执行。
 *
 * 🔴 键名前缀沿用既有惯例 bg.bg_share_*（同族已有 bg_share_title 等 9 个）。
 *
 * 用法：node scripts/add-share-card-canvas-i18n.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = join(ROOT, 'public', 'i18n');
const DRY = process.argv.includes('--dry');

const T = {
  en: {
    bg_share_scan_board: 'Scan to play the same board',
    bg_share_free_nosignup: 'Free to play — no sign-up',
    bg_share_cta_play: 'Play a free game',
    bg_share_invite_title: 'Invite a friend',
    bg_share_room_code: 'Room code',
    bg_share_stat_board: 'Board',
    bg_share_stat_status: 'Status',
    bg_share_stat_waiting: 'Waiting',
    bg_share_stat_price: 'Price',
    bg_share_stat_free: 'Free',
    bg_share_result_win: 'Victory',
    bg_share_result_good: 'Good game',
    bg_share_big_win: 'WIN',
    bg_share_big_loss: 'LOSS',
    bg_share_win_sub: 'You took the board',
    bg_share_loss_sub: 'Better luck next time',
    bg_share_stat_moves: 'Moves',
    bg_share_stat_time: 'Time',
    bg_share_stat_site: 'Site',
    bg_share_copied: 'Link copied',
    bg_share_copy_failed: 'Copy failed',
    bg_share_saved: 'Image saved',
  },
  zh: {
    bg_share_scan_board: '扫码玩同一张棋盘',
    bg_share_free_nosignup: '免费玩，无需注册',
    bg_share_cta_play: '免费玩一局',
    bg_share_invite_title: '邀请好友',
    bg_share_room_code: '房间码',
    bg_share_stat_board: '棋盘',
    bg_share_stat_status: '状态',
    bg_share_stat_waiting: '等待中',
    bg_share_stat_price: '价格',
    bg_share_stat_free: '免费',
    bg_share_result_win: '胜利',
    bg_share_result_good: '好棋',
    bg_share_big_win: '胜利',
    bg_share_big_loss: '惜败',
    bg_share_win_sub: '你赢下了这盘',
    bg_share_loss_sub: '下次好运',
    bg_share_stat_moves: '步数',
    bg_share_stat_time: '用时',
    bg_share_stat_site: '站点',
    bg_share_copied: '链接已复制',
    bg_share_copy_failed: '复制失败',
    bg_share_saved: '图片已保存',
  },
  ja: {
    bg_share_scan_board: '同じ盤で遊ぶ',
    bg_share_free_nosignup: '登録不要・無料で遊べます',
    bg_share_cta_play: '無料で遊ぶ',
    bg_share_invite_title: '友人を招待',
    bg_share_room_code: 'ルームコード',
    bg_share_stat_board: '盤',
    bg_share_stat_status: '状態',
    bg_share_stat_waiting: '待機中',
    bg_share_stat_price: '価格',
    bg_share_stat_free: '無料',
    bg_share_result_win: '勝利',
    bg_share_result_good: '良い勝負',
    bg_share_big_win: '勝利',
    bg_share_big_loss: '敗北',
    bg_share_win_sub: '見事に勝ち取った',
    bg_share_loss_sub: '次回の健闘を',
    bg_share_stat_moves: '手数',
    bg_share_stat_time: 'タイム',
    bg_share_stat_site: 'サイト',
    bg_share_copied: 'リンクをコピーしました',
    bg_share_copy_failed: 'コピーに失敗しました',
    bg_share_saved: '画像を保存しました',
  },
  es: {
    bg_share_scan_board: 'Escanea para jugar el mismo tablero',
    bg_share_free_nosignup: 'Juega gratis, sin registro',
    bg_share_cta_play: 'Juega una partida gratis',
    bg_share_invite_title: 'Invita a un amigo',
    bg_share_room_code: 'Código de sala',
    bg_share_stat_board: 'Tablero',
    bg_share_stat_status: 'Estado',
    bg_share_stat_waiting: 'Esperando',
    bg_share_stat_price: 'Precio',
    bg_share_stat_free: 'Gratis',
    bg_share_result_win: 'Victoria',
    bg_share_result_good: 'Buena partida',
    bg_share_big_win: 'VICTORIA',
    bg_share_big_loss: 'DERROTA',
    bg_share_win_sub: 'Ganaste el tablero',
    bg_share_loss_sub: 'Más suerte la próxima vez',
    bg_share_stat_moves: 'Jugadas',
    bg_share_stat_time: 'Tiempo',
    bg_share_stat_site: 'Sitio',
    bg_share_copied: 'Enlace copiado',
    bg_share_copy_failed: 'Error al copiar',
    bg_share_saved: 'Imagen guardada',
  },
  fr: {
    bg_share_scan_board: 'Scannez pour jouer le même plateau',
    bg_share_free_nosignup: 'Jouez gratuitement, sans inscription',
    bg_share_cta_play: 'Jouez une partie gratuite',
    bg_share_invite_title: 'Invitez un ami',
    bg_share_room_code: 'Code de la salle',
    bg_share_stat_board: 'Plateau',
    bg_share_stat_status: 'Statut',
    bg_share_stat_waiting: 'En attente',
    bg_share_stat_price: 'Prix',
    bg_share_stat_free: 'Gratuit',
    bg_share_result_win: 'Victoire',
    bg_share_result_good: 'Belle partie',
    bg_share_big_win: 'VICTOIRE',
    bg_share_big_loss: 'DÉFAITE',
    bg_share_win_sub: 'Vous avez gagné le plateau',
    bg_share_loss_sub: 'Plus de chance la prochaine fois',
    bg_share_stat_moves: 'Coups',
    bg_share_stat_time: 'Temps',
    bg_share_stat_site: 'Site',
    bg_share_copied: 'Lien copié',
    bg_share_copy_failed: 'Échec de la copie',
    bg_share_saved: 'Image enregistrée',
  },
  de: {
    bg_share_scan_board: 'Scanne, um dasselbe Brett zu spielen',
    bg_share_free_nosignup: 'Gratis spielen — ohne Anmeldung',
    bg_share_cta_play: 'Kostenlos spielen',
    bg_share_invite_title: 'Freund einladen',
    bg_share_room_code: 'Raumcode',
    bg_share_stat_board: 'Brett',
    bg_share_stat_status: 'Status',
    bg_share_stat_waiting: 'Wartend',
    bg_share_stat_price: 'Preis',
    bg_share_stat_free: 'Kostenlos',
    bg_share_result_win: 'Sieg',
    bg_share_result_good: 'Gutes Spiel',
    bg_share_big_win: 'SIEG',
    bg_share_big_loss: 'NIEDERLAGE',
    bg_share_win_sub: 'Du hast das Brett gewonnen',
    bg_share_loss_sub: 'Viel Glück beim nächsten Mal',
    bg_share_stat_moves: 'Züge',
    bg_share_stat_time: 'Zeit',
    bg_share_stat_site: 'Seite',
    bg_share_copied: 'Link kopiert',
    bg_share_copy_failed: 'Kopieren fehlgeschlagen',
    bg_share_saved: 'Bild gespeichert',
  },
};

let added = 0, skipped = 0;
for (const [lang, entries] of Object.entries(T)) {
  const f = join(BASE, `${lang}.json`);
  const j = JSON.parse(readFileSync(f, 'utf8'));
  if (!j.bg) j.bg = {};
  let langAdded = 0, langSkipped = 0;
  for (const [k, v] of Object.entries(entries)) {
    if (j.bg[k] !== undefined) { langSkipped++; skipped++; continue; }
    j.bg[k] = v;
    langAdded++; added++;
  }
  if (!DRY) writeFileSync(f, JSON.stringify(j, null, 2) + '\n', 'utf8');
  console.log(`${lang}: +${langAdded} 新增 / 跳过 ${langSkipped} / 共 ${Object.keys(j.bg).length} 键`);
}
console.log(`\n合计新增 ${added} 键，跳过 ${skipped} 已存在${DRY ? '（--dry，未写盘）' : ''}`);
