/**
 * 分享卡布局回归防护（2026-10-26）
 * ─────────────────────────────────────────────────────────────
 * 背景：boardduel 的分享卡底部原先只画两行品牌文案就结束，572~760 这
 *      约 190px（占全卡 25%）是纯背景空白，视觉重心明显偏上。
 *      修复方式是改成「分隔线 + 品牌面板」，面板右侧放二维码或行动胶囊。
 *
 * 这里用**源码断言**而不是像素断言：CI 里没有 canvas，渲染验证跑不了；
 * 但本次改动的本质是"底部必须有面板、不能留大片空白、二维码失败要有
 * 降级"，这些都能从源码结构上锁住。真机像素验证由 _tools/cards-verify
 * 在本地 dev server 上跑。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/games/share-card.ts'), 'utf8');

test('底部必须画品牌面板，而不是留大片空白', () => {
  assert.ok(/panelY\s*=\s*\d+/.test(SRC), '必须定义面板位置 panelY');
  assert.ok(/panelH\s*=\s*\d+/.test(SRC), '必须定义面板高度 panelH');
  // 面板底边应贴近卡片底边（760 - 底距），不再是 572 就结束
  const m = SRC.match(/panelY\s*=\s*(\d+)/);
  assert.ok(Number(m?.[1]) > 500,
    `面板起点应下移（原 545/572 的写法导致底部 190px 空白），实际 ${m?.[1]}`);
});

test('旧的「品牌行画在 545/572」写法已移除', () => {
  assert.ok(!/fillText\('BoardDuel · Free to Play',\s*W\s*\/\s*2,\s*545\)/.test(SRC),
    '不得再把品牌行孤零零画在 y=545');
  assert.ok(!/,\s*572\)/.test(SRC), '不得再有 y=572 的品牌副行');
});

test('底部必须有出处（域名）', () => {
  assert.ok(/boardduel\.com/.test(SRC), '卡片底部应画域名');
});

test('二维码加载失败时降级为行动胶囊，不留空', () => {
  // 先加载再决定布局：拉不到 /api/qr 时右半边改画 CTA
  assert.ok(/qrImg\s*=\s*await loadImage/.test(SRC), '二维码必须先加载再决定布局');
  assert.ok(/const showQr\s*=/.test(SRC), '必须用 showQr 决定右半边画什么');
  assert.ok(/if \(showQr && qrImg\)/.test(SRC), '有码才画二维码');
  assert.ok(/bg_share_cta_play/.test(SRC), '无码时必须有替代内容（行动胶囊，且走 i18n）');
});

test('结果卡与邀请卡的文案口径一致（不再喊「扫码」却没有码）', () => {
  // 🔴 2026-10-26 第 2 批：标语改成走 i18n，断言从「英文字面量」
  //    改为「两个 i18n 键都在 + 由 showQr 三元切换」。
  assert.ok(/bg_share_scan_board/.test(SRC), '有码时的标语必须走 i18n');
  assert.ok(/bg_share_free_nosignup/.test(SRC), '无码时的标语必须走 i18n');
  assert.ok(/showQr[\s\S]{0,120}bg_share_scan_board[\s\S]{0,120}bg_share_free_nosignup/.test(SRC),
    '标语必须随二维码有无切换');
});

/* ═══════════════════════════════════════════════════════════════
   第 2 批：Canvas 文案 i18n + 数值格式化 + 预览放大
   ═══════════════════════════════════════════════════════════════ */

