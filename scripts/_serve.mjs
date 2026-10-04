// Shared static server for the local dist/ probes (no CSP header, same as the real
// Pages setup only in content -- CSP comes from _headers in production).
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.gz': 'application/gzip', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

export function serveDist(dist, port) {
  const s = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    let f = path.resolve(dist, '.' + u);
    if (u.endsWith('/')) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) {
      const a = path.join(f, 'index.html');
      if (fs.existsSync(a)) f = a;
      else { r.writeHead(404, { 'Content-Type': 'text/plain' }); r.end('404 ' + u); return; }
    }
    if (fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('404 dir'); return; }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((res) => s.listen(port, () => res(s)));
}
