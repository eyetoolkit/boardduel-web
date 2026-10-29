/**
 * 分享卡布局回归防护（2026-10-26 建，2026-10-29 随引擎收敛重写）
 * ─────────────────────────────────────────────────────────────
 * 🔴 2026-10-29 三站统一：Canvas 绘制 + 弹窗 + CSS 全部移到
 *    fe-shared/shared/invite-card.mjs（同步为本仓 public/shared/invite-card.mjs），
 *    本仓 src/games/share-card.ts 只剩「拼参数 + 取译文」的薄封装。
 *    因此断言分两层：
 *      · 引擎层（E = public/shared/invite-card.mjs）：布局结构、降级路径、
 *        弹窗 CSS 盒模型 —— 三站共用，改这里三站生效。
 *      · 封装层（W = src/games/share-card.ts）：品牌参数、链接格式、
 *        i18n 键齐备、降级判定 —— 站点自身契约。
 * 布局断言沿用「源码断言」思路：CI 无 canvas，像素验证由
 * _tools/cards-verify / 本地 playwright 冒烟跑。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const E = fs.readFileSync(path.join(ROOT, 'public/shared/invite-card.mjs'), 'utf8');
const W = fs.readFileSync(path.join(ROOT, 'src/games/share-card.ts'), 'utf8');

/* ═══════════════ 引擎层：布局结构（三站共用） ═══════════════ */

test('引擎底部必须画品牌面板，而不是留大片空白', () => {
  assert.ok(/panelY\s*=\s*\d+/.test(E), '必须定义面板位置 panelY');
  assert.ok(/panelH\s*=\s*\d+/.test(E), '必须定义面板高度 panelH');
  const m = E.match(/panelY\s*=\s*(\d+)/);
  assert.ok(Number(m?.[1]) > 500,
    `面板起点应下移（原 545/572 的写法导致底部 190px 空白），实际 ${m?.[1]}`);
});

test('旧的「品牌行画在 545/572」写法已移除', () => {
  assert.ok(!/,\s*572\)/.test(E), '不得再有 y=572 的品牌副行');
});

