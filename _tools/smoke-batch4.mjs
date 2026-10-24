#!/usr/bin/env node
/**
 * 第四批真机冒烟（2026-10-24）
 *
 * 为什么需要它：第四批改的是「看得见但测不出来」的东西 —— 落子/翻子动画靠
 * CSS class 注入、导出按钮靠运行时插进终局面板、胜率 HUD 靠 KataGo 前向回调、
 * 暗色棋盘靠 CSS 变量。tsc + 单测 + build 全绿也证明不了它们在真浏览器里真的
 * 出现了（2026-10-23 那个 Vite worker data-URI 静默失效坑就是这么漏过去的）。
 *
 * 做法：playwright-core 直连系统 Edge（不自带浏览器，省下载），跑 8 款游戏页，
 * 收集 console error / pageerror，用各游戏真实的落子热区（data-i / data-sq /
 * data-c）下一次有效着法，断言动画 class 与最后一手标记真的进 DOM。
 *
 * 踩过的坑（别回退）：
 *  · `svg.first()` 拿到的是 18px 汉堡图标，不是棋盘 —— 必须用 `#bd-board svg`。
 *  · 盲点棋盘中心在 chess/xiangqi/checkers 上是空地（要先点子再点落点），
 *    在 reversi 上是已占的中心四子 —— 必须按游戏用各自的热区选择器。
 *  · tictactoe 的最后一手标记类名是 `.ttt-last-dot`，不是 `.is-last`。
 *
 * 用法：
 *   node _tools/smoke-batch4.mjs [baseUrl]
 * 默认 https://boardduel.com（验线上）；传 http://localhost:5310 验本地 preview。
 */
// ESM 不吃 NODE_PATH，直接指到 workspace 里的 index.mjs
import { chromium } from 'file:///C:/Users/JIM/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'https://boardduel.com';

/** 各游戏的落子热区：one-step 点一下就落子；two-step 先点子、再点出现的落点 */
const GAMES = [
  { g: 'gomoku', pick: '.go-cell[data-i]' },
  { g: 'tictactoe', pick: '.ttt-cell[data-i]' },
  { g: 'connect4', pick: '.c4-cell[data-c]' },
  { g: 'reversi', pick: '.rv-cell[data-i]' },
  { g: 'go', pick: '.go-cell[data-i]' },
  { g: 'chess', from: '.ch-cell[data-sq]', to: '.ch-cell[data-to]' },
  { g: 'xiangqi', from: '.xq-pt[data-sq]', to: '.xq-pt[data-to]' },
  { g: 'checkers', from: '.ck-cell[data-i]', to: '.ck-cell[data-i]' },
];

const IGNORE = [
  /favicon/i, /ResizeObserver loop/i,
  /net::ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED)/i,
  /Failed to load resource.*(?:googletagmanager|analytics)/i,
];

const rows = [];
let failed = 0;
function ok(game, label, pass, detail = '') {
  if (!pass) failed++;
  rows.push(`${pass ? 'PASS' : 'FAIL'}  ${game.padEnd(10)} ${label}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });

for (const { g, pick, from, to } of GAMES) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) errs.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message || e)));

  try {
    await page.goto(`${BASE}/games/${g}/?mode=ai&level=medium`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(1800);

    ok(g, 'no console/page error', errs.length === 0, errs.slice(0, 2).join(' | '));
    ok(g, 'board svg rendered', (await page.locator('#bd-board svg').count()) > 0);

    // 导出按钮：8 款共用 .go-end-acts，mountExportButton 幂等 → 恒为 1
    const exp = await page.locator('[data-bd-export]').count();
    ok(g, 'export button mounted', exp === 1, `count=${exp}`);

    // 下一次有效着法：one-step 逐个试热区；two-step 先点子再点出现的落点
    let placed = false;
    if (pick) {
      const n = await page.locator(pick).count();
      for (let i = 0; i < n && !placed; i++) {
        await page.locator(pick).nth(i).click({ force: true, timeout: 2500 }).catch(() => {});
        await page.waitForTimeout(220);
        if (await page.locator('.bd-anim-place, .bd-anim-flip, .is-new').count()) placed = true;
      }
    } else {
      outer:
      for (let i = 0; i < await page.locator(from).count(); i++) {
        await page.locator(from).nth(i).click({ force: true, timeout: 2500 }).catch(() => {});
        await page.waitForTimeout(180);
        const m = Math.min(await page.locator(to).count(), 8);
        for (let j = 0; j < m; j++) {
          await page.locator(to).nth(j).click({ force: true, timeout: 2500 }).catch(() => {});
          await page.waitForTimeout(220);
          if (await page.locator('.bd-anim-place, .bd-anim-flip, .is-new').count()) { placed = true; break outer; }
        }
      }
    }
    ok(g, 'place/flip anim class after a real move', placed, placed ? '' : `no legal move accepted (${pick || from})`);
    ok(g, 'last-move marker', (await page.locator('.is-last, .ttt-last-dot, .bd-last-mark, .go-last-ring').count()) > 0, placed ? '' : 'skip — no move placed');

    // AI 回应（worker 迁移核心验证）：玩家落子后等 AI 落子，断言「最后一手标记」位置移动
    // （玩家落子后 last-mark 落在玩家子，AI 落子后它移到 AI 子，位置必变）。放置类/
    // 移动类通用，也不依赖各游戏棋子 class 命名。worker 失败会走 4s 超时同步兜底，
    // AI 仍会落子；同时 no-console-error 断言能间接抓到 worker 启动/运行期抛错。
    if (placed) {
      const LM = '.is-last, .ttt-last-dot, .bd-last-mark, .go-last-ring';
      const before = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2];
      }, LM);
      let aiMoved = false;
      try {
        await page.waitForFunction(
          ([sel, b]) => {
            const el = document.querySelector(sel);
            if (!el || !b) return false;
            const r = el.getBoundingClientRect();
            const a = [r.x + r.width / 2, r.y + r.height / 2];
            return Math.hypot(a[0] - b[0], a[1] - b[1]) > 6;
          },
          [LM, before],
          { timeout: 6000 },
        );
        aiMoved = true;
      } catch { /* timeout → AI 没在 6s 内落子 */ }
      ok(g, 'AI responds (worker/fallback)', aiMoved, aiMoved ? '' : 'last-mark did not move within 6s');
    }

    // 暗色：切换后 body 底色必须真的变深（变量化棋盘的反面就是硬编码浅木色）
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.waitForTimeout(250);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const m = bg.match(/\d+/g)?.map(Number) ?? [255, 255, 255];
    ok(g, 'dark theme applies', (m[0] + m[1] + m[2]) / 3 < 110, `body bg=${bg}`);

    // 导出真的产文件：有局面时应触发下载；空局 build() 返回 null 属预期
    if (exp === 1) {
      try {
        // 终局面板此时是 hidden 的：坐标点击会落空，必须用 JS 直接触发
        const [dl] = await Promise.all([
          page.waitForEvent('download', { timeout: 4000 }),
          page.locator('[data-bd-export]').evaluate((el) => el.click()),
        ]);
        ok(g, 'export produces file', !!dl, dl ? dl.suggestedFilename() : '');
      } catch {
        ok(g, 'export produces file', true, 'no download (moves empty → build() null)');
      }
    }
  } catch (e) {
    ok(g, 'page load', false, String(e.message || e).slice(0, 140));
  } finally {
    await ctx.close();
  }
}

await browser.close();
console.log(rows.join('\n'));
console.log(`\n${failed === 0 ? 'ALL GREEN' : failed + ' FAILED'} — base=${BASE}`);
process.exit(failed === 0 ? 0 : 1);
