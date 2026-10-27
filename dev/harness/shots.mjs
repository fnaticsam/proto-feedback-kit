#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { root, startServer } from './serve.mjs';
import { buildFixture } from './build.mjs';
import { screenshotConfig } from './data.mjs';
import { openPage, kit } from './browser.mjs';

const directory = path.join(root, 'out/shots');
await mkdir(directory, { recursive: true });
const harness = await startServer({ fixture: await buildFixture() });
const browser = await chromium.launch();
try {
  for (const shot of [
    { name: 'desktop-light', width: 1440, height: 900, colorScheme: 'light' },
    { name: 'desktop-dark', width: 1440, height: 900, colorScheme: 'dark' },
    { name: 'mobile-closed', width: 400, height: 860, colorScheme: 'light' },
    { name: 'mobile-open', width: 400, height: 860, colorScheme: 'light', sheet: true },
    { name: 'desktop-versions', width: 1440, height: 900, colorScheme: 'light', menu: true }
  ]) {
    const opened = await openPage(browser, harness.url, { config: screenshotConfig,
      viewport: { width: shot.width, height: shot.height }, colorScheme: shot.colorScheme });
    try {
      const { page } = opened;
      if (shot.sheet) await page.locator('.peek').click();
      // The closed sheet is inert; its contents are still seeded and rendered.
      await expect(page.locator(kit('comment'))).toHaveCount(3);
      await expect(page.locator(kit('pin'))).toHaveCount(2);
      if (shot.width > 759 || shot.sheet) {
        await page.locator('.vnotes summary').click();
        await page.locator('.shut summary').click();
      }
      if (shot.menu) await page.locator(kit('version')).click();
      await page.locator('.list').evaluate(el => { el.scrollTop = 0; });
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(directory, shot.name + '.png');
      await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
      console.log(file);
    } finally { await opened.close(); }
  }
} finally {
  await browser.close();
  await harness.close();
}
