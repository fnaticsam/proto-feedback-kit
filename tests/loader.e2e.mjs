import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const root = path.resolve(import.meta.dirname, '..');

test('embedded screens load through document.write and appendChild without network requests', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'loader-e2e-'));
  const out = path.join(dir, 'out.html');
  await promisify(execFile)(process.execPath, [path.join(root, 'tools/bundle.mjs'), '--src', path.join(root, 'dev/fixtures/mini'),
    '--out', out, '--version', '1', '--embed-glob', 'screens/*.js']);
  const requested = [];
  const server = http.createServer((request, response) => {
    if (request.url === '/out.html') { createReadStream(out).pipe(response); return; }
    if (request.url !== '/favicon.ico') requested.push(request.url);
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(() => { window.claude = { use: () => null }; });
    await page.goto(`http://127.0.0.1:${server.address().port}/out.html`);
    assert.deepEqual(await page.evaluate(() => window.order), ['app', 'manifest', 'one']);
    assert.equal(await page.evaluate(() => window.accents), 'cafe ✓');
    await page.evaluate(() => window.loadTwo());
    await page.waitForFunction(() => window.order.includes('two loaded'), null, { timeout: 2000 });
    assert.deepEqual(await page.evaluate(() => window.order), ['app', 'manifest', 'one', 'two', 'two loaded']);
    assert.deepEqual(requested, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
