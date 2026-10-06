/**
 * 补分享卡片的 i18n key（2026-10-06）
 * 新增 8 个：bg_share_title / bg_share_close / bg_share_qr_hint /
 *          bg_share_link / bg_share_copy / bg_share_save /
 *          bg_share_system / bg_share_save_image / bg_share_result
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'D:/GAME/boardduel-web/public/i18n';

const T = {
  en: {
    bg_share_title: 'Share',
    bg_share_close: 'Close',
    bg_share_qr_hint: '📱 <b>Scan or tap the link</b><br>Invite a friend to your board',
    bg_share_link: 'Share link',
    bg_share_copy: '📋 Copy',
    bg_share_save: '⬇ Save Image',
    bg_share_system: '💬 Share',
    bg_share_save_image: '🖼 Save invite card',
    bg_share_result: 'Share result',
  },
  zh: {
    bg_share_title: '分享',
    bg_share_close: '关闭',
    bg_share_qr_hint: '📱 <b>扫码或点链接</b><br>邀请好友来同一张棋盘',
    bg_share_link: '分享链接',
    bg_share_copy: '📋 复制',
    bg_share_save: '⬇ 保存图片',
    bg_share_system: '💬 分享',
    bg_share_save_image: '🖼 保存邀请卡',
    bg_share_result: '分享战绩',
  },
  ja: {
    bg_share_title: '共有',
    bg_share_close: '閉じる',
    bg_share_qr_hint: '📱 <b>QR またはリンクをタップ</b><br>友人を同じ盤に招待',
    bg_share_link: '共有リンク',
    bg_share_copy: '📋 コピー',
    bg_share_save: '⬇ 画像を保存',
    bg_share_system: '💬 共有',
    bg_share_save_image: '🖼 招待カードを保存',
    bg_share_result: '結果を共有',
  },
  es: {
    bg_share_title: 'Compartir',
    bg_share_close: 'Cerrar',
    bg_share_qr_hint: '📱 <b>Escanea o toca el enlace</b><br>Invita a un amigo a tu tablero',
    bg_share_link: 'Enlace para compartir',
    bg_share_copy: '📋 Copiar',
    bg_share_save: '⬇ Guardar imagen',
    bg_share_system: '💬 Compartir',
    bg_share_save_image: '🖼 Guardar tarjeta',
    bg_share_result: 'Compartir resultado',
  },
  fr: {
    bg_share_title: 'Partager',
    bg_share_close: 'Fermer',
    bg_share_qr_hint: '📱 <b>Scannez ou touchez le lien</b><br>Invitez un ami sur votre plateau',
    bg_share_link: 'Lien de partage',
    bg_share_copy: '📋 Copier',
    bg_share_save: '⬇ Enregistrer l’image',
    bg_share_system: '💬 Partager',
    bg_share_save_image: '🖼 Enregistrer la carte',
    bg_share_result: 'Partager le résultat',
  },
  de: {
    bg_share_title: 'Teilen',
    bg_share_close: 'Schließen',
    bg_share_qr_hint: '📱 <b>Scannen oder Link antippen</b><br>Lade einen Freund auf dein Brett ein',
    bg_share_link: 'Freigabelink',
    bg_share_copy: '📋 Kopieren',
    bg_share_save: '⬇ Bild speichern',
    bg_share_system: '💬 Teilen',
    bg_share_save_image: '🖼 Einladungskarte speichern',
    bg_share_result: 'Ergebnis teilen',
  },
};

const setPath = (obj, dotted, value) => {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
};

for (const [lang, kv] of Object.entries(T)) {
  const f = join(BASE, `${lang}.json`);
  const j = JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
  let n = 0;
  for (const [k, v] of Object.entries(kv)) { setPath(j, 'bg.' + k, v); n++; }
  writeFileSync(f, JSON.stringify(j, null, 2) + '\n', 'utf8');
  console.log(`  ${lang}.json  +${n}`);
}
console.log('done');