#!/usr/bin/env node
/**
 * 中国象棋「真实点击」改选测试（2026-10-24，非 force，走浏览器原生命中检测）
 * 模拟真人：选中 A → 点 B（真实命中）→ 验证改选；再点 C 验证；并在某 A 落点相邻的
 * 己方子 B 上，用真实鼠标点「B 靠 A 落点一侧的边缘」，验证不会误触发落子。
 */
import { chromium } from 'file:///C:/Users/JIM/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:5311';

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(String(e.message || e)));

await page.goto(`${BASE}/games/xiangqi/?mode=ai&level=medium`, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(1800);

const sqs = await page.$$eval('.xq-pt[data-sq]', (els) => els.map((e) => e.getAttribute('data-sq')));
console.log('selectable pieces:', sqs.length);

// 1) 真实点击（非 force）选中 A，再真实点击 B，验证改选
let fails = 0;
const sampleFails = [];
for (let i = 0; i < sqs.length; i++) {
  const A = sqs[i];
  // 先取消当前选中（若有），确保本轮是从「未选中」状态选 A，排除 toggle 取消干扰
  const cur = await page.$$eval('.xq-pt[data-to]', (els) => (els.length ? els[0].getAttribute('data-from') : null));
  if (cur !== null) {
    await page.locator(`.xq-pt[data-sq="${cur}"]`).click();
    await page.waitForTimeout(80);
  }
  await page.locator(`.xq-pt[data-sq="${A}"]`).click(); // 非 force：真实命中检测
  await page.waitForTimeout(100);
  const f1 = await page.$$eval('.xq-pt[data-to]', (els) => [...new Set(els.map((e) => e.getAttribute('data-from')))]);
  if (!f1.includes(A)) { sampleFails.push(`select ${A} failed: from=${JSON.stringify(f1)}`); fails++; continue; }
  const B = sqs.find((s) => s !== A);
  await page.locator(`.xq-pt[data-sq="${B}"]`).click(); // 真实点击 B
  await page.waitForTimeout(100);
  const f2 = await page.$$eval('.xq-pt[data-to]', (els) => [...new Set(els.map((e) => e.getAttribute('data-from')))]);
  if (!f2.includes(B)) { sampleFails.push(`reselect ${A}->${B} failed: from=${JSON.stringify(f2)}`); fails++; }
}
console.log('REAL-CLICK reselect fail count:', fails);
if (fails) console.log('SAMPLES:', sampleFails.slice(0, 10));

// 2) 误命中专项：选一个「车/炮」类远射程子的落点的相邻己方子，真实鼠标点 B 靠落点一侧边缘
const misHit = await testMisHit(page, BASE);
console.log('MIS-HIT (offset click near a landing point) landed wrong piece:', misHit);

if (errs.length) console.log('ERRORS:', errs.slice(0, 5));
await browser.close();
process.exit(fails || misHit ? 1 : 0);

async function testMisHit(page, base) {
  await page.goto(`${base}/games/xiangqi/?mode=ai&level=medium`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1800);
  // 选第一个子，拿它的落点集合与所有可走子位置
  const A = await page.$eval('.xq-pt[data-sq]', (e) => e.getAttribute('data-sq'));
  await page.locator(`.xq-pt[data-sq="${A}"]`).click();
  await page.waitForTimeout(120);
  const data = await page.evaluate(() => {
    const CELL = 50, PAD = 24, COLS = 9;
    const xy = (sq) => [(sq % COLS) * CELL + PAD, ((sq / COLS) | 0) * CELL + PAD];
    const lands = [...document.querySelectorAll('.xq-pt[data-to]')].map((e) => +e.getAttribute('data-to'));
    const froms = [...document.querySelectorAll('.xq-pt[data-sq]')].map((e) => +e.getAttribute('data-sq'));
    // 找：某落点 X 与某可走子 B 相邻（曼哈顿距离=1 格 = CELL）
    for (const X of lands) {
      const [x, y] = xy(X);
      for (const B of froms) {
        if (B === X) continue;
        const [bx, by] = xy(B);
        const d = Math.abs(bx - x) + Math.abs(by - y);
        if (d === CELL) {
          // B 靠 X 一侧的边缘点：从 B 中心朝 X 方向偏移 22px（B 棋子半径约 21，仍在格内近 X 侧）
          return { B, X, px: bx + (x - bx) / CELL * 22, py: by + (y - by) / CELL * 22 };
        }
      }
    }
    return null;
  });
  if (!data) { console.log('no adjacent landing/friend pair found'); return false; }
  console.log('mis-hit test: B=', data.B, 'X=', data.X, 'click at', Math.round(data.px), Math.round(data.py));
  await page.mouse.click(data.px, data.py);
  await page.waitForTimeout(150);
  const movedWrong = await page.evaluate((X) => {
    const lm = document.querySelector('.bd-last-mark');
    if (!lm) return false;
    return true;
  }, data.X);
  // 若误命中落点 X，则会出现 last-mark（刚走了一手）；改选成功则不会（仍 human 回合，无 last-move 变化）
  // 这里只返回「是否因偏移点击触发了落子（last-mark 出现且 selected 清零）」
  const after = await page.$$eval('.xq-pt[data-to]', (els) => els.length);
  // 落子后 selected=-1 → 无 data-to；改选成功 → 有 data-to 且 from=B
  const f = await page.$$eval('.xq-pt[data-to]', (els) => [...new Set(els.map((e) => e.getAttribute('data-from')))]);
  const didReselect = f.includes(String(data.B));
  const didLand = f.length === 0; // 落子后无 data-to
  console.log('  -> reselect(B)=', didReselect, ' landed(empty data-to)=', didLand);
  return !didReselect && didLand; // 误命中=没改选且落子了
}
