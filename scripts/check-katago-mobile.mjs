// Mobile verification for the KataGo tier, run against a real phone profile
// (iPhone UA + touch + mobile viewport) on the LIVE site.
//
// 🔴 THE ASSERTION THAT MATTERS: a stone appearing on the board proves nothing.
// The previous run reported "AI replied (2 stones)" while the engine had actually
// thrown "tf.decode is not a function" and silently fallen back to the hard rule
// engine. So the hard requirement here is that the NEURAL engine reports ready
// with a real TF.js backend. Anything else is a failure, not a pass.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const ORIGIN = process.env.ORIGIN || 'https://beta.boardduel.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const br = await puppeteer.launch({
  executablePath: 'C:/Users/刘先生/.cache/puppeteer/chrome-headless-shell/win64-154.0.8037.92/chrome-headless-shell-win64/chrome-headless-shell.exe',
  headless: 'shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const pg = await br.newPage();
await pg.emulate({
  viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
});

const csp = [], errors = [], failed = [], warns = [];
pg.on('console', (m) => {
  const s = m.text();
  if (/Content Security Policy|Refused to|violates/i.test(s)) csp.push(s.slice(0, 200));
  if (m.type() === 'warning' || m.type() === 'error') warns.push(`${m.type()}: ${s.slice(0, 160)}`);
});
pg.on('pageerror', (e) => errors.push(String(e).slice(0, 250)));
pg.on('requestfailed', (r) => failed.push(`${r.url().split('/').slice(-1)[0]} :: ${r.failure()?.errorText}`));

// Track the model download so we can see it actually arrives, with progress.
let modelResp = null;
pg.on('response', (r) => {
  if (/b6c96\.bin\.gz/.test(r.url())) modelResp = { status: r.status(), len: r.headers()['content-length'] || '?' };
});

console.log(`target ${ORIGIN} · iPhone profile`);
await pg.goto(`${ORIGIN}/games/go/?mode=ai&size=19`, { waitUntil: 'networkidle0' });
console.log('page:', await pg.evaluate(() => location.pathname + location.search));

const caps = await pg.evaluate(() => {
  const c = document.createElement('canvas');
  const gl2 = c.getContext('webgl2');
  return {
    webgl2: !!gl2,
    mem: navigator.deviceMemory ?? null,
    cores: navigator.hardwareConcurrency,
    dpr: window.devicePixelRatio,
  };
});
console.log('1) caps:', JSON.stringify(caps));

const tiers = await pg.evaluate(() =>
  [...document.querySelectorAll('.go-level-opt')].map((b) => b.dataset.level));
const sizes = await pg.evaluate(() =>
  [...document.querySelectorAll('#go-sizes button')].map((b) => b.dataset.size));
console.log('2) tiers:', tiers.join(',') || '(none)', '| sizes:', sizes.join(',') || '(none)');

// Play one move and wait for the engine to answer, sampling the load card.
const played = await pg.evaluate(async () => {
  const card = document.getElementById('go-kg-load');
  const bar = document.getElementById('go-kg-bar');
  const txt = document.getElementById('go-kg-txt');
  const seen = [];
  const cells = [...document.querySelectorAll('.go-cell[data-i]')];
  if (!cells.length) return { error: 'no board cells' };
  cells[Math.floor(cells.length / 2)].dispatchEvent(new MouseEvent('click', { bubbles: true }));

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const stones = document.querySelectorAll('.go-stone').length;
    const st = window.__kgStatus ? window.__kgStatus() : null;
    if (i < 6 || st?.ready || stones >= 2) {
      seen.push(`${i + 1}s stones=${stones} card=${card && !card.hidden ? (bar?.style.width || '?') : 'hidden'} txt=${(txt?.textContent || '').slice(0, 24)} ready=${st?.ready} backend=${st?.backend} err=${(st?.error || '').slice(0, 60)}`);
    }
    if (st?.ready && stones >= 2) break;
  }
  const st = window.__kgStatus ? window.__kgStatus() : null;
  return { seen: seen.slice(-12), status: st, stones: document.querySelectorAll('.go-stone').length };
});
console.log('3) play trace:');
(played.seen || []).forEach((l) => console.log('   ', l));
if (played.error) console.log('   error:', played.error);

console.log('4) engine status:', JSON.stringify(played.status));
console.log('   model response:', modelResp ? JSON.stringify(modelResp) : 'NONE');

const v = [];
if (tiers.length === 1 && tiers[0] === 'katago') v.push('single katago tier'); else v.push('TIERS BAD');
if (sizes.length === 1 && sizes[0] === '19') v.push('19x19 only'); else v.push('SIZES BAD');
if (modelResp?.status === 200) v.push('model 200'); else v.push('MODEL BAD');
if (played.status?.ready) v.push(`NEURAL READY (${played.status.backend})`);
else v.push(`ENGINE NOT READY (${(played.status?.error || 'no status hook').slice(0, 80)})`);
if (played.stones >= 2) v.push('AI moved'); else v.push('AI DID NOT MOVE');
if (csp.length === 0) v.push('CSP clean'); else v.push(`CSP ${csp.length}`);
if (errors.length === 0) v.push('no page errors'); else v.push(`${errors.length} page errors`);

console.log('\nCSP violations:', csp.length ? csp : 'none');
console.log('request failures:', failed.length ? failed : 'none');
console.log('page errors:', errors.length ? errors : 'none');
console.log('warnings:', warns.length ? warns.slice(0, 4) : 'none');
console.log('\nMOBILE VERDICT:', v.join(' | '));

await br.close();
process.exit(/BAD|NOT READY/.test(v.join(' ')) ? 1 : 0);
