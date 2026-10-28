import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';
import { root, startServer } from '../dev/harness/serve.mjs';
import { me } from '../dev/harness/data.mjs';
import { kit, post, row, testPage } from '../dev/harness/browser.mjs';

const source = path.join(root, 'dev/fixtures/custom-adapter');
const fixture = path.join(root, 'out/custom-adapter');
const manifest = { title: 'Garden fixture', versions: [1, 2].map(n => ({ n, file: `proto-v${n}.html`, title: `Round ${n}` })) };
let browser, harness, adapterScript;
before(async () => {
  await mkdir(fixture, { recursive: true });
  for (const version of manifest.versions) {
    await promisify(execFile)(process.execPath, [path.join(root, 'tools/bundle.mjs'), '--src', source,
      '--out', path.join(fixture, version.file), '--version', String(version.n)]);
  }
  await copyFile(path.join(source, 'adapters.js'), path.join(fixture, 'adapters.js'));
  adapterScript = await readFile(path.join(source, 'adapters.js'), 'utf8');
  await writeFile(path.join(fixture, 'versions.json'), JSON.stringify(manifest));
  harness = await startServer({ fixture });
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await harness?.close(); });

async function open(t, { adapter, script, status = 200, abort = false, beforeLoad } = {}) {
  const warnings = [];
  const page = await testPage(t, browser, harness.url, { config: { me }, beforeLoad: async page => {
    page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
    if (adapter !== undefined) await page.route('**/versions.json', route => route.fulfill({ json: { ...manifest, adapter } }));
    if (script !== undefined || status !== 200 || abort) await page.route('**/adapters.js', route => abort ? route.abort() : route.fulfill({
      status, contentType: 'text/javascript', body: script ?? ''
    }));
    if (beforeLoad) await beforeLoad(page);
  } });
  return { page, warnings };
}

test('detect chooses the first registered adapter that recognises the prototype', async t => {
  const { page, warnings } = await open(t, { script: adapterScript + `
    window.kitAdapters.unshift({ ...window.kitAdapters[0], name: 'other', detect() { return false; } });
    window.kitAdapters.push({ ...window.kitAdapters[1], name: 'later', screen() { return { id: 'later', title: 'Later', hash: '' }; } });` });
  await expect(page.locator(kit('screen'))).toHaveText('Garden');
  await post(page, 'A fictional garden note');
  await expect.poll(() => page.evaluate(() => __mock.docs('comments')[0]?.screen)).toBe('garden');
  assert.deepEqual(warnings, []);
});

test('a manifest names a registered adapter even when its detect returns false', async t => {
  const { page, warnings } = await open(t, { adapter: 'manual', script: adapterScript + `
    window.kitAdapters.push({ ...window.kitAdapters[0], name: 'manual', detect() { return false; },
      screen(win) { return { id: 'manual', title: 'Manual garden', hash: win.location.hash }; } });` });
  await expect(page.locator(kit('screen'))).toHaveText('Manual garden');
  assert.deepEqual(warnings, []);
});

test('an opted-in named adapter waits for async initialization again on old versions', async t => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); });
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
    route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.addInitScript(me => { if (window === window.top) window.__mockClaudeConfig = { me }; }, me);
  await page.route('**/versions.json', route => route.fulfill({ json: { ...manifest, adapter: 'garden', adapterWaitMs: 8000 } }));
  await page.route('**/adapters.js', route => route.fulfill({ contentType: 'text/javascript', body: adapterScript + `
    const garden = window.kitAdapters[0], detect = garden.detect, onChange = garden.onChange;
    garden.detect = win => { win.__gardenDetectStarted = true; return !!win.__gardenReady && detect(win); };
    garden.onChange = (win, cb) => {
      if (!win.__gardenReady) throw new Error('bound before initialization');
      win.__gardenAttached = true;
      return onChange(win, cb);
    };` }));
  const start = Date.UTC(2026, 9, 27, 12);
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start + 1000);
  await page.goto(harness.url, { waitUntil: 'load' });
  for (const version of [2, 1]) {
    if (version === 1) {
      await page.locator(kit('version')).click();
      const navigation = page.waitForEvent('framenavigated', { predicate: frame => frame.url().endsWith('proto-v1.html#/care') });
      await page.locator(`${kit('version-option')}[data-n="1"]`).click();
      await navigation;
    }
    const body = page.frameLocator(kit('frame')).locator('body');
    await expect.poll(() => body.evaluate(() => window.__gardenDetectStarted)).toBe(true);
    await expect(page.locator(kit('screen'))).toHaveText('…');
    await page.clock.runFor(3000);
    assert.equal(await body.evaluate(() => !!window.__gardenAttached), false);
    // Release asynchronous initialization after the automatic detector's two-second window.
    await body.evaluate(() => { window.__gardenReady = true; });
    await page.clock.runFor(100);
    await expect(page.locator(kit('screen'))).toHaveText(version === 2 ? 'Garden' : 'Care');
    assert.equal(await body.evaluate(() => window.__gardenAttached), true);
    if (version === 2) {
      await page.frameLocator(kit('frame')).getByRole('link', { name: 'Care', exact: true }).click();
      await expect(page.locator(kit('screen'))).toHaveText('Care');
    }
  }
});

