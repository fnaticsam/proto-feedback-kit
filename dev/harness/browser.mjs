import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export const kit = name => `[data-kit="${name}"]`;
export const row = (page, id) => page.locator(`${kit('comment')}[data-id="${id}"]`);

export async function openPage(browser, url, { config = {}, viewport = { width: 1440, height: 900 }, colorScheme = 'light', hash = '', deviceScaleFactor = 1, beforeLoad } = {}) {
  const context = await browser.newContext({ viewport, colorScheme, deviceScaleFactor, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push('page: ' + error.message));
  // An optional adapter script may legitimately be missing or fail to download.
  page.on('console', message => {
    if (message.type() === 'error' && !(
      /^Failed to load resource:/.test(message.text()) &&
      new URL(message.location().url || 'about:blank').pathname.endsWith('/adapters.js')
    )) errors.push('console: ' + message.text());
  });
  // These tests exercise local prototypes. Keep optional web fonts independent of network availability.
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(config => { if (window === window.top) window.__mockClaudeConfig = config; }, config);
  try {
    if (beforeLoad) await beforeLoad(page);
    await page.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(kit('screen'))).not.toHaveText('…');
  } catch (error) {
    await context.close();
    assert.deepEqual(errors, [], errors.join('\n'));
    throw error;
  }
  return { page, context, errors, async close() {
    await context.close();
    assert.deepEqual(errors, [], errors.join('\n'));
  } };
}

export async function testPage(t, browser, url, options) {
  const opened = await openPage(browser, url, options);
  t.after(() => opened.close());
  return opened.page;
}
export async function prototype(page) {
  return page.locator(kit('frame')).contentFrame();
}
export async function post(page, text) {
  await page.locator(kit('composer')).fill(text);
  await page.locator(kit('submit')).click();
}
