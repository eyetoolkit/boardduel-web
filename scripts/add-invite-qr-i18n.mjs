/**
 * boardduel · 邀请卡引擎迁移后的 QR 提示文案键（2026-10-29）
 * ----------------------------------------------------------------
 * 背景：分享卡引擎收敛到 fe-shared/invite-card.mjs 后，弹窗二维码
 *   提示拆成两行（qrMain / qrSub）。原先只有一整个 bg_share_qr_hint
 *   （内含 HTML），引擎用 textContent 填充，不能塞 HTML —— 补两个纯文本键。
 *
 * 🔴 走脚本不手改 JSON：6 语手改必漏一个语种，漏掉的静默露英文。
 *    幂等：已存在的键跳过。
 *
 * 用法：node scripts/add-invite-qr-i18n.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = join(ROOT, 'public', 'i18n');
const DRY = process.argv.includes('--dry');

const T = {
  en: {
    bg_share_qr_main: 'Scan or tap the link',
    bg_share_qr_sub: 'Invite a friend to your board',
  },
  zh: {
    bg_share_qr_main: '扫码或点链接',
    bg_share_qr_sub: '邀请好友来你的棋盘',
  },
  ja: {
    bg_share_qr_main: 'QRスキャンかリンクをタップ',
    bg_share_qr_sub: '友人をボードに招待しよう',
  },
  de: {
    bg_share_qr_main: 'Code scannen oder Link antippen',
    bg_share_qr_sub: 'Lade einen Freund zu deinem Brett ein',
  },
  es: {
    bg_share_qr_main: 'Escanea o toca el enlace',
    bg_share_qr_sub: 'Invita a un amigo a tu tablero',
  },
  fr: {
    bg_share_qr_main: 'Scannez ou touchez le lien',
    bg_share_qr_sub: 'Invitez un ami à votre plateau',
  },
};

let added = 0, skipped = 0;
for (const [lang, kv] of Object.entries(T)) {
  const p = join(BASE, `${lang}.json`);
  const dict = JSON.parse(readFileSync(p, 'utf8'));
  if (!dict.bg || typeof dict.bg !== 'object') throw new Error(`${lang}.json 缺 bg 命名空间`);
  for (const [k, v] of Object.entries(kv)) {
    const cur = dict.bg[k];
    if (typeof cur === 'string' && cur.trim()) { skipped++; continue; }
    dict.bg[k] = v;
    added++;
  }
  if (!DRY) writeFileSync(p, JSON.stringify(dict, null, 2) + '\n', 'utf8');
  console.log(`${lang}: ✓`);
}
console.log(DRY ? `[dry] 将新增 ${added} 个键，跳过 ${skipped} 个已有键` : `✓ 新增 ${added} 个键，跳过 ${skipped} 个已有键`);
