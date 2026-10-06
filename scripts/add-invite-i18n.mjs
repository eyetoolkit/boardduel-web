/**
 * 补 i18n key：好友房邀请卡片（2026-10-06）
 * 新增 3 个：bg_invite_close / bg_invite_room_code / bg_invite_copy_code
 * 已存在不动：bg_gomoku_invite / bg_gomoku_invite_qr_hint / bg_invite_copy / bg_invite_note
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'D:/GAME/boardduel-web/public/i18n';

const T = {
  en: { bg_invite_close: 'Close', bg_invite_room_code: 'Room code', bg_invite_copy_code: 'Copy' },
  zh: { bg_invite_close: '关闭', bg_invite_room_code: '房间码', bg_invite_copy_code: '复制' },
  ja: { bg_invite_close: '閉じる', bg_invite_room_code: 'ルームコード', bg_invite_copy_code: 'コピー' },
  es: { bg_invite_close: 'Cerrar', bg_invite_room_code: 'Código de sala', bg_invite_copy_code: 'Copiar' },
  fr: { bg_invite_close: 'Fermer', bg_invite_room_code: 'Code de salon', bg_invite_copy_code: 'Copier' },
  de: { bg_invite_close: 'Schließen', bg_invite_room_code: 'Raumcode', bg_invite_copy_code: 'Kopieren' },
};

for (const [lang, kv] of Object.entries(T)) {
  const f = join(BASE, `${lang}.json`);
  let raw = readFileSync(f, 'utf8');
  // 去掉 BOM（如果有）
  raw = raw.replace(/^\uFEFF/, '');
  const j = JSON.parse(raw);

  const flat = j.bg || (j.bg = {});
  let added = 0;
  for (const [k, v] of Object.entries(kv)) {
    if (!(k in flat)) { flat[k] = v; added++; }
  }

  // 保持 2 空格缩进 + 末尾换行，与现有文件风格一致
  const out = JSON.stringify(j, null, 2) + '\n';
  writeFileSync(f, out, 'utf8');
  console.log(`  ${lang}.json  新增 ${added} 个 key`);
}
console.log('done');
