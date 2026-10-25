#!/usr/bin/env node
/**
 * reversi 重连恢复探针 v2（2026-10-25，P1 修复验证）
 *
 * v1 教训：clearInviteParam() 会把 ?c= 从 URL 摘掉，page.reload() 后页面
 * 不带房码直接进单机局——刷新场景根本测不到重连。真实场景是 WS 断流后
 * online-core 自动重连（rejoin=1），服务端 handleConnect 补发 joinState。
 *
 * 场景（对齐 v6 生产失败时序）：双端同盘 → A 断网 → B 走一手（A 漏广播）
 * → A 恢复网络自动重连 → joinState（顶层 board）到达。
 *   修复后：A 应用到权威盘，与 B 一致；
 *   修复前：A 停在断线前旧局，直到任意一方下一手。
 *
 * 用法：node _tools/reversi-reconnect-probe.mjs [baseUrl]
 */
import { chromium } from 'file:///C:/Users/JIM/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'https://www.boardduel.com';

const rows = [];
let failed = 0;
const ok = (label, pass, detail = '') => {
  if (!pass) failed++;
  rows.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const dump = () => {
  const out = [];
  for (const e of document.querySelectorAll('.rv-stone:not(.is-hint)')) {
    const m = e.getCTM();
    const pos = m ? `${m.e.toFixed(1)},${m.f.toFixed(1)}` : 'detached';
    const fill = getComputedStyle(e).fill;
    const dark = /rgb\(30, 27|rgb\(0, 0|#1e|#000|black/i.test(fill);
    out.push(`${pos}#${dark ? 'B' : 'W'}`);
  }
  return out.sort().join(' | ');
};
const snap = async (page) => {
  const s = await page.evaluate(dump);
  return { fp: s, n: s === '' ? 0 : s.split(' | ').length };
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
try {
  const r = await fetch(`${BASE}/api/gp/room?name=重连甲&game=reversi`);
  const code = (await r.json()).code;
  console.log(`room=${code}`);

  const ctxA = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const ctxB = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await pageB.goto(`${BASE}/games/reversi/?c=${code}`, { waitUntil: 'load', timeout: 45000 });
  await pageA.goto(`${BASE}/games/reversi/?c=${code}`, { waitUntil: 'load', timeout: 45000 });
  await pageA.waitForTimeout(4500);

  // 走到 5 子（B 先手：seat0=黑；命中区只在轮到自己时渲染，轮询等）
  const moveWhenTurn = async (page) => {
    for (let t = 0; t < 30; t++) {
      const hits = await page.locator('.rv-cell[data-i]').count().catch(() => 0);
      if (hits > 0) {
        await page.locator('.rv-cell[data-i]').first().click({ force: true, timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(1200);
        return true;
      }
      await page.waitForTimeout(500);
    }
    return false;
  };
  ok('B（先手）走一手', await moveWhenTurn(pageB));
  ok('A 走一手', await moveWhenTurn(pageA));
  const s1 = await snap(pageA);
  const s1b = await snap(pageB);
  ok('对局进行中（断网前双端同盘）', s1.fp === s1b.fp && s1.n > 4, `A=${s1.n} B=${s1b.n}`);

  // ── A 断网（WS close → online-core 进入重连退避）──
  await ctxA.setOffline(true);
  await pageA.waitForTimeout(1500);
  // B 在 A 离线期间走一手 → A 漏这条广播
  ok('A 离线期间 B 再走一手', await moveWhenTurn(pageB));
  const sB = await snap(pageB);
  ok('B 端已推进（A 漏广播）', sB.n === s1.n + 1, `B=${sB.n}（断网前 ${s1.n}）`);

  // ── A 恢复网络：自动重连（rejoin=1）→ joinState 到达 ──
  await ctxA.setOffline(false);
  let sA = await snap(pageA);
  for (let t = 0; t < 60 && sA.fp !== sB.fp; t++) {
    await pageA.waitForTimeout(500);
    sA = await snap(pageA);
  }
  ok('A 重连后恢复到当前局面（joinState 权威盘被采纳）', sA.fp === sB.fp,
    sA.fp === sB.fp ? `双端 ${sA.n} 子一致` : `A=${sA.n} vs B=${sB.n} 子`);
  await ctxA.close().catch(() => {});
  await ctxB.close().catch(() => {});
} finally {
  await browser.close();
}
console.log(rows.join('\n'));
console.log(`\n${failed === 0 ? 'ALL GREEN' : failed + ' FAILED'} — base=${BASE}`);
