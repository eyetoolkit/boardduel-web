#!/usr/bin/env node
/**
 * chess transform 覆盖 bug 可视化取证（2026-10-25）
 * 双 Tab 联机：A 走一手 → B 端（不走的对手）截图 + CTM  dump。
 * 线上复现路径：https://www.boardduel.com
 */
import { chromium } from 'file:///C:/Users/JIM/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'https://www.boardduel.com';
const OUT = process.argv[3] || 'C:/Game/_audit-chess-bug.png';

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const code = await (await fetch(`${BASE}/api/gp/room?name=%E5%AE%A1%E6%A0%B8%E7%94%B2&game=chess`)).json();
const ctxA = await browser.newContext({ viewport: { width: 900, height: 1000 } });
const ctxB = await browser.newContext({ viewport: { width: 900, height: 1000 } });
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();
await pageB.goto(`${BASE}/games/chess/?c=${code.code}`, { waitUntil: 'load', timeout: 45000 });
await pageA.goto(`${BASE}/games/chess/?c=${code.code}`, { waitUntil: 'load', timeout: 45000 });
await pageA.waitForTimeout(4000);

// A（白方先行）走 e2-e4：点 e2 己子 → 点 e4 落点
async function moveOn(page) {
  const from = page.locator('.ch-cell[data-sq]').first();
  await from.click({ force: true, timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  const n = await page.locator('.ch-cell[data-to]').count();
  console.log('落点数:', n);
  if (n > 0) await page.locator('.ch-cell[data-to]').nth(Math.min(2, n - 1)).click({ force: true, timeout: 3000 }).catch(() => {});
}
await moveOn(pageA);
await pageB.waitForTimeout(1600);   // 动画 0.28s 早结束，B 端未重渲染

const info = await pageB.evaluate(() => {
  const bad = [...document.querySelectorAll('.ch-piece')].filter((e) => {
    const m = /translate\(([-\d.]+)[\s,]+([-\d.]+)\)/.exec(e.getAttribute('transform') || '');
    const c = e.getCTM();
    return m && c && (Math.abs(+m[1] - c.e) > 1 || Math.abs(+m[2] - c.f) > 1);
  });
  return { total: document.querySelectorAll('.ch-piece').length, bad: bad.length,
    badDetail: bad.map((e) => ({ cls: e.getAttribute('class'), attr: e.getAttribute('transform'), ctm: `e=${e.getCTM().e.toFixed(1)} f=${e.getCTM().f.toFixed(1)}` })) };
});
console.log('B 端棋子错位:', JSON.stringify(info, null, 1));
await pageB.screenshot({ path: OUT, fullPage: false });
console.log('截图:', OUT);
await browser.close();
