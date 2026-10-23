/**
 * i18n 硬编码英文 lint — 2026-10-23 第三批（审计项 ⑭）
 *
 * 背景：全站 8 款游戏页面曾有 65 处 toast()/textContent 硬编码英文，
 * 切中文/日文等非英语站时这些提示仍是英文。已全部迁移到 bg_common_* 词条，
 * 本脚本守门：新增硬编码英文会被抓出来。
 *
 * 规则：src/games/<game>/index.ts 里 toast('英文') / textContent = '英文' 报警。
 * 排除：注释行、window.t()/t() 调用行、内部协议串（WS type/模式名/className）。
 * 退出码：有命中 exit 1（可挂 CI）；无误报漏判由排除清单兜。
 *
 * 运行：node _tools/i18n-lint.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'src/games';
const files = [];
for (const g of readdirSync(dir)) {
  const p = join(dir, g, 'index.ts');
  try { readFileSync(p); files.push(p); } catch { /* 非游戏目录 */ }
}

// 规则：toast('...') / textContent = '...' / innerHTML 里出现 [A-Za-z]{4,} 的英文句子
const pats = [
  /toast\(\s*'(?:[^'\\]|\\.)*[A-Za-z]{4,}(?:[^'\\]|\\.)*'/g,
  /toast\(\s*"(?:[^"\\]|\\.)*[A-Za-z]{4,}(?:[^"\\]|\\.)*"/g,
  /textContent\s*=\s*'(?:[^'\\]|\\.)*[A-Za-z]{4,}(?:[^'\\]|\\.)*'/g,
  /textContent\s*=\s*"(?:[^"\\]|\\.)*[A-Za-z]{4,}(?:[^"\\]|\\.)*"/g,
];

let total = 0;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  const hits = [];
  lines.forEach((ln, i) => {
    // 跳过注释行和 window.t/t( 调用行
    const trimmed = ln.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
    if (/window\.t\(|\bt\(/.test(ln) && !/toast\(/.test(ln)) return;
    for (const pat of pats) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(ln)) !== null) {
        const s = m[0];
        // 排除 console/debug/ws type/内部协议串
        if (/console\.|sendWs|type:|'ai'|'pass'|'online'|'ranked'|'score'|'resign'|'timeout'|'start'|'state'|'chat'|'draw'|'win'|'loss'|'place'|'move'|'over'|'medium'|'easy'|'hard'|'friend'|'human'|'count'|'black'|'white'|'red'|'teal'|'is-win'|'is-loss'|'is-draw'|'is-open'|'is-mine'|'is-emoji'|'go-chat|'md-/.test(s)) continue;
        hits.push(`${i + 1}: ${s.slice(0, 110)}`);
      }
    }
  });
  if (hits.length) {
    total += hits.length;
    console.log(`\n== ${f} (${hits.length}) ==`);
    hits.slice(0, 12).forEach((h) => console.log('  ' + h));
    if (hits.length > 12) console.log(`  ... +${hits.length - 12} more`);
  }
}
console.log(`\nTOTAL: ${total}`);
process.exit(total > 0 ? 1 : 0);
