// Run the same KataGo end-to-end checks against the LIVE site, not the local dist.
// This is the only way to verify the real production CSP header (red line 18) — the
// local static server sends no CSP at all, so a local pass proves nothing about CSP.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const ORIGIN = 'https://boardduel.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const br = await puppeteer.launch({
  executablePath: 'C:/Users/刘先生/.cache/puppeteer/chrome-headless-shell/win64-154.0.8037.92/chrome-headless-shell-win64/chrome-headless-shell.exe',
  headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const pg = await br.newPage();
const csp = [], errors = [], failed = [];
pg.on('console', (m) => {
  const s = m.text();
  if (/Content Security Policy|Refused to|violates/i.test(s)) csp.push(s.slice(0, 200));
});
pg.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
pg.on('requestfailed', (r) => failed.push(`${r.url().split('/').slice(-2).join('/')} :: ${r.failure()?.errorText}`));
let modelResp = null, tfResp = [];
pg.on('response', (r) => {
  if (/b6c96\.bin\.gz/.test(r.url())) modelResp = { status: r.status(), len: r.headers()['content-length'] || '?' };
  if (/tf-(core|backend)/.test(r.url())) tfResp.push(`${r.url().split('/').pop()}:${r.status()}`);
});

// The real CSP the browser enforces, straight from the live headers.
const cspHeader = await pg.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
  .then((r) => r.headers()['content-security-policy'] || '(none)');
console.log('live CSP:', cspHeader.length > 200 ? cspHeader.slice(0, 200) + '…' : cspHeader);

// Deep-link: a bare /games/go/ replaces itself to the lobby (two-step entry rule).
await pg.goto(`${ORIGIN}/games/go/?mode=ai&size=9`, { waitUntil: 'networkidle0' });
console.log('page:', await pg.evaluate(() => location.pathname + location.search));

const levels = await pg.evaluate(() =>
  [...document.querySelectorAll('.go-level-opt')].map((b) => b.dataset.level));
console.log('1) tiers:', levels.join(', ') || '(none)',
  levels.length === 3 && levels.includes('katago') && !levels.includes('easy') ? 'OK' : 'MISMATCH');

const label = await pg.evaluate(() => {
  const b = [...document.querySelectorAll('.go-level-opt')].find((x) => x.dataset.level === 'katago');
  return b ? { t: b.querySelector('b')?.textContent, s: b.querySelector('span')?.textContent } : null;
});
console.log('2) katago label:', JSON.stringify(label));

const played = await pg.evaluate(async () => {
  const pick = [...document.querySelectorAll('.go-level-opt')].find((b) => b.dataset.level === 'katago');
  if (!pick) return { error: 'katago button absent' };
  pick.click();
  await new Promise((r) => setTimeout(r, 500));
  const cells = [...document.querySelectorAll('.go-cell[data-i]')];
  if (!cells.length) return { error: 'no board cells' };
  cells[Math.floor(cells.length / 2)].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return { picked: pick.dataset.level, cells: cells.length };
});
console.log('3) play:', JSON.stringify(played));

console.log('4) waiting for model load (up to 90 s on the live CDN)…');
const t0 = Date.now();
for (let i = 0; i < 18; i++) {
  await sleep(5000);
  const d = await pg.evaluate(() => ({
    tf: typeof window.tf, b: window.tf?.getBackend?.() ?? null,
    s: document.querySelectorAll('.go-stone').length,
  }));
  if (d.s >= 2) { console.log(`   replied after ${Math.round((Date.now() - t0) / 1000)}s`); break; }
  if (i === 2 || i === 6) console.log(`   …${Math.round((Date.now() - t0) / 1000)}s tf=${d.tf} stones=${d.s}`);
}

const diag = await pg.evaluate(() => ({
  tf: typeof window.tf, backend: window.tf?.getBackend?.() ?? null,
  stones: document.querySelectorAll('.go-stone').length,
  toasts: [...document.querySelectorAll('[class*=toast],[role=status]')].map((e) => e.textContent?.trim()).filter(Boolean).slice(0, 3),
}));
console.log('   tf:', diag.tf, ' backend:', diag.backend, ' stones:', diag.stones);
console.log('   tfjs:', tfResp.join(' ') || 'NONE');
console.log('   model:', modelResp ? JSON.stringify(modelResp) : 'NONE');
console.log('   toasts:', diag.toasts);
console.log('\nCSP violations:', csp.length ? csp : 'none');
console.log('request failures:', failed.length ? failed : 'none');
console.log('page errors:', errors.length ? errors : 'none');

const v = [];
if (levels.length === 3 && levels.includes('katago') && !levels.includes('easy')) v.push('tiers OK'); else v.push('tiers BAD');
if (csp.length === 0) v.push('CSP clean'); else v.push(`CSP ${csp.length} violations`);
if (modelResp?.status === 200) v.push('model 200'); else v.push('model NOT ok');
if (diag.tf === 'object') v.push('tfjs loaded'); else v.push('tfjs MISSING');
if (diag.stones >= 2) v.push('AI replied'); else v.push('AI did NOT reply');
console.log('\nLIVE VERDICT:', v.join(' | '));

await br.close();
