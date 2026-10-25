#!/usr/bin/env node
/**
 * dist 静态伺服（本地验证用）：vite dev/preview 在沙箱里起不来
 * （esbuild service 子进程被沙箱杀 → TS 配置静默失败），用原生 http 伺服
 * dist/ 代替，端口默认 5299。目录路径回退 index.html。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.env.DIST_ROOT || 'C:/Game/boardduel-web/dist';
const PORT = Number(process.env.PORT || 5299);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml',
};

createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = normalize(p).replace(/^([./\\])+/, '');
    const f = join(ROOT, rel);
    let served = null;
    let body = await readFile(f).catch(() => null);
    if (body) served = f;
    if (!body && !extname(f)) {
      body = await readFile(join(f, 'index.html')).catch(() => null);
      if (body) served = join(f, 'index.html');
    }
    if (!body && !extname(f)) {
      body = await readFile(join(ROOT, 'index.html')).catch(() => null);
      if (body) served = join(ROOT, 'index.html');
    }
    if (!body) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(served)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`static up on ${PORT} root=${ROOT}`));
