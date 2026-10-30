#!/usr/bin/env node
import { readFile, realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const root = path.resolve(import.meta.dirname, '../..');
// No reset here: the shell must hide [hidden] elements and set its own margins when a host serves it as is.
export const wrapper = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };

export async function startServer({ fixture = path.join(root, 'out/shell'), config = {}, assets, port = 0 } = {}) {
  const base = await realpath(fixture);
  const imageBase = assets && await realpath(assets);
  const shell = await readFile(path.join(root, 'kit/index.html'), 'utf8');
  const json = JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = wrapper + '<script>window.__mockClaudeConfig=window.__mockClaudeConfig||' + json + ';</script>' +
    '<script src="dev/mock-claude.js"></script>' + shell + '</body></html>';
  const server = http.createServer(async (request, response) => {
    const send = (status, body = '', type = 'text/plain') => {
      response.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(request.method)) { send(405); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { send(400); return; }
    if (pathname === '/') { send(200, html, types['.html']); return; }
    if (pathname === '/favicon.ico') { send(204); return; }
    let file;
    try {
      if (pathname === '/dev/mock-claude.js') file = path.join(root, 'dev/mock-claude.js');
      else {
        const directory = imageBase && pathname.startsWith('/img/') ? imageBase : base;
        const relative = directory === imageBase ? pathname.slice(5) : pathname.slice(1);
        file = await realpath(path.resolve(directory, relative));
        if (!file.startsWith(directory + path.sep)) { send(403); return; }
      }
      if (!(await stat(file)).isFile()) { send(404); return; }
      send(200, await readFile(file), types[path.extname(file)] || 'application/octet-stream');
    } catch (error) {
      send(['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 400);
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [fixture, port = '4173'] = process.argv.slice(2);
  const running = await startServer({ fixture, port: Number(port) });
  console.log(`Feedback harness: ${running.url}`);
}
