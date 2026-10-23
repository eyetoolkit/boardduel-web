#!/usr/bin/env node
/** 探一下：游戏页加载后到底停在哪一屏？要点什么才进对局？ */
import { chromium } from 'file:///C:/Users/JIM/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const g = process.argv[2] || 'gomoku';
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
await page.goto(`https://boardduel.com/games/${g}/?mode=ai&level=medium`, { waitUntil: 'load' });
await page.waitForTimeout(2000);

const info = await page.evaluate(() => {
  const vis = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const btns = [...document.querySelectorAll('button')].filter(vis)
    .map((b) => (b.textContent || '').trim().slice(0, 24)).slice(0, 20);
  const svgs = [...document.querySelectorAll('svg')].filter(vis)
    .map((s) => ({ cls: s.getAttribute('class') || '', id: s.parentElement?.id || '', label: s.getAttribute('aria-label') || '', w: Math.round(s.getBoundingClientRect().width) }))
    .sort((a, b) => b.w - a.w).slice(0, 5);
  const boardish = [...document.querySelectorAll('[id*="board"], [class*="board"]')].filter(vis)
    .map((e) => ({ tag: e.tagName, id: e.id, cls: (e.getAttribute('class')||'').slice(0,40), w: Math.round(e.getBoundingClientRect().width) })).slice(0, 6);
  return {
    url: location.href,
    bodyClass: document.body.className,
    screens: [...document.querySelectorAll('[class*="screen"], [id*="screen"]')].filter(vis).map((e) => e.id || e.className).slice(0, 8),
    buttons: btns,
    svgs,
    boardish,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
