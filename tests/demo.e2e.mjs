import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { startDemo } from '../dev/demo/serve.mjs';
import { openPage, kit, row } from '../dev/harness/browser.mjs';
import { goToScreen } from '../dev/demo/browser.mjs';

test('Sprout demo renders v2, both versions and seeded open feedback', async () => {
  const demo = await startDemo();
  let browser, opened;
  try {
    browser = await chromium.launch();
    opened = await openPage(browser, demo.url, { config: demo.config });
    const { page } = opened;
    await expect(page.locator('.ph-title')).toHaveText('Sprout');
    await expect(page.locator(kit('version'))).toHaveText('v2');
    await goToScreen(page, '/today', demo.config.seed);
    await expect(page.frameLocator(kit('frame')).locator('#view h1')).toBeVisible();
    await page.locator(kit('version')).click();
    await expect(page.locator(kit('version-option'))).toHaveCount(2);
    for (const n of [1, 2]) await expect(page.locator(`${kit('version-option')}[data-n="${n}"]`)).toBeVisible();
    await page.locator(kit('version')).click();
    await page.locator(`${kit('scope')}[data-scope="all"]`).click();
    const comments = demo.config.seed.comments.filter(comment => comment.status === 'open');
    assert.ok(comments.length > 0, 'Demo must include seeded open comments');
    await expect(page.locator(`${kit('comment')}[data-status="open"]`)).toHaveCount(comments.length);
    // Replies reuse .c-text, so check the comment's own text, which comes first.
    for (const comment of comments) await expect(row(page, comment.id).locator('.c-text').first()).toHaveText(comment.text);
  } finally {
    try { await opened?.close(); } finally {
      try { await browser?.close(); } finally { await demo.close(); }
    }
  }
});