test('a manifest can explicitly select generic over a detected registered adapter', async t => {
  const { page } = await open(t, { adapter: 'generic' });
  await expect(page.locator(kit('screen'))).toHaveText('Garden document');
  await post(page, 'Generic route');
  await expect.poll(() => page.evaluate(() => __mock.docs('comments')[0]?.screen)).toBe('/garden');
});

for (const status of [404, 500]) {
  test(`an optional adapters.js returning ${status} falls back to generic`, async t => {
    const { page } = await open(t, { status });
    await expect(page.locator(kit('screen'))).toHaveText('Garden document');
    await post(page, 'Works without a custom adapter');
    await expect.poll(() => page.evaluate(() => __mock.docs('comments')[0]?.screen)).toBe('/garden');
  });
}

test('a failed adapter download falls back to generic', async t => {
  const { page } = await open(t, { abort: true });
  await expect(page.locator(kit('screen'))).toHaveText('Garden document');
});

test('invalid entries are skipped with warnings and cannot hide a valid adapter', async t => {
  const invalid = [null, 42, 'adapter', [], {}, { name: 1 }, { name: 'Uppercase' }, { name: 'missing-functions' }];
  const { page, warnings } = await open(t, { script: `window.kitAdapters = ${JSON.stringify(invalid)};\n` + adapterScript + `
    window.kitAdapters.push({ ...window.kitAdapters[window.kitAdapters.length - 1] });
    window.kitAdapters.push({ ...window.kitAdapters[window.kitAdapters.length - 1], name: 'generic' });` });
  await expect(page.locator(kit('screen'))).toHaveText('Garden');
  assert.equal(warnings.filter(text => text.includes('skipping invalid or duplicate adapter')).length, invalid.length + 2);
});

test('an invalid registry is ignored with a warning', async t => {
  const { page, warnings } = await open(t, { script: 'window.kitAdapters = {};' });
  await expect(page.locator(kit('screen'))).toHaveText('Garden document');
  assert.ok(warnings.some(text => text.includes('window.kitAdapters must be an array')));
});

test('an unknown adapter name warns and falls back to detection', async t => {
  const { page, warnings } = await open(t, { adapter: 'unknown' });
  await expect(page.locator(kit('screen'))).toHaveText('Garden');
  assert.ok(warnings.some(text => text.includes('unknown adapter "unknown"')));
});

test('an unknown adapter name with no registered adapter warns and uses generic', async t => {
  const { page, warnings } = await open(t, { adapter: 'toString', status: 404 });
  await expect(page.locator(kit('screen'))).toHaveText('Garden document');
  assert.ok(warnings.some(text => text.includes('unknown adapter "toString"')));
});

test('an adapter target without a scroller falls back to the document scroller', async t => {
  const { page } = await open(t, { script: adapterScript.replace('return { el, scroller: el };', 'return { el };') });
  await expect(page.locator(kit('screen'))).toHaveText('Garden');
  const landmark = await page.frameLocator(kit('frame')).locator('#landmark').boundingBox();
  await page.locator(kit('pin-toggle')).click();
  await page.mouse.click(landmark.x + 110, landmark.y + 24);
  await post(page, 'Pins still work without a scroller');
  await expect(page.locator(`${kit('pin')} .pin-shape`)).toHaveCount(1);
});

test('a hung adapters.js cannot stall the shell', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { page } = await open(t, { beforeLoad: async page => {
    await page.clock.install();
    await page.route('**/adapters.js', async route => { await pending; await route.fulfill({ contentType: 'text/javascript', body: adapterScript }); });
    page.on('domcontentloaded', () => page.clock.fastForward(1600));
  } });
  await expect(page.locator(kit('screen'))).toHaveText('Garden document');
  release();
});

