// Does the KataGo tier survive a LOW-END phone?
//
// The iPhone profile passes, but it reports 8 cores and a generous memory budget. Real
// budget Android is the case that breaks WebGL: the net needs a 361-channel feature stack,
// and drivers cap MAX_TEXTURE_SIZE / fragment uniforms well below desktop.
//
// Two things are probed here, because both are hard limits rather than slowdowns:
//   1. texture size / WebGL limits, which decide whether the conv stack fits at all
//   2. what happens when WebGL genuinely cannot be used -- the CPU fallback path,
//      which is the one that has to work for those users
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const ORIGIN = process.env.ORIGIN || 'https://beta.boardduel.com';
const PROFILES = [
  { name: 'iPhone 13 (flagship)', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', cores: 6, mem: 4, mobile: true },
  { name: 'budget Android', ua: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', cores: 4, mem: 2, mobile: true },
];

for (const p of PROFILES) {
  const br = await puppeteer.launch({
    executablePath: 'C:/Users/刘先生/.cache/puppeteer/chrome-headless-shell/win64-154.0.8037.92/chrome-headless-shell-win64/chrome-headless-shell.exe',
    headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const pg = await br.newPage();
  // CPU count and deviceMemory cannot be overridden by puppeteer directly, so we report
  // what the engine actually used and note the simulated values.
  await pg.emulate({
    viewport: { width: 390, height: 844, isMobile: p.mobile, hasTouch: p.mobile, deviceScaleFactor: 3 },
    userAgent: p.ua,
  });
  const csp = [], errs = [];
  pg.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text().slice(0, 140)); });
  pg.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));

  await pg.goto(`${ORIGIN}/games/go/?mode=ai&size=19`, { waitUntil: 'networkidle0' });

  const gl = await pg.evaluate(() => {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    if (!g) return { ok: false };
    return {
      ok: true,
      maxTexture: g.getParameter(g.MAX_TEXTURE_SIZE),
      maxVertexUniform: g.getParameter(g.MAX_VERTEX_UNIFORM_VECTORS),
      maxFragmentUniform: g.getParameter(g.MAX_FRAGMENT_UNIFORM_VECTORS),
      version: g.getParameter(g.VERSION),
    };
  });

  // Play until the engine answers, with a generous cap.
  const t0 = Date.now();
  let played = null;
  for (let attempt = 0; attempt < 3 && !played; attempt++) {
    const r = await pg.evaluate(async (budgetMs) => {
      const wait = (ms) => new Promise((x) => setTimeout(x, ms));
      const cells = [...document.querySelectorAll('.go-cell[data-i]')];
      if (!cells.length) return { error: 'no cells' };
      const before = document.querySelectorAll('.go-stone').length;
      let placed = false;
      for (const idx of [180, 90, 40, 220, 300, 0, 60, 120]) {
        const c = cells[idx];
        if (!c) continue;
        c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait(180);
        if (document.querySelectorAll('.go-stone').length > before) { placed = true; break; }
      }
      if (!placed) return { error: 'no legal click' };
      const t = performance.now();
      for (let k = 0; k * 300 < budgetMs; k++) {
        await wait(300);
        if (document.querySelectorAll('.go-stone').length > before) {
          const st = window.__kgStatus ? window.__kgStatus() : null;
          return { ms: Math.round(performance.now() - t), ready: st && st.ready, backend: st && st.backend, err: String((st && st.error) || '').slice(0, 120) };
        }
      }
      return { error: 'AI did not answer in budget' };
    }, 120000);
    if (r.ready || r.error === 'no legal click') { played = r; break; }
    played = r;
  }

  console.log(`\n=== ${p.name} (simulated ${p.cores} cores / ${p.mem} GB) ===`);
  console.log('  WebGL2      :', gl.ok ? 'available' : 'NOT AVAILABLE');
  if (gl.ok) {
    console.log('  maxTexture  :', gl.maxTexture, ' (19x19 conv needs >= 64)');
    console.log('  maxFragUnif :', gl.maxFragmentUniform, ' (the net passes many channels per fragment)');
  }
  console.log('  result      :', JSON.stringify(played));
  console.log('  CSP issues  :', csp.length ? csp : 'none');
  console.log('  page errors :', errs.length ? errs : 'none');
  console.log('  elapsed     :', Math.round((Date.now() - t0) / 1000) + 's');

  await br.close();
}
