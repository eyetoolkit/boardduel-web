#!/usr/bin/env node
/**
 * reversi 联机分歧定向诊断 v2（2026-10-25）
 *
 * v1 教训：addInitScript 包 window.WebSocket 太侵入，双端盘面渲染被破坏
 * （A 零 cell / B 有 cell 无子）——探针自己制造了"分歧"。
 * v2 改 Playwright 非侵入 page.on('websocket') 帧捕获 + pageerror 监听。
 *
 * v6 全量现象（待复现/排除）：ply4 后 A=6 B=7 且同格颜色互异，+2.5s 仍不一致。
 *
 * 用法：node _tools/reversi-desync-diag.mjs [baseUrl] [rounds]
 */
import { chromium } from 'file:///C:/Users/JIM/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'https://www.boardduel.com';
const ROUNDS = Number(process.argv[3] || 6);

const browser = await chromium.launch({ executablePath: EDGE, headless: true });

const dumpBoard = () => {
  // 逐子 dump：CTM（含自身 transform，免疫动画/滚动）+ 计算色。
  // v1 教训：.rv-cell 命中区只在轮到自己时渲染（showHints 闸门），
  // 且棋子根本不在 cell 里面——按 cell dump 是错的。棋子 = .rv-stone circle。
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

/** 从 WS 帧日志提取最后一次带 board 的服务端广播（截断内尽力解析） */
const serverTruth = (log) => {
  for (let i = log.length - 1; i >= 0; i--) {
    const f = log[i];
    if (!f.startsWith('<<') || !f.includes('"board"')) continue;
    const m = f.match(/"board":\[([^\]]*)\]/);
    if (!m) continue;
    const cells = m[1].split(',').map((s) => s.trim());
    const nonNull = cells.filter((c) => c !== 'null').length;
    const truncated = !f.includes('"}') && !/\]\s*\}?\s*$/.test(f);
    return `board cells=${cells.length} non-null=${nonNull}${truncated ? ' (帧被截断,计数可能不全)' : ''}`;
  }
  return '(无 board 帧)';
};

try {
  const r = await fetch(`${BASE}/api/gp/room?name=诊断甲&game=reversi`);
  const j = await r.json();
  const code = j.code;
  console.log(`room=${code}`);

  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
    const page = await ctx.newPage();
    const log = [];
    page.on('websocket', (ws) => {
      ws.on('framereceived', (f) => { log.push('<< ' + String(f.payload).slice(0, 400)); if (log.length > 30) log.shift(); });
      ws.on('framesent', (f) => { log.push('>> ' + String(f.payload).slice(0, 400)); if (log.length > 30) log.shift(); });
    });
    page.on('pageerror', (e) => log.push('PAGEERROR ' + String(e.message || e).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error') log.push('CONSOLE ' + m.text().slice(0, 160)); });
    return { ctx, page, log };
  };

  const A = await mk();
  const B = await mk();
  await B.page.goto(`${BASE}/games/reversi/?c=${code}`, { waitUntil: 'load', timeout: 45000 });
  await A.page.goto(`${BASE}/games/reversi/?c=${code}`, { waitUntil: 'load', timeout: 45000 });
  await A.page.waitForTimeout(5000);

  const report = async (tag) => {
    const [da, db] = await Promise.all([A.page.evaluate(dumpBoard), B.page.evaluate(dumpBoard)]);
    const same = da === db;
    const nA = da === '' ? 0 : da.split(' | ').length;
    const nB = db === '' ? 0 : db.split(' | ').length;
    console.log(`[${tag}] ${same ? 'SAME' : '*** DIVERGED ***'} (A=${nA} B=${nB} stones)`);
    if (!same) {
      console.log(`  A: ${da}`);
      console.log(`  B: ${db}`);
      console.log(`  服务端广播(A 侧): ${serverTruth(A.log)}`);
      console.log(`  服务端广播(B 侧): ${serverTruth(B.log)}`);
      console.log('  A frames/errors:'); A.log.slice(-6).forEach((f) => console.log(`    ${f}`));
      console.log('  B frames/errors:'); B.log.slice(-6).forEach((f) => console.log(`    ${f}`));
    }
    return same;
  };

  await report('start');
  for (let round = 1; round <= ROUNDS; round++) {
    const tab = round % 2 === 1 ? A : B;
    // 点击命中区 <g class="rv-cell" data-i>（duel-closed-loop 验证过的路径）；
    // 提示环是 .rv-stone.is-hint 兄弟节点，不在 cell 内。
    const hits = await tab.page.locator('.rv-cell[data-i]').count().catch(() => 0);
    if (hits > 0) {
      await tab.page.locator('.rv-cell[data-i]').first().click({ force: true, timeout: 3000 }).catch(() => {});
      await tab.page.waitForTimeout(1500);
    }
    if (!(await report(`ply ${round} (hits=${hits})`))) break;
  }
  await A.ctx.close().catch(() => {});
  await B.ctx.close().catch(() => {});
} finally {
  await browser.close();
}
