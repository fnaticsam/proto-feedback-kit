#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import sharp from 'sharp';
import { root } from '../harness/serve.mjs';
import { openPage, kit, row } from '../harness/browser.mjs';
import { startDemo } from './serve.mjs';
import { shotTargets } from './data.mjs';
import { goToScreen, showPins } from './browser.mjs';

const directory = path.join(root, 'docs/images');
const captures = [];
// Server preparation is independent of Chromium startup and capture.
const demo = await startDemo();
let browser;
try {
  const seed = demo.config.seed;
  const targets = shotTargets(seed);
  browser = await chromium.launch();
  for (const name of ['hero', 'panel', 'pins', 'versions', 'mobile']) {
    const mobile = name === 'mobile';
    const shortPanel = name === 'panel' || name === 'versions';
    const strictErrors = [];
    const opened = await openPage(browser, demo.url, {
      config: demo.config, hash: '#v2', colorScheme: 'light', deviceScaleFactor: 2,
      viewport: mobile ? { width: 390, height: 844 } : name === 'hero' ? { width: 1200, height: 860 } : { width: 1440, height: shortPanel ? 760 : 900 },
      async beforeLoad(page) {
        // Seeded comments carry fixed dates, so a fixed clock keeps their ages the same on every run.
        await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
        page.on('console', message => { if (message.type() === 'error') strictErrors.push(message.text()); });
      }
    });
    let capture;
    try {
      const { page } = opened;
      await expect(page.locator(kit('version'))).toHaveText('v2');
      const screen = name === 'panel' ? targets.thread.screen : name === 'pins' ? '/plants/fernando' : name === 'mobile' ? '/plants' : '/today';
      await goToScreen(page, screen, seed);
      let subject = page;
      let clip;
      if (name === 'hero') {
        await showPins(page, seed.comments.filter(comment => comment.screen === screen), name === 'hero' ? 3 : Infinity);
        const comments = page.locator(`${kit('comment')}[data-status="open"]`);
        await expect(comments.first()).toBeVisible();
        await expect(comments.nth(1)).toBeVisible();
        const resolved = page.locator('.shut summary');
        await expect(resolved).toHaveText('2 resolved');
        await resolved.click();
        await expect(row(page, 'v1-today-targets').locator('.replies .r').first()).toBeVisible();
        await expect(row(page, 'v1-today-streak').locator('.replies .r').first()).toBeVisible();
        // End the panel on a whole resolved thread rather than partway through a reply.
        await page.locator(`.shut ${kit('comment')}`).first().evaluate(el => el.scrollIntoView({ block: 'nearest' }));
      }
      if (name === 'pins') {
        const pin = page.locator(`${kit('pin')}[data-id="v2-detail-range"]`);
        await expect(pin).toBeVisible();
        await page.frameLocator(kit('frame')).locator('body').evaluate(() => window.scrollTo(0, 470));
        await expect(pin).toBeVisible();
        await pin.click();
        await expect(row(page, 'v2-detail-range')).toHaveClass(/hot/);
        // Crop to the app column, keeping the pin overlay above the iframe, so the chart reads at README size.
        const stage = await page.locator('.stage').boundingBox();
        const frame = await page.locator(kit('frame')).boundingBox();
        const app = await page.frameLocator(kit('frame')).locator('.app').evaluate(el => {
          const rect = el.getBoundingClientRect();
          return { left: rect.left, width: rect.width };
        });
        const margin = 64;
        clip = { x: frame.x + app.left - margin, y: stage.y + 1, width: app.width + margin * 2, height: stage.height - 2 };
      }
      if (mobile) {
        // Tapping a pin opens the sheet on its comment; the open sheet's scrim would block the tap.
        const pin = page.locator(`${kit('pin')}[data-id="v2-plants-chips"]`);
        await expect(pin).toBeVisible();
        await pin.click();
        await expect(page.locator('.peek')).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('.app')).toHaveClass(/sheet-open/);
        await expect(row(page, 'v2-plants-chips')).toBeVisible();
      }
      if (name === 'panel') {
        const thread = row(page, targets.thread.id);
        await thread.scrollIntoViewIfNeeded();
        // Existing replies are already expanded; an empty reply box would only add chrome.
        await expect(thread.locator('.replies .r').first()).toBeVisible();
        // Open the resolved thread so the shot also shows the agent's reply.
        await page.locator('.shut summary').click();
        await expect(page.locator('.shut .replies .r').first()).toBeVisible();
        subject = page.locator(kit('panel'));
      }
      if (name === 'versions') {
        await page.locator('.vnotes summary').click();
        await expect(page.locator('.vnotes')).toHaveAttribute('open', '');
        await expect(page.locator('.vnotes-fixed button')).toHaveCount(
          demo.manifest.versions.find(version => version.n === 2).fixed.length);
        await expect(page.locator('.vnotes-fixed button').first()).toBeVisible();
        // The open version menu would cover the notes; tests/demo.e2e.mjs checks it instead.
        subject = page.locator(kit('panel'));
      }
      await page.mouse.move(0, 0);
      const options = { animations: 'disabled', type: 'png', scale: 'device' };
      const original = await subject.screenshot(clip ? { ...options, clip } : options);
      let buffer;
      let quality;
      for (const candidate of [90, 85, 80, 75, 70, 65, 60]) {
        const encoded = await sharp(original).png({ palette: true, quality: candidate, compressionLevel: 9, effort: 10 }).toBuffer();
        if (encoded.length < 600_000) {
          buffer = encoded;
          quality = candidate;
          break;
        }
      }
      assert.ok(buffer, `${name}.png exceeds 600 KB after palette compression`);
      assert.deepEqual(strictErrors, [], strictErrors.join('\n'));
      assert.deepEqual(opened.errors, [], opened.errors.join('\n'));
      capture = { name, buffer, quality };
    } finally { await opened.close(); }
    assert.deepEqual(strictErrors, [], strictErrors.join('\n'));
    captures.push(capture);
  }
} finally {
  try { await browser?.close(); } finally { await demo.close(); }
}
// Validate every page before replacing any README image.
await mkdir(directory, { recursive: true });
for (const { name, buffer, quality } of captures) {
  await writeFile(path.join(directory, name + '.png'), buffer);
  console.log(`${name}.png: ${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)} pixels, ${buffer.length} bytes (palette quality ${quality})`);
}
