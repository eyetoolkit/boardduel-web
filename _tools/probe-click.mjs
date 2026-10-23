#!/usr/bin/env node
/** 单游戏点击调试：点了之后 DOM 里到底多了什么？ */
import { chromium } from 'file:///C:/Users/JIM/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const g = process.argv[2] || 'reversi';
const sel = process.argv[3] || '.rv-cell[data-i]';
const b = await chromium.launch({ executablePath: EDGE, headless: true });
const p = await b.newPage({ viewport: { width: 900, height: 1000 } });
p.on('pageerror', (e) => console.log('PAGEERR', String(e)));
await p.goto(`https://boardduel.com/games/${g}/?mode=ai&level=medium`, { waitUntil: 'load' });
await p.waitForTimeout(2000);
const n = await p.locator(sel).count();
console.log(g, sel, 'count=', n);
for (let i = 0; i < Math.min(n, 3); i++) {
  const el = p.locator(sel).nth(i);
  const bb = await el.boundingBox();
  const attr = await el.getAttribute('data-i');
  console.log(`  #${i} data-i=${attr} box=`, bb && { x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.width), h: Math.round(bb.height) });
  await el.click({ force: true });
  await p.waitForTimeout(Number(process.env.WAITMS || 300));
  const info = await p.evaluate(() => ({
    anim: document.querySelectorAll('.bd-anim-place, .bd-anim-flip').length,
    last: document.querySelectorAll('.is-last').length,
    pieces: document.querySelectorAll('#bd-board svg circle').length,
    body: document.body.className,
  }));
  console.log('   after click:', JSON.stringify(info));
  if (info.anim) break;
}
await b.close();
