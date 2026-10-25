#!/usr/bin/env node
/**
 * boardduel 对决模式（联机）双端闭环实测 v4（2026-10-25）
 *
 * 版本演进（方法论教训，勿回退）：
 *  v1：占用格选择器靠猜（.go-cell 只是透明命中区，不是棋子）→ 落子计数恒 0。
 *     真实棋子 class：gomoku=.go-stone / ttt=.ttt-mark / c4=.c4-piece /
 *     reversi=.rv-stone（排除 .is-hint）/ chess=.ch-piece / xq=.xq-piece /
 *     checkers=.ck-piece / go=.go-stone。
 *  v2：改双端盘面指纹，但指纹用 getBoundingClientRect()（视口坐标）——
 *     滚动/布局微差即假阳性（实测 gomoku ply2 起 A/B 数量一致却判 diverged）。
 *  v3：指纹改棋盘固有坐标：SVG 元素取 getCTM()（含自身 transform + viewBox
 *     映射，免疫滚动/布局/CSS 变换；注意不能用 getBBox()——chess/xq 棋子位置
 *     编码在 <g transform> 上，getBBox 不含自身 transform 会位置盲）；
 *     HTML 元素取 offsetLeft/Top 链相对 #bd-board。附加 computed 颜色防
 *     "位置对颜色错"。v3 暴露两件事：
 *      ① chess ply3 瞬时分叉又收敛 = 真 bug 症状（.bd-anim-place 的 CSS
 *         transform 覆盖棋子 transform 属性 → 走子方屏幕快速恢复、对手屏幕
 *         钉子到 SVG 原点，直到下次重渲染）→ 已修（动画类改挂内层 g）。
 *      ② checkers 前 3 手全 no-move + B 端房码不可见 = 测试时序竞态：
 *         入房握手（ensureAccount + WS）要 5-9s，而 round 循环不等它。
 *         → v4 把房码 surfaced 轮询（20s）提到 round 循环前，兼作入房门。
 *
 * 覆盖：建房 API → 双 Tab 入房 → 等双端 live → 房码 surfaced 轮询 →
 *       轮流 4 手（每手双端指纹一致断言）→ 认输双端达终局 → 零 console 错误。
 *
 * v6（2026-10-25，对线上旧码基线暴露的测试自身缺陷，勿回退）：
 *   ① 房码 toast 2.2s 淡出 vs 轮询竞态（快端在边界连上，码出现即消失，
 *      500ms 轮询也可能整窗错过）→ addInitScript 注 MutationObserver
 *      事前捕获，__codeSeen 一旦置真即算 surfaced。
 *   ② 单 ply 分歧缺滞后甄别：线上方差下对手端 900ms 未应用该手（或落子
 *      动画未播完，CTM 含动画 transform）→ 分歧后延长 2.5s 复检，收敛记
 *      lag（不计失败），仍不一致才记 syncBad 并附首差异条目。
 *      判别力对照：旧码 chess P0（棋子钉 SVG 原点）会持续分歧 → 照杀。
 *   ③ console 错误补 location().url（"Failed to load resource" 不带 URL
 *      无法定位，c4 的 ERR_TIMED_OUT 曾因此成悬案）。
 *
 * 用法：node _tools/duel-closed-loop.mjs [baseUrl] [games...]
 */
import { chromium } from 'file:///C:/Users/JIM/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'https://www.boardduel.com';
const WANT = process.argv.slice(3);

/** pick = 放置类命中区；from/to = 选子类；piece = 指纹用棋子选择器 */
const GAMES = [
  { g: 'gomoku',    pick: '.go-cell[data-i]', piece: '.go-stone' },
  { g: 'tictactoe', pick: '.ttt-cell[data-i]', piece: '.ttt-mark' },
  { g: 'connect4',  pick: '.c4-cell[data-c]',  piece: '.c4-piece' },
  { g: 'reversi',   pick: '.rv-cell[data-i]',  piece: '.rv-stone:not(.is-hint)' },
  { g: 'go',        pick: '.go-cell[data-i]',  piece: '.go-stone' },
  { g: 'chess',     from: '.ch-cell[data-sq]', to: '.ch-cell[data-to]', piece: '.ch-piece' },
  { g: 'xiangqi',   from: '.xq-pt[data-sq]',   to: '.xq-pt[data-to]',   piece: '.xq-piece' },
  { g: 'checkers',  pick: '.ck-cell[data-i]',  piece: '.ck-piece' },
];
if (WANT.length) {
  const keep = GAMES.filter((x) => WANT.includes(x.g));
  GAMES.length = 0;
  GAMES.push(...keep);
}

