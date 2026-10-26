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
  assert.ok(/Play a free game/.test(SRC), '无码时必须有替代内容（行动胶囊）');
});

test('结果卡与邀请卡的文案口径一致（不再喊「扫码」却没有码）', () => {
  assert.ok(/showQr \? 'Scan to play the same board' : 'Free to play — no sign-up'/.test(SRC),
    '标语必须随二维码有无切换');
});
