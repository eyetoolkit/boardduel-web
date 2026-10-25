#!/usr/bin/env node
/**
 * friend-room UI 流探针（2026-10-25 审核补缺）
 *
 * duel-closed-loop 走 API 建房，没验页面内「好友房」入口流：
 *   lobby「Create a room」→ /games/<g>/?mode=friend → openFriendRoom
 *   → 全屏邀请卡（房码 + QR + 邀请链接）→ /b/<g>/<CODE> 短链入房。
 *
 * 断言：
 *   ① 邀请卡出现且房码为 6 位（非占位 ------）
 *   ② 链接 input = origin + /b/<game>/<CODE>
 *   ③ QR img 加载成功（naturalWidth>0）
 *   ④ 短链 302 → /games/<game>/?c=<CODE>（API 级）
 *   ⑤ B 端开短链落到对局页且双端连接（房码在 B 端 toast/observer 出现过）
 *
 * 用法：node _tools/friend-room-flow.mjs [baseUrl] [game]
 */
import { chromium } from 'file:///C:/Users/JIM/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'https://www.boardduel.com';
const GAME = process.argv[3] || 'tictactoe';

const rows = [];
let failed = 0;
const ok = (label, pass, detail = '') => {
  if (!pass) failed++;
  rows.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
try {
  const ctxA = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const ctxB = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const errsA = [], errsB = [];
  pageA.on('pageerror', (e) => errsA.push(String(e.message || e)));
  pageB.on('pageerror', (e) => errsB.push(String(e.message || e)));

  // ① lobby 按钮流：从大厅页点「Create a room」（而非直接输 ?mode=friend），
  //    验证真实用户路径。大厅不存在时回退直跳。
  const lobbyUrl = `${BASE}/games/${GAME}/lobby/`;
  const lobbyResp = await pageA.goto(lobbyUrl, { waitUntil: 'load', timeout: 30000 }).catch(() => null);
  let viaLobby = false;
  if (lobbyResp && lobbyResp.ok()) {
    const btn = pageA.locator('#createRoom').first();
    if (await btn.count()) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      viaLobby = true;
    }
  }
  if (!viaLobby) await pageA.goto(`${BASE}/games/${GAME}/?mode=friend`, { waitUntil: 'load', timeout: 30000 });
  ok('lobby create-room button navigates', viaLobby, viaLobby ? 'clicked #createRoom' : 'fallback: direct ?mode=friend');

  // ② 等邀请卡 + 真房码
  const card = pageA.locator('.go-invite-card');
  let code = '';
  try {
    await card.waitFor({ state: 'visible', timeout: 20000 });
    await pageA.waitForFunction(
      () => { const c = document.querySelector('[data-role="code"]'); return c && /^[A-Z2-9]{6}$/.test((c.textContent || '').trim()); },
      { timeout: 20000 },
    );
    code = (await pageA.locator('[data-role="code"]').textContent().catch(() => '')).trim();
  } catch { /* 留在下面断言 */ }
  ok('invite card visible with 6-digit code', /^[A-Z2-9]{6}$/.test(code), code ? `code=${code}` : 'card/code not found');

  // ③ 链接 + QR
  const link = await pageA.locator('[data-role="link"]').inputValue().catch(() => '');
  ok('invite link = origin + /b/<game>/<CODE>',
    link === `${BASE}/b/${GAME}/${code}`, link || '(empty)');
  const qrOk = await pageA.locator('[data-role="qr"]').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false);
  ok('QR image loaded', qrOk === true, qrOk ? 'naturalWidth>0' : 'qr not loaded');

  // ④ 短链 302 → 深链（API 级，不跟跳）
  if (code) {
    const r = await fetch(`${BASE}/b/${GAME}/${code}`, { redirect: 'manual' });
    const loc = r.headers.get('location') || '';
    ok('short link /b/<game>/<CODE> 302 → deep link',
      r.status === 302 && loc.includes(`/games/${GAME}/`) && loc.includes(`c=${code}`),
      `${r.status} → ${loc.slice(0, 80)}`);
  } else {
    ok('short link /b/<game>/<CODE> 302 → deep link', false, 'no code');
  }

  // ⑤ B 端开短链入房（MutationObserver 事前抓 toast 房码）
  if (code) {
    await pageB.addInitScript((c) => {
      window.__codeSeen = false;
      const check = () => {
        if (!window.__codeSeen && document.body && document.body.innerText.includes(c)) window.__codeSeen = true;
      };
      const obs = new MutationObserver(check);
      const start = () => obs.observe(document.documentElement || document, { childList: true, subtree: true, characterData: true });
      if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true });
      setInterval(check, 250);
    }, code);
    await pageB.goto(`${BASE}/b/${GAME}/${code}`, { waitUntil: 'load', timeout: 45000 });
    await pageB.waitForTimeout(2500);
    let seenB = await pageB.evaluate(() => window.__codeSeen === true).catch(() => false)
      || await pageB.locator('body').innerText().then((t) => t.includes(code)).catch(() => false);
    for (let i = 0; i < 90 && !seenB; i++) {
      await pageB.waitForTimeout(500);
      seenB = await pageB.evaluate(() => window.__codeSeen === true).catch(() => false)
        || await pageB.locator('body').innerText().then((t) => t.includes(code)).catch(() => false);
    }
    ok('B joins via short link, code surfaced', seenB, `url=${pageB.url().slice(0, 60)}`);
    // A 端应感知对手入房（邀请卡/状态变化）——弱断言：A 端无 pageerror 且房间仍活
    ok('A stays alive after B joins', errsA.length === 0, errsA.slice(0, 1).join(' | '));
  }

  ok('no pageerror (B)', errsB.length === 0, errsB.slice(0, 1).join(' | '));
  await ctxA.close().catch(() => {});
  await ctxB.close().catch(() => {});
} finally {
  await browser.close();
}
console.log(rows.join('\n'));
console.log(`\n${failed === 0 ? 'ALL GREEN' : failed + ' FAILED'} — base=${BASE} game=${GAME}`);