const IGNORE = [
  /favicon/i, /ResizeObserver loop/i,
  /net::ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED)/i,
  /Failed to load resource.*(?:googletagmanager|analytics)/i,
];

const rows = [];
let failed = 0;
let lagEvents = 0;   // 传播滞后事件计数（v6：甄别后不计失败，仅汇总报告）
function ok(game, label, pass, detail = '') {
  if (!pass) failed++;
  rows.push(`${pass ? 'PASS' : 'FAIL'}  ${game.padEnd(10)} ${label}${detail ? ' — ' + detail : ''}`);
}
const cnt = (fp) => (fp === '' ? 0 : fp.split('|').length);
/** 两个已排序指纹的首个差异条目（诊断用，v6） */
const firstDiff = (a, b) => {
  const A = a.split('|'), B = b.split('|');
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] !== B[i]) return `${i}: ${(A[i] || '(缺)').slice(0, 46)} vs ${(B[i] || '(缺)').slice(0, 46)}`;
  }
  return '(未定位)';
};

async function createRoom(game) {
  const r = await fetch(`${BASE}/api/gp/room?name=审核甲&game=${game}`);
  const j = await r.json().catch(() => ({}));
  if (!j.ok || !j.code) throw new Error('createRoom failed: ' + JSON.stringify(j).slice(0, 120));
  return j.code;
}

/** 盘面指纹：棋子在棋盘里的固有几何 + 颜色（v3，见文件头） */
async function fp(page, sel) {
  return page.evaluate((s) => {
    const docOffset = (el) => {
      let x = 0, y = 0, n = el;
      while (n) { x += n.offsetLeft || 0; y += n.offsetTop || 0; n = n.offsetParent; }
      return [x, y];
    };
    const board = document.querySelector('#bd-board');
    const bo = board ? docOffset(board) : [0, 0];
    const out = [];
    for (const e of document.querySelectorAll(s)) {
      let key;
      if (typeof e.getCTM === 'function') {
        const m = e.getCTM();
        key = m
          ? `${m.a.toFixed(3)},${m.b.toFixed(3)},${m.c.toFixed(3)},${m.d.toFixed(3)},${m.e.toFixed(2)},${m.f.toFixed(2)}`
          : 'detached';
      } else {
        const [x, y] = docOffset(e);
        key = `${Math.round(x - bo[0])},${Math.round(y - bo[1])}`;
      }
      const cs = getComputedStyle(e);
      const color = cs.fill && cs.fill !== 'none' ? cs.fill : (cs.backgroundColor || '');
      out.push(`${key}#${color}`);
    }
    return out.sort().join('|');
  }, sel);
}

