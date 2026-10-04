// End-to-end check that the KataGo tier works in a real browser against the BUILT
// output in dist/ (not the dev server).
//
// Red line 18: the site's CSP is `default-src 'self'` with no `wasm-unsafe-eval`.
// TF.js WebGL does not need WASM, so this should pass -- but "should" is a hypothesis
// until measured, which is the whole point of this script.
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');   // ESM ignores NODE_PATH

const DIST = 'D:/GAME/boardduel-web/dist';
const PORT = 8951;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.gz': 'application/gzip',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // Resolve strictly: a trailing slash means "<dir>/index.html". Using path.join on a
  // trailing-slash path collapses to the dir itself, which then gets the 404 branch --
  // that bug made /games/go/ appear to serve the lobby.
  let f = path.resolve(DIST, '.' + url);
  if (url.endsWith('/')) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) {
    // directory without trailing slash -> try its index.html
    const alt = path.join(f, 'index.html');
    if (fs.existsSync(alt)) f = alt;
    else { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 ' + url); return; }
  }
  if (fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404 dir'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const br = await puppeteer.launch({
  executablePath: 'C:/Users/刘先生/.cache/puppeteer/chrome-headless-shell/win64-154.0.8037.92/chrome-headless-shell-win64/chrome-headless-shell.exe',
  headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const pg = await br.newPage();
const csp = [], errors = [], failed = [];
pg.on('console', (m) => {
  const s = m.text();
  if (/Content Security Policy|Refused to/i.test(s)) csp.push(s.slice(0, 220));
});
pg.on('pageerror', (e) => errors.push(String(e).slice(0, 220)));
pg.on('requestfailed', (r) => failed.push(`${r.url().split('/').slice(-2).join('/')} :: ${r.failure()?.errorText}`));
// must be attached before the level is picked, or the model fetch happens before we listen
let modelResp = null;
pg.on('response', (r) => {
  if (/b6c96\.bin\.gz/.test(r.url())) modelResp = { status: r.status(), len: r.headers()['content-length'] || '?' };
});
let tfResp = [];
pg.on('response', (r) => { if (/tf-(core|backend)/.test(r.url())) tfResp.push(`${r.url().split('/').pop()}:${r.status()}`); });

// The go page enforces a two-step entry (red line: "裸访问 → 回模式大厅"), so a bare
// /games/go/ immediately replaces the URL to /games/go/lobby/ and the difficulty picker
// never exists there. Must deep-link with ?mode=ai&size=9.
await pg.goto(`http://127.0.0.1:${PORT}/games/go/?mode=ai&size=9`, { waitUntil: 'networkidle0' });
const pagePath = await pg.evaluate(() => location.pathname);
console.log('   loaded:', pagePath);

// 1) difficulty options
const levels = await pg.evaluate(() =>
  [...document.querySelectorAll('.go-level-opt')].map((b) => b.dataset.level));
const lvOK = levels.length === 3 && levels.includes('katago') && !levels.includes('easy');
console.log(`1) difficulty options: [${levels.join(', ')}]  ${lvOK ? 'OK' : 'MISMATCH (expected medium, hard, katago)'}`);

// 2) katago label must be translated, not the raw fallback
const katagoLabel = await pg.evaluate(() => {
  const b = [...document.querySelectorAll('.go-level-opt')].find((x) => x.dataset.level === 'katago');
  return b ? { title: b.querySelector('b')?.textContent, sub: b.querySelector('span')?.textContent } : null;
});
console.log('2) katago button text:', JSON.stringify(katagoLabel));

// 3) pick the katago tier, then actually play a move so the AI has to reply. Without a
//    reply there is no forward pass, and "the page loaded" proves nothing.
const aiTurn = await pg.evaluate(async () => {
  const pick = [...document.querySelectorAll('.go-level-opt')].find((b) => b.dataset.level === 'katago');
  if (!pick) return { error: 'katago button not present' };
  pick.click();
  await new Promise((r) => setTimeout(r, 400));
  // human is black and moves first. The clickable points are transparent <rect> inside
  // <g class="go-cell" data-i="N"> (render.ts), so click one of those.
  const cells = [...document.querySelectorAll('.go-cell[data-i]')];
  let clicked = null;
  if (cells.length) {
    cells[Math.floor(cells.length / 2)].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    clicked = cells[Math.floor(cells.length / 2)].getAttribute('data-i');
  }
  return { picked: pick.dataset.level, clickedSpot: clicked, cellCount: cells.length };
});
console.log('3) level pick + first move:', JSON.stringify(aiTurn));

// wait for the model fetch + parse (5 MB + TF.js, generous cap)
console.log('4) waiting for the model to load (up to 120 s)…');
const t0 = Date.now();
await new Promise((r) => setTimeout(r, 60000));

const diag = await pg.evaluate(() => ({
  tf: typeof window.tf,
  backend: window.tf?.getBackend?.() ?? null,
  toast: [...document.querySelectorAll('[class*=toast],[role=status]')].map((e) => e.textContent?.trim()).filter(Boolean).slice(0, 3),
  stones: document.querySelectorAll('.go-stone').length,
  // a white stone appearing means the neural tier actually produced a move
  whiteStones: document.querySelectorAll('.go-stone.w, .go-stone[data-color="2"], .go-stone.white').length,
  movesText: document.querySelector('#bd-moves, #go-moves')?.textContent?.trim() ?? null,
}));
console.log('   tf global:', diag.tf, ' backend:', diag.backend);
console.log('   tfjs responses:', tfResp.length ? tfResp.join(' ') : 'NONE');
console.log('   model response:', modelResp ? JSON.stringify(modelResp) : 'NONE');
console.log('   stones on board:', diag.stones, ' white:', diag.whiteStones);
console.log('   toasts:', diag.toast);
console.log('   elapsed:', Math.round((Date.now() - t0) / 1000) + 's');

const verdict = [];
if (levels.length === 3 && levels.includes('katago') && !levels.includes('easy')) verdict.push('tiers OK');
else verdict.push('tiers MISMATCH');
if (csp.length === 0) verdict.push('no CSP violations'); else verdict.push(`CSP: ${csp.length}`);
if (modelResp && modelResp.status === 200) verdict.push('model fetched'); else verdict.push('model NOT fetched');
if (diag.tf === 'object') verdict.push('tfjs loaded'); else verdict.push('tfjs MISSING');
if (diag.stones >= 2) verdict.push(`AI replied (${diag.stones} stones)`); else verdict.push('AI did NOT reply');
console.log('\nVERDICT:', verdict.join(' | '));

console.log('\nCSP violations:', csp.length ? csp : 'none');
console.log('request failures:', failed.length ? failed : 'none');
console.log('page errors:', errors.length ? errors : 'none');

await br.close();
server.close();