test('custom pins follow an inner scroller and feedback returns to its screen after version switching', async t => {
  const { page } = await open(t);
  const frame = page.frameLocator(kit('frame'));
  const scroller = frame.locator('#viewport');
  await scroller.evaluate(el => { el.scrollTop = 100; });
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBe(100);
  const landmark = frame.locator('#landmark');
  const before = await landmark.boundingBox();
  const click = { x: before.x + 110, y: before.y + 24 };
  await page.locator(kit('pin-toggle')).click();
  await page.mouse.click(click.x, click.y);
  await post(page, 'Keep this on the plant card');
  const marker = page.locator(`${kit('pin')} .pin-shape`);
  const tip = () => marker.evaluate(el => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.bottom }; });
  await expect.poll(async () => { const p = await tip(); return Math.max(Math.abs(p.x - click.x), Math.abs(p.y - click.y)); }).toBeLessThanOrEqual(4);
  const [comment] = await page.evaluate(() => __mock.docs('comments'));
  assert.equal(comment.screen, 'garden');
  await scroller.evaluate(el => { el.scrollTop = 260; });
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBe(260);
  await expect.poll(async () => {
    const after = await landmark.boundingBox(), p = await tip();
    return Math.max(Math.abs(p.x - click.x), Math.abs(p.y - after.y - 24));
  }).toBeLessThanOrEqual(4);
  assert.deepEqual((await page.evaluate(() => __mock.docs('comments')))[0].pin, comment.pin);

  await frame.getByRole('link', { name: 'Care', exact: true }).click();
  await expect(page.locator(kit('screen'))).toHaveText('Care');
  await page.locator(kit('version')).click();
  await page.locator(`${kit('version-option')}[data-n="1"]`).click();
  await expect(page.locator(kit('frame'))).toHaveAttribute('src', 'proto-v1.html#/care');
  await expect(page.locator(kit('screen'))).toHaveText('Care');
  await page.locator('[data-scope="all"]').click();
  await row(page, comment.id).locator('.c-text').click();
  await expect(page.locator(kit('screen'))).toHaveText('Garden');
  await expect.poll(() => frame.locator('body').evaluate(() => location.hash)).toBe('#/garden');
});

test('a custom adapter supplies the window-edge screens rail and wide query', async t => {
  const { page } = await open(t, { script: adapterScript + `
    Object.assign(window.kitAdapters[0], {
      screens() { return [{ name: 'Plant care', items: [
        { id: 'garden', title: 'Garden', hash: '#/garden', job: 'View plants' },
        { id: 'care', title: 'Care', hash: '#/care' }
      ] }]; },
      side(win) { return win.__side || 'phone'; },
      setSide(win, key) { win.__side = key; win.dispatchEvent(new Event('hashchange')); },
      reset(win) { win.__reset = true; win.location.hash = '#/garden'; }
    });`, beforeLoad: async page => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.route('**/versions.json', route => route.fulfill({ json: { ...manifest, wideQuery: 'shell=1', narrowQuery: 'frame=0' } }));
    } });
  const rail = page.locator(kit('rail')), btn = rail.locator('.rail-btn');
  const frame = page.frameLocator(kit('frame'));
  await expect(rail).toBeVisible();
  await expect(page.locator(kit('frame'))).toHaveAttribute('src', 'proto-v2.html?shell=1');
  const box = await btn.boundingBox();
  assert.deepEqual([box.x, box.y, box.width, box.height], [0, 0, 32, 900]);
  await expect(rail.locator('.rail-item')).toHaveCount(2);
  await expect(rail.locator('h2')).toHaveText('Plant care');
  await expect(rail.locator('.rail-menu')).not.toContainText('[object');
  await page.mouse.move(16, 450);
  await expect(rail).toHaveClass(/open/);
  await expect(rail.locator('.rail-menu')).toHaveCSS('width', '280px');
  // Navigation only updates aria state, preserving the existing buttons.
  await rail.locator('[data-id="care"]').evaluate(el => { window.__careButton = el; });
  await rail.getByRole('button', { name: 'Care', exact: true }).click();
  await expect(page.locator(kit('screen'))).toHaveText('Care');
  await expect(rail.locator('.rail-item[aria-current="true"]')).toHaveText('Care');
  assert.equal(await rail.locator('[data-id="care"]').evaluate(el => el === window.__careButton), true);
  await expect.poll(() => frame.locator('body').evaluate(() => location.hash)).toBe('#/care');
  await expect(rail).toHaveClass(/open/);
  await rail.getByRole('button', { name: 'Web', exact: true }).click();
  await expect(rail.getByRole('button', { name: 'Web', exact: true })).toHaveAttribute('aria-pressed', 'true');
  assert.equal(await frame.locator('body').evaluate(() => window.__side), 'web');
  await rail.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator(kit('screen'))).toHaveText('Garden');
  assert.equal(await frame.locator('body').evaluate(() => window.__reset), true);
  await page.keyboard.press('Escape');
  await expect(rail).not.toHaveClass(/open/);
  await expect(btn).toBeFocused();
  await btn.press('Enter');
  await expect(rail).toHaveClass(/open/);
  await frame.locator('h1:visible').click();
  await expect(rail).not.toHaveClass(/open/);
  await page.mouse.move(16, 450);
  await expect(rail).toHaveClass(/open/);
  await page.mouse.move(900, 450);
  await expect(rail).not.toHaveClass(/open/);
  await page.setViewportSize({ width: 400, height: 800 });
  await expect(rail).toBeHidden();
  await page.locator('.peek').click();
  await page.locator(kit('version')).click();
  await page.locator(`${kit('version-option')}[data-n="1"]`).click();
  await expect(page.locator(kit('frame'))).toHaveAttribute('src', 'proto-v1.html?frame=0#/garden');
});

test('a custom adapter without screens has no rail', async t => {
  const { page } = await open(t);
  await expect(page.locator(kit('screen'))).toHaveText('Garden');
  await expect(page.locator(kit('rail'))).toBeHidden();
});
