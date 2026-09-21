(function() {
/* ═══════════════════════════════════════════════════════════════
   分享卡引擎 (Share Card Engine)
   ────────────────────────────────────────────────────────────────
   用途: 在 1200×630 OG 标准画布上渲染战绩分享卡
   算法: Canvas 2D API,无依赖,纯客户端
   输入: canvas 元素 + card JSON
   输出: PNG dataURL / Blob / 文件下载
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─── 配色(对齐 /assets/css/style.css)─── */
const COLORS = {
  primary:     '#4F46E5',
  primaryDark: '#3730A3',
  primaryLight:'#818CF8',
  accent:      '#FBBF24',
  bg:          '#F9FAFB',
  bgDark:      '#1F2937',
  text:        '#111827',
  textLight:   '#6B7280',
  border:      '#E5E7EB',
  white:       '#FFFFFF',
};

const W = 1200, H = 630;

/* ─── 工具:文字自动换行(支持中文按字拆,英文按词拆)─── */
function wrapText(ctx, text, maxWidth) {
  if (!text) return [];
  const str = String(text);
  // 中文按字拆 + 英文按词拆 + 保留空格
  const tokens = [];
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch)) {
      // 单个汉字或中日韩符号
      tokens.push(ch);
      i++;
    } else if (/\s/.test(ch)) {
      // 空白字符,合并到下一个 token
      let j = i;
      while (j < str.length && /\s/.test(str[j])) j++;
      tokens.push(str.slice(i, j));
      i = j;
    } else {
      // 英文/标点,按词或连续字符
      let j = i;
      while (j < str.length && !/[\s\u4e00-\u9fa5]/.test(str[j])) j++;
      tokens.push(str.slice(i, j));
      i = j;
    }
  }

  const lines = [];
  let line = '';
  for (const tok of tokens) {
    const test = line + tok;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      lines.push(line.trim());
      line = tok.trimStart();
    } else {
      line = test;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

/* ─── 工具:绘制圆角矩形 ─── */
function roundRect(ctx, x, y, w, h, r) {
  if (r > w/2) r = w/2;
  if (r > h/2) r = h/2;
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.arcTo(x+w, y, x+w, y+r, r);
  ctx.lineTo(x+w, y+h-r);
  ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
  ctx.lineTo(x+r, y+h);
  ctx.arcTo(x, y+h, x, y+h-r, r);
  ctx.lineTo(x, y+r);
  ctx.arcTo(x, y, x+r, y, r);
  ctx.closePath();
}

/* ─── 工具:绘制带文字徽章 ─── */
function drawBadge(ctx, x, y, badge) {
  if (!badge) return;
  const icon = badge.icon || '';
  const text = badge.text || '';
  ctx.font = '700 28px "PingFang SC", "Microsoft YaHei", -apple-system, sans-serif';
  const textW = ctx.measureText(text).width;
  const padX = 18, padY = 10;
  const w = textW + (icon ? 36 : 0) + padX * 2;
  const h = 56;
  ctx.fillStyle = COLORS.accent;
  roundRect(ctx, x, y, w, h, 28);
  ctx.fill();
  if (icon) {
    ctx.font = '28px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.text;
    ctx.fillText(icon, x + padX, y + h/2 + 2);
  }
  ctx.font = '700 24px "PingFang SC", "Microsoft YaHei", -apple-system, sans-serif';
  ctx.fillStyle = COLORS.text;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX + (icon ? 36 : 0), y + h/2 + 2);
  return w;
}

/* ─── 工具:绘制游戏图标(简易,左侧 logo 区)─── */
function drawGameIcon(ctx, x, y, game) {
  const size = 80;
  ctx.save();
  // 圆角方形背景
  const grad = ctx.createLinearGradient(x, y, x+size, y+size);
  grad.addColorStop(0, COLORS.primary);
  grad.addColorStop(1, COLORS.primaryLight);
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, size, size, 18);
  ctx.fill();
  ctx.font = '900 44px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.white;
  const icon = ({ '24-game': '🃏', 'pyramid': '🔺', 'sudoku': '🔢' })[game] || '🎮';
  ctx.fillText(icon, x + size/2, y + size/2 + 4);
  ctx.restore();
}

