#!/usr/bin/env node
/**
 * chess 落子动画 transform 覆盖探针（2026-10-25）
 *
 * 疑点：.bd-anim-place 的 CSS keyframes 动画 transform:scale()，
 *   而 SVG 的 transform 属性是低优先级 presentation attribute —— CSS 动画
 *   （fill-mode:both，终态 scale(1)）会**整体覆盖**属性里的
 *   translate(ox oy) scale(w/40)。对象棋子用 cx/cy 定位（gomoku/c4/xq/…），
 *   终态 scale(1) 是恒等变换，无害；唯独 chess 的 <g class="ch-piece"> 把
 *    translate+scale 全写在自身 transform 属性上 —— 一旦被覆盖，该棋子会
 *   渲染到 SVG 原点且尺寸错，直到下一次重渲染才恢复。
 *
 * 判据：走子后 1.2s（动画 0.28s 早已结束），逐子比对
 *   transform 属性声明的 translate vs getCTM() 实际 translate。
 *   不一致 = CSS 覆盖仍生效 = 线上可见的渲染 bug。
 */
import { chromium } from 'file:///C:/Users/JIM/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'https://www.boardduel.com';

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e.message || e)));

await page.goto(`${BASE}/games/chess/?mode=ai&level=easy`, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(2500);

async function dump(label) {
  const rows = await page.evaluate(() => {
    return [...document.querySelectorAll('.ch-piece')].map((e) => {
      const attr = e.getAttribute('transform') || '';
      const m = /translate\(([-\d.]+)[\s,]+([-\d.]+)\)/.exec(attr);
      const ctm = e.getCTM();
      const inner = e.firstElementChild;
      const innerCls = inner ? inner.getAttribute('class') : '';
      const innerCtm = inner && inner.getCTM ? inner.getCTM() : null;
      return {
        cls: e.getAttribute('class'),
        attrTx: m ? [+m[1], +m[2]] : null,
        ctmTx: ctm ? [+ctm.e.toFixed(1), +ctm.f.toFixed(1)] : null,
        scale: ctm ? +ctm.a.toFixed(3) : null,
        innerCls,
        innerTx: innerCtm ? [+innerCtm.e.toFixed(1), +innerCtm.f.toFixed(1)] : null,
      };
    });
  });
  console.log(`\n=== ${label} (${rows.length} pieces) ===`);
  // 真 bug 签名：属性声明了真实 translate，实际 CTM 却在 SVG 原点附近
  // （viewBox→viewport 有 ~0.996 均匀系数，非原点位的微小偏差是假阳性，
  //   不再用固定 1px 容差，改用"原点 5px 内"判据）
  let bad = 0;
  const animRows = [];
  for (const r of rows) {
    const atOrigin = r.attrTx && r.ctmTx && Math.abs(r.attrTx[0]) > 5 &&
      r.ctmTx[0] < 5 && r.ctmTx[1] < 5;
    if (atOrigin) bad++;
    if (r.innerCls && /bd-anim/.test(r.innerCls)) {
      animRows.push(r);
    }
  }
  for (const r of animRows) {
    console.log(`  anim  inner="${r.innerCls}" attr=${JSON.stringify(r.attrTx)} outerCTM=${JSON.stringify(r.ctmTx)} innerCTM=${JSON.stringify(r.innerTx)}`);
  }
  console.log(`  -> 原点错位(真 bug): ${bad}/${rows.length}；带动画内层: ${animRows.length}`);
  return bad;
}

await dump('初始局面');

// 走一手：点己方棋子 → 点落点（AI 模式命中区只渲染有走法的己方子）
const moved = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.ch-cell[data-sq]')];
  if (!cells.length) return 'no from-cells';
  cells[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return 'clicked from #0';
});
await page.waitForTimeout(400);
const toCnt = await page.locator('.ch-cell[data-to]').count();
console.log(`选子后落点数: ${toCnt}（${moved}）`);
if (toCnt > 0) {
  await page.locator('.ch-cell[data-to]').first().click({ force: true, timeout: 2000 }).catch(() => {});
}
await page.waitForTimeout(1200);   // 动画 0.28s 早该结束
const bad = await dump('走子后 1.2s');

await page.waitForTimeout(2000);
const bad2 = await dump('走子后 3.2s（未触发任何重渲染）');
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

console.log(`\n结论: ${bad > 0 || bad2 > 0 ? '存在 transform 覆盖（棋子错位）' : '未复现覆盖'}`);
await browser.close();
process.exit(bad > 0 || bad2 > 0 ? 1 : 0);