test('引擎底部必须有出处（绘制 cfg.domain）', () => {
  assert.ok(/fillText\(String\(cfg\.domain/.test(E), '卡片底部应画 cfg.domain');
});

test('二维码加载失败时降级为行动胶囊，不留空', () => {
  // 先加载再决定布局：拉不到端点时右半边改画 CTA
  assert.ok(/qrImg\s*=\s*await loadImage/.test(E), '二维码必须先加载再决定布局');
  assert.ok(/const showQr\s*=/.test(E), '必须用 showQr 决定右半边画什么');
  assert.ok(/if \(showQr && qrImg\)/.test(E), '有码才画二维码');
  assert.ok(/else if \(cfg\.ctaText\)/.test(E), '无码时必须有行动胶囊分支');
});

test('双态标语：有码 scanText / 无码 noQrText（boardduel 双键语义保留）', () => {
  assert.ok(/showQr \? cfg\.scanText : \(cfg\.noQrText \|\| cfg\.ctaText/.test(E),
    '品牌面板标语必须随二维码有无切换');
});

test('弹窗 CSS 自注入（不再存在会「被谁 import 决定」的独立样式文件）', () => {
  assert.ok(/const CSS = `/.test(E), '引擎必须内嵌 CSS 字符串');
  assert.ok(/fc-invite-style/.test(E), '必须以 <style id="fc-invite-style"> 注入');
  assert.ok(!fs.existsSync(path.join(ROOT, 'src/styles/share-card.css')),
    '本仓旧 share-card.css 必须已删除（样式归属引擎）');
});

/* ═══════════════ 引擎层：弹窗 CSS 盒模型 ═══════════════ */

test('弹窗预览 600px，容器按盒模型倒推 ≥658px', () => {
  const canvasM = E.match(/\.fc-invite-canvas\{[^}]*max-width:(\d+)px/);
  assert.ok(canvasM, '必须给 .fc-invite-canvas 设 max-width');
  assert.ok(Number(canvasM[1]) >= 600,
    `预览宽度应 ≥600px（原 300px 看不清），实际 ${canvasM[1]}px`);

  const cardM = E.match(/\.fc-invite-card\{([^}]*)\}/);
  assert.ok(cardM, '必须给 .fc-invite-card 设 max-width');
  const cardMax = Number(cardM![1].match(/max-width:(\d+)px/)![1]);
  // 盒模型：画布 600 + wrap padding 10×2 + 卡片 padding 18×2 + border 1×2 = 658
  assert.ok(cardMax >= 658,
    `弹窗容器 max-width 应 ≥658px（600 画布 + wrap 20 + 卡片 36 + border 2），实际 ${cardMax}px`);

  assert.ok(/@media \(max-width:380px\)/.test(E), '必须保留窄屏降级');
  assert.ok(/\.fc-invite-canvas\{max-width:100%/.test(E), '窄屏必须重设 canvas 宽度');
});

/* ═══════════════ 封装层：站点契约 ═══════════════ */

test('品牌参数与链接格式（/b/<game>/<CODE> 短链 + /api/qr 端点）', () => {
  assert.ok(/domain: 'boardduel\.com'/.test(W), '必须传 boardduel.com 域名');
  assert.ok(/brand: 'BoardDuel'/.test(W), '必须传 BoardDuel 品牌');
  assert.ok(/fileBase: 'boardduel'/.test(W), '下载文件名前缀');
  assert.ok(/location\.origin \+ '\/b\/' \+ gameId \+ '\/' \+ code/.test(W),
    '邀请链接必须是 /b/<gameId>/<CODE> 短链格式');
  assert.ok(/\/api\/qr\?game=/.test(W), '二维码必须走 worker /api/qr');
});

test('导出 API 与旧版一致（8 个游戏 + invite-card.ts 消费方零改动）', () => {
  for (const fn of ['export async function openShareCard', 'export function closeShareCard',
    'export function shareInvite', 'export function shareResult']) {
    assert.ok(W.includes(fn), `必须保留导出 ${fn.replace(/export (async )?function /, '')}`);
  }
});

test('大数字走千分位格式化', () => {
  assert.ok(/function fmtNum/.test(W), '必须有 fmtNum 数值格式化函数');
  assert.ok(/toLocaleString/.test(W), '必须用 toLocaleString（各语言分隔符不同）');
  assert.ok(/fmtNum\(opts\.moves\)/.test(W), '步数必须走千分位');
  assert.ok(!/stats:\s*\[[\s\S]*String\(opts\.moves\)/.test(W), '不得再用裸 String() 显示步数');
});

test('i18nText 必须在返回 key 时判为降级（防裸 key 烧进 Canvas）', () => {
  assert.ok(/v\s*!==\s*key/.test(W), '必须显式判定「返回值 === key」为降级');
  assert.ok(/return fallback/.test(W), '降级时必须回退英文兜底文案');
});

test('引擎绘制区不得有硬编码英文文案（文案全部由封装层解析后传入）', () => {
  // 引擎只画 cfg.* —— 任何 UI 英文出现在引擎里 = 三站一起露英文。
  const CODE = E
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
    'BoardDuel',
    'boardduel.com',
  ];
  for (const s of hardcoded) {
    assert.ok(!CODE.includes(s), `引擎里不得出现硬编码文案「${s}」（应由封装层传入）`);
  }
});

test('分享卡用到的 i18n 键必须在 6 语言字典里都存在（缺键=永久露英文）', () => {
  const LANGS = ['en', 'zh', 'de', 'es', 'fr', 'ja'];
  const dicts = new Map<string, Record<string, unknown>>();
  for (const l of LANGS) {
    const raw = fs.readFileSync(path.join(ROOT, `public/i18n/${l}.json`), 'utf8');
    dicts.set(l, JSON.parse(raw));
  }

  // 源码里用到的所有 bg.bg_share_* 键
  const used = new Set<string>();
  for (const m of W.matchAll(/'(bg\.bg_share_[a-z_]+)'/g)) used.add(m[1]);

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
    'bg.bg_share_qr_main', 'bg.bg_share_qr_sub',
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

test('全站 dictVersion 一致（引擎迁移补键后必须 bump）', () => {
  const seen = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'legacy'].includes(e.name) || e.name.startsWith('_build-verify')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.html')) continue;
      const m = fs.readFileSync(p, 'utf8').match(/dictVersion\s*:\s*(\d+)/);
      if (m) seen.add(m[1]);
    }
  };
  walk(ROOT);
  assert.equal(seen.size, 1, `dictVersion 出现多个版本：${[...seen].join(', ')}`);
});