test('Canvas 内不得再有硬编码英文文案（必须走 i18nText）', () => {
  // 🔴 Canvas 是像素：i18n.js 的 MutationObserver 管不到它，英文一旦烧进
  //    像素就永远改不掉，必须在绘制那一刻就取译文。
  //    判据：这些英文字面量只能作为 i18nText(key, 英文兜底) 的**第二参**出现，
  //    单独出现在别处（直接传给 fillText 等）就是漏网的硬编码。
  //    注：注释里提到这些词是正常的（说明改造背景），先剥掉注释再查。
  //    块注释跨多行，必须先整体剥离，再逐行剥行注释 —— 反过来做无效。
  //
  // 🔴 2026-10-26 修正判据范围：**只查 Canvas 绘制区**。
  //    弹窗 DOM 模板里的英文是 data-i18n-html 的运行时兜底（i18n.js 会
  //    用译文替换），属正常写法，不能按 Canvas 硬编码判死。
  const CANVAS = SRC.slice(
    SRC.indexOf('export async function renderShareCard'),
    SRC.indexOf('/* ───────────────────────── 弹窗'),
  );
  assert.ok(CANVAS.length > 500, '必须能定位到 renderShareCard 绘制区');

  const CODE = CANVAS
    .replace(/\/\*[\s\S]*?\*\//g, '')          // 块注释
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))       // 行注释
    .join('\n');

  const hardcoded = [
    'Scan to play the same board',
    'Free to play — no sign-up',
    'Play a free game',
    'Invite a friend',
    'Room code',
    'Better luck next time',
    'You took the board',
  ];
  for (const s of hardcoded) {
    // 取出所有出现位置前 80 字符，判断是否都在 i18nText(...) 调用内。
    // 注意 before 切片会带上英文兜底串的**开头引号**，所以模式尾部要允许一个 '
    let idx = -1;
    while ((idx = CODE.indexOf(s, idx + 1)) !== -1) {
      const before = CODE.slice(Math.max(0, idx - 80), idx);
      const inCall = /i18nText\(\s*'[^']+',\s*'$/.test(before);
      assert.ok(inCall,
        `「${s}」出现在 i18nText(...) 之外（上下文：…${before.slice(-50)}${s}…），是漏网的硬编码`);
    }
  }
  // 兜底参数的写法是 i18nText('key', 'English')
  assert.ok(/i18nText\('bg\.bg_share_cta_play', 'Play a free game'\)/.test(CODE),
    '降级 CTA 必须写成 i18nText(key, 英文兜底)');
  // 品牌面板那两句也要接上
  assert.ok(/i18nText\('bg\.bg_share_scan_board'/.test(CODE), '扫码标语必须走 i18n');
  assert.ok(/i18nText\('bg\.bg_share_free_nosignup'/.test(CODE), '无码标语必须走 i18n');
});

test('分享卡用到的 i18n 键必须在 6 语言字典里都存在（缺键=永久露英文）', () => {
  // 🔴 键写错或漏写某语言时，i18nText 会静默回退英文 —— Canvas 上就是
  //    一张永远翻不了的中英混排卡片，而且不报错。故用门禁锁死。
  const LANGS = ['en', 'zh', 'de', 'es', 'fr', 'ja'];
  const dicts = new Map<string, Record<string, unknown>>();
  for (const l of LANGS) {
    const raw = fs.readFileSync(path.join(ROOT, `public/i18n/${l}.json`), 'utf8');
    dicts.set(l, JSON.parse(raw));
  }

  // 源码里用到的所有 bg.bg_share_* 键
  const used = new Set<string>();
  for (const m of SRC.matchAll(/'(bg\.bg_share_[a-z_]+)'/g)) used.add(m[1]);

  // 字典里也应该有的一整套（第 2 批新增的 Canvas 文案）
  const REQUIRED = [
    'bg.bg_share_scan_board', 'bg.bg_share_free_nosignup', 'bg.bg_share_cta_play',
    'bg.bg_share_invite_title', 'bg.bg_share_room_code',
    'bg.bg_share_stat_board', 'bg.bg_share_stat_status', 'bg.bg_share_stat_waiting',
    'bg.bg_share_stat_price', 'bg.bg_share_stat_free',
    'bg.bg_share_result_win', 'bg.bg_share_result_good',
    'bg.bg_share_big_win', 'bg.bg_share_big_loss',
    'bg.bg_share_win_sub', 'bg.bg_share_loss_sub',
    'bg.bg_share_stat_moves', 'bg.bg_share_stat_time', 'bg.bg_share_stat_site',
    'bg.bg_share_copied', 'bg.bg_share_copy_failed', 'bg.bg_share_saved',
  ];
  for (const k of REQUIRED) used.add(k);

  const missing: string[] = [];
  for (const [lang, dict] of dicts) {
    for (const key of used) {
      const [group, sub] = key.split('.');
      const g = dict[group] as Record<string, unknown> | undefined;
      const v = g?.[sub];
      if (typeof v !== 'string' || !v.trim()) missing.push(`${lang}:${key}`);
    }
  }
  assert.deepEqual(missing, [],
    `这些键在字典里缺失，会导致分享卡露英文：\n${missing.join('\n')}`);
});

test('i18nText 必须在返回 key 时判为降级（防裸 key 烧进 Canvas）', () => {
  // 字典未 fetch 完时 window.t() 会返回 key 本身 —— 直接用会把
  // "bg.bg_share_cta_play" 烧成像素且永不修复。
  assert.ok(/v\s*!==\s*key/.test(SRC), '必须显式判定「返回值 === key」为降级');
  assert.ok(/return fallback/.test(SRC), '降级时必须回退英文兜底文案');
});

test('大数字走千分位格式化', () => {
  assert.ok(/function fmtNum/.test(SRC), '必须有 fmtNum 数值格式化函数');
  assert.ok(/toLocaleString/.test(SRC), '必须用 toLocaleString（各语言分隔符不同）');
  assert.ok(/fmtNum\(opts\.moves\)/.test(SRC), '步数必须走千分位');
  assert.ok(!/String\(opts\.moves\)/.test(SRC), '不得再用裸 String() 显示步数');
});

test('弹窗预览放大到 600px（原 300px 太小看不清卡片内容）', () => {
  const CSS = fs.readFileSync(path.join(ROOT, 'src/styles/share-card.css'), 'utf8');
  const m = CSS.match(/\.bd-share-canvas\s*\{[^}]*max-width:\s*(\d+)px/);
  assert.ok(m, '必须给 .bd-share-canvas 设 max-width');
  assert.ok(Number(m[1]) >= 600,
    `预览宽度应放大到 600px（原 300px），实际 ${m[1]}px`);

  // 🔴 容器宽度必须按**盒模型倒推**，不能拍脑袋给个数。
  //   画布真要显示成 600px（原生尺寸），容器得放下：
  //     画布 600 + wrap 左右 padding + 卡片左右 padding + border
  //   2026-10-26 线上实测踩过这个坑：容器写 640px → 画布实际只有 582px
  //   （漏算了 .bd-share-canvas-wrap 的 10px×2 padding），等于没放大到位。
  const cardM = CSS.match(/\.bd-share-card\s*\{([^}]*)\}/);
  assert.ok(cardM, '必须给 .bd-share-card 设 max-width');
  const cardMax = Number(cardM![1].match(/max-width:\s*(\d+)px/)![1]);

  const cardPadParts = cardM![1].match(/padding:\s*([^;]+);/)![1].trim().split(/\s+/);
  const cardPadX = parseFloat(cardPadParts.length >= 3 ? cardPadParts[1] : cardPadParts[0]) * 2;
  const borderM = cardM![1].match(/border:\s*(\d+)px/);
  const borderX = borderM ? Number(borderM[1]) * 2 : 0;

  const wrapM = CSS.match(/\.bd-share-canvas-wrap\s*\{([^}]*)\}/);
  assert.ok(wrapM, '必须存在 .bd-share-canvas-wrap');
  const wrapPadM = wrapM![1].match(/padding:\s*([^;]+);/);
  const wrapPadX = wrapPadM ? parseFloat(wrapPadM[1].trim().split(/\s+/)[0]) * 2 : 0;

  const need = 600 + cardPadX + borderX + wrapPadX;
  assert.ok(cardMax >= need,
    `弹窗容器 max-width 应 ≥ ${need}px（600 画布 + 卡片 padding ${cardPadX} + border ${borderX} + wrap padding ${wrapPadX}），实际 ${cardMax}px`);

  // 窄屏仍需自适应，不能撑破视口
  assert.ok(/@media \(max-width: 380px\)/.test(CSS), '必须保留窄屏降级');
  const narrow = CSS.match(/@media \(max-width: 380px\)\s*\{[\s\S]*?\.bd-share-canvas\s*\{[^}]*max-width:\s*([\d]+|100%)/);
  assert.ok(narrow, '窄屏必须重设 .bd-share-canvas 的 max-width');
  assert.ok(narrow[1] === '100%' || Number(narrow[1]) <= 380,
    `窄屏预览宽度应自适应容器（≤380px 或 100%），实际 ${narrow[1]}`);
});