/** 尝试走一手；走成（指纹变化）返回 true */
async function tryOneMove(page, g) {
  const before = await fp(page, g.piece);
  if (g.pick) {
    const n = await page.locator(g.pick).count();
    if (n === 0) return false;              // 没渲染命中区 = 轮不到我 / 无合法点
    const step = n > 24 ? Math.ceil(n / 24) : 1;   // 全空格合法（gomoku/go）→ 抽样
    for (let i = 0; i < n; i += step) {
      await page.locator(g.pick).nth(i).click({ force: true, timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(200);
      if (await fp(page, g.piece) !== before) return true;
    }
  } else {
    const nf = await page.locator(g.from).count();
    if (nf === 0) return false;             // 轮不到我（chess/xq 命中区按回合渲染）
    for (let i = 0; i < nf; i++) {
      await page.locator(g.from).nth(i).click({ force: true, timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(250);
      const nt = await page.locator(g.to).count();
      for (let j = 0; j < Math.min(nt, 6); j++) {
        await page.locator(g.to).nth(j).click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(200);
        if (await fp(page, g.piece) !== before) return true;
      }
    }
  }
  return false;
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });

for (const g of GAMES) {
  const errsA = [], errsB = [];
  let ctxA, ctxB, pageA, pageB;
  try {
    const code = await createRoom(g.g);
    ok(g.g, 'room created via API', true, `code=${code}`);

    ctxA = await browser.newContext({ viewport: { width: 900, height: 1000 } });
    ctxB = await browser.newContext({ viewport: { width: 900, height: 1000 } });
    pageA = await ctxA.newPage();
    pageB = await ctxB.newPage();
    const onConsole = (tag, errs) => (m) => {
      if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) {
        const url = m.location && m.location().url;   // "Failed to load resource" 必须带 URL 才能定位（v6：c4 ERR_TIMED_OUT 教训）
        errs.push(`${tag} console: ${m.text()}${url ? ` @ ${url}` : ''}`);
      }
    };
    pageA.on('console', onConsole('A', errsA));
    pageA.on('pageerror', (e) => errsA.push('A pageerror: ' + String(e.message || e)));
    pageB.on('console', onConsole('B', errsB));
    pageB.on('pageerror', (e) => errsB.push('B pageerror: ' + String(e.message || e)));

    // 房码 toast 只存 2.2s（showBoardDuelToast dur），轮询（哪怕 500ms 间隔）
    // 与"快端刚好在边界连上"竞态 → v6 改 MutationObserver 事前捕获：
    // addInitScript 在导航前注入，toast 任何时候出现都置 __codeSeen。
    const watchCode = (code) => {
      window.__codeSeen = false;
      const check = () => {
        if (!window.__codeSeen && document.body && document.body.innerText.includes(code)) {
          window.__codeSeen = true;
        }
      };
      const obs = new MutationObserver(check);
      const start = () => obs.observe(document.documentElement || document,
        { childList: true, subtree: true, characterData: true });
      if (document.documentElement) start();
      else document.addEventListener('readystatechange', start, { once: true });
      setInterval(check, 250);
    };
    await pageA.addInitScript(watchCode, code);
    await pageB.addInitScript(watchCode, code);

    await pageB.goto(`${BASE}/games/${g.g}/?c=${code}`, { waitUntil: 'load', timeout: 45000 });
    await pageA.goto(`${BASE}/games/${g.g}/?c=${code}`, { waitUntil: 'load', timeout: 45000 });
    await pageA.waitForTimeout(2500);

    const seenNow = async (p) => p.evaluate(() => window.__codeSeen === true).catch(() => false);
    const codeA0 = (await seenNow(pageA)) || await pageA.locator('body').innerText().then((t) => t.includes(code)).catch(() => false);
    const codeB0 = (await seenNow(pageB)) || await pageB.locator('body').innerText().then((t) => t.includes(code)).catch(() => false);

    // 房码 surfaced 轮询（兼作"已入房"门）：
    //   · 加入流不弹邀请卡片（那是建房端 openFriendRoom 的），码只出现在
    //     连接 toast 里且会淡出（showBoardDuelToast dur=2.2s）—— 轮询 45s，
    //     出现过即算通过（v6 起以 MutationObserver 捕获为准，innerText 兜底）。
    //   · checkers v3/v4 教训：入房握手（页面加载 + ensureAccount + WS）在
    //     本环境要 2.4-8.5s，全程连跑 8 房时浏览器资源衰减会把某一端随机
    //     拖到 20s+（隔离诊断 3 连跑：哪端慢随机，入房后功能全正常）——
    //     是环境时序方差非产品 bug。门限放到 45s 覆盖；回合循环再兜底
    //     （见下：双方走成为止，上限 8 轮）。
    let seenA = codeA0, seenB = codeB0;
    for (let i = 0; i < 90 && !(seenA && seenB); i++) {
      await pageA.waitForTimeout(500);
      if (!seenA) seenA = (await seenNow(pageA)) || await pageA.locator('body').innerText().then((t) => t.includes(code)).catch(() => false);
      if (!seenB) seenB = (await seenNow(pageB)) || await pageB.locator('body').innerText().then((t) => t.includes(code)).catch(() => false);
    }
    ok(g.g, 'room code surfaced on both tabs', seenA && seenB, `A=${seenA} B=${seenB}`);

    // 开局指纹必须一致（同一起始局面）
    await pageB.waitForTimeout(800);
    const fpStartA = await fp(pageA, g.piece);
    const fpStartB = await fp(pageB, g.piece);
    ok(g.g, 'identical start position', fpStartA === fpStartB,
      fpStartA === fpStartB ? `${cnt(fpStartA)} pieces` : `A≠B (${fpStartA.slice(0, 40)} / ${fpStartB.slice(0, 40)})`);

    let movesA = 0, movesB = 0, syncBad = 0, round = 0, played = 0;
    // 至少 4 轮；若某一端因慢连接还没走成（v4 checkers 实测：后手方
    // 可能整场没轮到），继续交替到双方都走成，上限 8 轮。
    while (played < 8 && (played < 4 || movesA < 1 || movesB < 1)) {
      const tab = round % 2 === 0 ? pageA : pageB;
      const other = round % 2 === 0 ? pageB : pageA;
      const moved = await tryOneMove(tab, g);
      if (moved) { round % 2 === 0 ? movesA++ : movesB++; }
      played++;
      await other.waitForTimeout(900);
      let fa = await fp(pageA, g.piece);
      let fb = await fp(pageB, g.piece);
      let same = fa === fb;
      let detail = same ? `${cnt(fa)} pieces` : `A=${cnt(fa)} B=${cnt(fb)}`;
      if (!same) {
        // 传播滞后甄别（v6）：线上网络方差下，对手端 900ms 内可能还没应用
        // 这一手（或落子动画未播完，CTM 含动画 transform）。再等 2.5s 复检：
        // 收敛 = lag（环境时序，不计失败）；仍不一致 = 真分歧，带首差异条目。
        await pageA.waitForTimeout(2500);
        await pageB.waitForTimeout(2500);
        const fa2 = await fp(pageA, g.piece);
        const fb2 = await fp(pageB, g.piece);
        if (fa2 === fb2) { same = true; lagEvents++; detail += ' → lag, converged +2.5s'; }
        else detail = `A=${cnt(fa2)} B=${cnt(fb2)} diff[${firstDiff(fa2, fb2)}]`;
      }
      if (!same) syncBad++;
      ok(g.g, `sync after ply ${played}${moved ? '' : ' (no move)'}`, same, detail);
      round++;
    }
    ok(g.g, 'both sides placed >=1 move', movesA >= 1 && movesB >= 1, `A=${movesA} B=${movesB} (${played} plies)`);
    ok(g.g, 'zero desync across plies', syncBad === 0, syncBad ? `${syncBad} ply diverged` : '');

    await pageA.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /resign|认输|投降/i.test(b.textContent || ''));
      if (btn) btn.click();
    }).catch(() => {});
    await pageA.waitForTimeout(1500);
    const endA = await pageA.locator('.go-end-verdict, [id$="-end-verdict"]').count();
    const endB = await pageB.locator('.go-end-verdict, [id$="-end-verdict"]').count();
    ok(g.g, 'resign reaches both sides', endA > 0 && endB > 0, `A=${endA} B=${endB}`);

    ok(g.g, 'no console/pageerror (A)', errsA.length === 0, errsA.slice(0, 2).join(' | '));
    ok(g.g, 'no console/pageerror (B)', errsB.length === 0, errsB.slice(0, 2).join(' | '));
  } catch (e) {
    ok(g.g, 'duel loop', false, String(e.message || e).slice(0, 160));
  } finally {
    await ctxA?.close().catch(() => {});
    await ctxB?.close().catch(() => {});
  }
}

await browser.close();
console.log(rows.join('\n'));
console.log(`\n${failed === 0 ? 'ALL GREEN' : failed + ' FAILED'} — base=${BASE} (lag-events=${lagEvents})`);
process.exit(failed === 0 ? 0 : 1);
