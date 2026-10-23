#!/usr/bin/env node
/** 探各游戏落子热区的实际选择器与数量（用来给冒烟脚本挑一个必中的点） */
import { chromium } from 'file:///C:/Users/JIM/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const S = {
  gomoku: ['.go-cell[data-i]', '#bd-board svg > g', '[data-i]'],
  tictactoe: ['.ttt-cell[data-i]'],
  connect4: ['.c4-cell[data-c]', '[data-c]'],
  reversi: ['.rv-cell[data-i]', '[data-i]'],
  go: ['.go-cell[data-i]', '[data-i]'],
  chess: ['.ch-cell[data-sq]', '[data-sq]'],
  xiangqi: ['.xq-pt[data-sq]', '[data-sq]'],
  checkers: ['.ck-cell[data-i]', '[data-i]'],
};
const b = await chromium.launch({ executablePath: EDGE, headless: true });
for (const [g, sels] of Object.entries(S)) {
  const p = await b.newPage({ viewport: { width: 900, height: 1000 } });
  await p.goto(`https://boardduel.com/games/${g}/?mode=ai&level=medium`, { waitUntil: 'load' });
  await p.waitForTimeout(2000);
  const out = {};
  for (const s of sels) out[s] = await p.locator(s).count();
  const hostInfo = await p.evaluate(() => {
    const el = document.querySelector('#bd-board');
    return el ? { tag: el.tagName, htmlHead: el.innerHTML.slice(0, 160) } : null;
  });
  console.log(g.padEnd(10), JSON.stringify(out), '| board:', JSON.stringify(hostInfo));
  await p.close();
}
await b.close();
