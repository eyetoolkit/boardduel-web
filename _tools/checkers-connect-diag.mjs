#!/usr/bin/env node
/**
 * checkers 联机入房时间线诊断（2026-10-25）
 *
 * 背景：duel-closed-loop v3 全量跑中，checkers 出现
 *   - B 端房码不可见（其余 7 款双端均可见）
 *   - 前 3 个 round 双方都走不成，第 4 round B 才走成
 * 疑点：B 端 WS 连接/入房被延迟。本脚本按毫秒记录：
 *   goto 完成 → ensureAccount 的 fetch(/api/account/me) → identity.js 加载
 *   → WS open → 首帧 state → onConnect(toast 出现) → .ck-cell 命中区出现
 * 双 Tab 同序复现（B 先导航、A 后导航，与 duel-closed-loop 一致）。
 */
import { chromium } from 'file:///C:/Users/JIM/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'https://www.boardduel.com';
const GAME = process.argv[3] || 'checkers';

const T0 = Date.now();
const ts = () => `+${String(Date.now() - T0).padStart(6)}ms`;

const browser = await chromium.launch({ executablePath: EDGE, headless: true });

async function instrument(page, who) {
  await page.addInitScript((w) => {
    window.__log = [];
    const L = (s) => window.__log.push(`${w} ${Date.now()} ${s}`);
    const of = window.fetch;
    window.fetch = function (...a) {
      const u = String(a[0]);
      if (/account\/me|identity\.js/.test(u)) L(`fetch-start ${u.slice(0, 60)}`);
      return of.apply(this, a).then((r) => {
        if (/account\/me|identity\.js/.test(u)) L(`fetch-done  ${u.slice(0, 60)} ${r.status}`);
        return r;
      }, (e) => { if (/account\/me|identity\.js/.test(u)) L(`fetch-err   ${u.slice(0, 60)}`); throw e; });
    };
    const OWS = window.WebSocket;
    window.WebSocket = function (u) {
      L(`ws-new ${String(u).slice(0, 70)}`);
      const ws = new OWS(u);
      ws.addEventListener('open', () => L('ws-open'));
      ws.addEventListener('message', (ev) => {
        try {
          const m = JSON.parse(String(ev.data));
          L(`ws-msg ${m.type}${m.you !== undefined ? ' you=' + m.you : ''}`);
        } catch { L('ws-msg <non-json>'); }
      });
      ws.addEventListener('close', () => L('ws-close'));
      ws.addEventListener('error', () => L('ws-error'));
      return ws;
    };
    window.WebSocket.prototype = OWS.prototype;
  }, who);
}

const code = await (await fetch(`${BASE}/api/gp/room?name=%E5%AE%A1%E6%A0%B8%E7%94%B2&game=${GAME}`)).json();
console.log(`${ts()} room=${code.code}`);

const ctxB = await browser.newContext({ viewport: { width: 900, height: 1000 } });
const ctxA = await browser.newContext({ viewport: { width: 900, height: 1000 } });
const pageB = await ctxB.newPage();
const pageA = await ctxA.newPage();
await instrument(pageB, 'B');
await instrument(pageA, 'A');

await pageB.goto(`${BASE}/games/${GAME}/?c=${code.code}`, { waitUntil: 'load', timeout: 45000 });
console.log(`${ts()} B goto load`);
await pageA.goto(`${BASE}/games/${GAME}/?c=${code.code}`, { waitUntil: 'load', timeout: 45000 });
console.log(`${ts()} A goto load`);

for (let i = 0; i < 12; i++) {
  await pageA.waitForTimeout(1000);
  const la = await pageA.evaluate(() => window.__log).catch(() => []);
  const lb = await pageB.evaluate(() => window.__log).catch(() => []);
  const ckA = await pageA.locator('.ck-cell').count().catch(() => -1);
  const ckB = await pageB.locator('.ck-cell').count().catch(() => -1);
  const codeInA = await pageA.locator('body').innerText().then((t) => t.includes(code.code)).catch(() => false);
  const codeInB = await pageB.locator('body').innerText().then((t) => t.includes(code.code)).catch(() => false);
  console.log(`${ts()} A: ck-cell=${ckA} codeVisible=${codeInA} | B: ck-cell=${ckB} codeVisible=${codeInB}`);
  if (i === 0 || i === 4 || i === 11) {
    for (const l of la.filter((x) => !x.startsWith('ws-msg state'))) console.log(`   ${l.replace(/\d{10,}/, (m) => `+${m - (T0 - 0)}`)}`.slice(0, 110));
    for (const l of lb.filter((x) => !x.startsWith('ws-msg state'))) console.log(`   ${l}`.slice(0, 110));
  }
  if (ckA > 0 && ckB > 0 && codeInA && codeInB) { console.log(`${ts()} 双方就绪`); break; }
}

await browser.close();