/* ─── 工具:绘制 meta 信息(右下角)─── */
function drawMeta(ctx, x, y, meta) {
  if (!meta) return;
  const items = [];
  if (typeof meta.duration === 'number') items.push(`⏱ ${formatDuration(meta.duration)}`);
  if (typeof meta.solutions_count === 'number') items.push(`💡 ${meta.solutions_count} 解`);
  if (typeof meta.streak === 'number') items.push(`🔥 ${meta.streak} 连`);
  if (typeof meta.score === 'number') items.push(`⭐ ${meta.score} 分`);
  if (typeof meta.attempts === 'number') items.push(`🎯 ${meta.attempts} 次`);
  if (items.length === 0) return;

  ctx.font = '500 24px "PingFang SC", "Microsoft YaHei", -apple-system, sans-serif';
  ctx.fillStyle = COLORS.textLight;
  ctx.textBaseline = 'top';

  const lineHeight = 32;
  for (let i = 0; i < items.length; i++) {
    ctx.fillText(items[i], x, y + i * lineHeight);
  }
}

function formatDuration(s) {
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return sec > 0 ? `${m}分${sec}秒` : `${m}分`;
}

/* ─── 主函数: 在 canvas 上渲染卡 ─── */
function renderCard(canvas, card) {
  if (!canvas || !card) throw new Error('canvas and card are required');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context not available');

  canvas.width = W;
  canvas.height = H;

  /* ─── 背景: 渐变 + 装饰圆 ─── */
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, COLORS.primary);
  bg.addColorStop(1, COLORS.primaryDark);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 装饰圆(右下 + 左上)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.beginPath();
  ctx.arc(W + 100, H + 100, 360, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-100, -100, 280, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.beginPath();
  ctx.arc(W - 200, 100, 140, 0, Math.PI * 2);
  ctx.fill();

  /* ─── 白色卡板(主内容)─── */
  const cardX = 80, cardY = 70, cardW = W - 160, cardH = H - 140;
  ctx.fillStyle = COLORS.white;
  roundRect(ctx, cardX, cardY, cardW, cardH, 32);
  ctx.fill();

  /* ─── 左上:游戏图标 + 站名 ─── */
  drawGameIcon(ctx, cardX + 40, cardY + 40, card.game);
  ctx.fillStyle = COLORS.text;
  ctx.font = '800 28px "PingFang SC", "Microsoft YaHei", -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('数学对决 · mathduel.games', cardX + 140, cardY + 56);

  // 游戏名(右上小标签)
  const gameNames = { '24-game': '24 点', pyramid: '金字塔', sudoku: '数独' };
  const gameName = gameNames[card.game] || card.game;
  ctx.font = '600 22px "PingFang SC", "Microsoft YaHei", -apple-system, sans-serif';
  ctx.fillStyle = COLORS.primary;
  ctx.textAlign = 'right';
  ctx.fillText(gameName, cardX + cardW - 40, cardY + 48);
  ctx.textAlign = 'left';

  /* ─── 徽章(右上,游戏名下方)─── */
  if (card.badge) {
    const badgeW = drawBadge(ctx, cardX + cardW - 40 - 220, cardY + 80, card.badge);
    // 居右对齐
    // (此处简化:固定位置;实测不影响)
  }

  /* ─── 主标题(中上,大字)─── */
  const titleSize = 64;
  ctx.fillStyle = COLORS.text;
  ctx.font = `900 ${titleSize}px "PingFang SC", "Microsoft YaHei", -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const titleLines = wrapText(ctx, card.title || '', cardW - 120);
  const titleStartY = cardY + cardH * 0.36;
  if (titleLines.length === 1) {
    ctx.fillText(titleLines[0], W/2, titleStartY);
  } else if (titleLines.length === 2) {
    ctx.fillText(titleLines[0], W/2, titleStartY - 36);
    ctx.fillText(titleLines[1], W/2, titleStartY + 36);
  } else {
    // 最多显示 3 行
    ctx.fillText(titleLines[0], W/2, titleStartY - 72);
    ctx.fillText(titleLines[1], W/2, titleStartY);
    ctx.fillText(titleLines[2], W/2, titleStartY + 72);
  }

  /* ─── 副文案(中部)─── */
  if (card.subtitle) {
    ctx.font = '500 30px "PingFang SC", "Microsoft YaHei", -apple-system, sans-serif';
    ctx.fillStyle = COLORS.textLight;
    ctx.textBaseline = 'middle';
    const subLines = wrapText(ctx, card.subtitle, cardW - 120);
    const subY = titleStartY + (titleLines.length === 1 ? 60 : titleLines.length * 50 + 30);
    ctx.fillText(subLines[0], W/2, subY);
  }

  /* ─── CTA 按钮(中下)─── */
  if (card.cta) {
    const ctaText = card.cta;
    ctx.font = '700 28px "PingFang SC", "Microsoft YaHei", -apple-system, sans-serif';
    const tw = ctx.measureText(ctaText).width;
    const btnW = tw + 80, btnH = 60;
    const btnX = (W - btnW) / 2;
    const btnY = cardY + cardH - 140;
    const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY + btnH);
    grad.addColorStop(0, COLORS.primary);
    grad.addColorStop(1, COLORS.primaryLight);
    ctx.fillStyle = grad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 30);
    ctx.fill();
    ctx.fillStyle = COLORS.white;
    ctx.textBaseline = 'middle';
    ctx.fillText(ctaText, W/2, btnY + btnH/2 + 2);
  }

  /* ─── meta 信息(右下角)─── */
  if (card.meta) {
    const metaX = cardX + cardW - 200;
    const metaY = cardY + cardH - 110;
    drawMeta(ctx, metaX, metaY, card.meta);
  }

  /* ─── 网址(底部)─── */
  ctx.font = '500 20px -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = COLORS.textLight;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'center';
  const urlText = card.url || 'mathduel.games';
  ctx.fillText(urlText, W/2, H - 32);

  return canvas;
}

/* ─── 工具: 下载 canvas 为 PNG 文件 ─── */
function downloadCard(canvas, filename = 'mathduel-share.png') {
  if (!canvas) throw new Error('canvas required');
  // toBlob 是异步,但旧浏览器支持 toDataURL
  if (canvas.toBlob) {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      triggerDownload(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  } else {
    const url = canvas.toDataURL('image/png');
    triggerDownload(url, filename);
  }
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* ─── 工具: 同步导出 dataURL(便于复制到剪贴板)─── */
function toDataURL(canvas, type = 'image/png', quality = 0.92) {
  if (!canvas) throw new Error('canvas required');
  return canvas.toDataURL(type, quality);
}

/* ─── 工具: 复制到剪贴板(需要 Clipboard API + user gesture)─── */
async function copyToClipboard(canvas) {
  if (!canvas) throw new Error('canvas required');
  if (!canvas.toBlob) throw new Error('toBlob not supported');
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          resolve(true);
        } else {
          reject(new Error('Clipboard API not supported'));
        }
      } catch (e) { reject(e); }
    }, 'image/png');
  });
}

/* ─── 通用方法: 创建卡 + 渲染 + 返回 dataURL(单函数调用)─── */
function buildCardDataURL(card) {
  if (typeof document === 'undefined') throw new Error('document required (browser only)');
  const canvas = document.createElement('canvas');
  renderCard(canvas, card);
  return toDataURL(canvas);
}

/* ─── 浏览器全局导出 + CommonJS 兼容 ─── */
if (typeof window !== 'undefined') {
  window.ShareCard = { renderCard, downloadCard, toDataURL, copyToClipboard, buildCardDataURL };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderCard, downloadCard, toDataURL, copyToClipboard, buildCardDataURL,
    // 暴露给 Node 测试用的纯函数
    wrapText, formatDuration, drawBadge, drawGameIcon, drawMeta, roundRect,
    COLORS, W, H,
  };
}

/* ─── 调试用: SVG 预览(便于无 Canvas 环境下人眼审)─── */
function toSVG(card) {
  if (!card) return null;
  const gameNames = { '24-game': '24 点', pyramid: '金字塔', sudoku: '数独' };
  const gameIcons = { '24-game': '🃏', pyramid: '🔺', sudoku: '🔢' };
  const icon = gameIcons[card.game] || '🎮';
  const name = gameNames[card.game] || card.game;

  const metaItems = [];
  if (card.meta) {
    if (typeof card.meta.duration === 'number') metaItems.push(`⏱ ${formatDuration(card.meta.duration)}`);
    if (typeof card.meta.solutions_count === 'number') metaItems.push(`💡 ${card.meta.solutions_count} 解`);
    if (typeof card.meta.streak === 'number') metaItems.push(`🔥 ${card.meta.streak} 连`);
    if (typeof card.meta.score === 'number') metaItems.push(`⭐ ${card.meta.score} 分`);
    if (typeof card.meta.attempts === 'number') metaItems.push(`🎯 ${card.meta.attempts} 次`);
  }
  const metaText = metaItems.join('  ·  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="315" viewBox="0 0 1200 630" font-family="-apple-system, PingFang SC, Microsoft YaHei, sans-serif">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${COLORS.primary}"/>
      <stop offset="1" stop-color="${COLORS.primaryDark}"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${COLORS.primary}"/>
      <stop offset="1" stop-color="${COLORS.primaryLight}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1300" cy="730" r="360" fill="rgba(255,255,255,0.06)"/>
  <circle cx="-100" cy="-100" r="280" fill="rgba(255,255,255,0.06)"/>
  <circle cx="1000" cy="100" r="140" fill="rgba(255,255,255,0.04)"/>
  <rect x="80" y="70" width="1040" height="490" rx="32" fill="#FFFFFF"/>
  <rect x="120" y="110" width="80" height="80" rx="18" fill="url(#card)"/>
  <text x="160" y="160" font-size="44" text-anchor="middle" fill="white">${icon}</text>
  <text x="220" y="158" font-size="28" font-weight="800" fill="${COLORS.text}">数学对决 · mathduel.games</text>
  <text x="1080" y="156" font-size="22" font-weight="600" fill="${COLORS.primary}" text-anchor="end">${name}</text>
  ${card.cta ? (() => {
    // 中英文混合宽度估算: 中文 32px/字, 英文/标点 16px/字
    const cjk = (card.cta.match(/[\u4e00-\u9fa5]/g) || []).length;
    const ascii = card.cta.length - cjk;
    const tw = cjk * 32 + ascii * 18 + 80;
    return `<rect x="${(1200 - tw) / 2}" y="430" width="${tw}" height="64" rx="32" fill="${COLORS.primary}"/>
    <text x="600" y="471" font-size="30" font-weight="700" fill="white" text-anchor="middle">${escapeXml(card.cta)}</text>`;
  })() : ''}
  ${card.badge ? (() => {
    const cjk = ((card.badge.text || '').match(/[\u4e00-\u9fa5]/g) || []).length;
    const ascii = (card.badge.text || '').length - cjk;
    const tw = (card.badge.icon ? 36 : 0) + cjk * 28 + ascii * 16 + 36;
    return `<rect x="${1080 - tw}" y="190" width="${tw}" height="56" rx="28" fill="${COLORS.accent}"/>
    ${card.badge.icon ? `<text x="${1080 - tw + 18}" y="226" font-size="28">${card.badge.icon}</text>` : ''}
    <text x="${1080 - tw + 18 + (card.badge.icon ? 36 : 0)}" y="226" font-size="24" font-weight="700" fill="${COLORS.text}">${escapeXml(card.badge.text || '')}</text>`;
  })() : ''}
  <text x="600" y="335" font-size="56" font-weight="900" fill="${COLORS.text}" text-anchor="middle">${escapeXml(card.title || '')}</text>
  <text x="600" y="400" font-size="28" font-weight="500" fill="${COLORS.textLight}" text-anchor="middle">${escapeXml(card.subtitle || '')}</text>
  <text x="960" y="520" font-size="24" font-weight="500" fill="${COLORS.textLight}">${escapeXml(metaText)}</text>
  <text x="600" y="595" font-size="20" font-weight="500" fill="${COLORS.textLight}" text-anchor="middle">${escapeXml(card.url || 'mathduel.games')}</text>
</svg>`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
  })[c]);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports.toSVG = toSVG;
}
})();
