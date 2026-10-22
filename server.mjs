#!/usr/bin/env node
// Aeroplan — production static server with SPA fallback (port 1932)
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createGzip } from 'node:zlib';

const PORT = Number(process.env.PORT || 1932);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = resolve(process.env.ROOT || './dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(ROOT, safePath);

  if (urlPath.endsWith('/')) filePath = join(filePath, 'index.html');
  if (!isFile(filePath)) {
    // directory -> index.html, otherwise SPA fallback
    if (isFile(join(filePath, 'index.html'))) filePath = join(filePath, 'index.html');
    else filePath = join(ROOT, 'index.html');
  }

  if (!filePath.startsWith(ROOT) || !isFile(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  };
  // hashed assets -> immutable
  if (/assets\//.test(filePath) && /-[A-Za-z0-9_]{8}\./.test(filePath)) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  } else if (ext === '.html' || filePath.endsWith('version.json')) {
    headers['Cache-Control'] = 'no-cache';
  }

  const gzipOk =
    ['text', 'json', 'javascript', 'svg', 'xml'].some((t) => headers['Content-Type'].includes(t)) &&
    /\bgzip\b/.test(req.headers['accept-encoding'] || '');

  if (gzipOk) headers['Content-Encoding'] = 'gzip';

  res.writeHead(200, headers);
  const stream = createReadStream(filePath);
  if (gzipOk) stream.pipe(createGzip()).pipe(res);
  else stream.pipe(res);
  stream.on('error', () => res.end());
});

server.listen(PORT, HOST, () => {
  console.log(`Aeroplan running on http://${HOST}:${PORT} (root: ${ROOT})`);
});
