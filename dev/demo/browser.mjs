import { expect } from '@playwright/test';
import { kit } from '../harness/browser.mjs';

export async function goToScreen(page, screen, seed) {
  const frame = page.frameLocator(kit('frame'));
  await frame.locator('body').evaluate((_, hash) => {
    if (window.location.hash === hash) return;
    return new Promise(resolve => {
      window.addEventListener('hashchange', () => resolve(), { once: true });
      window.location.hash = hash;
    });
  }, '#' + screen);
  await expect.poll(() => frame.locator('body').evaluate(() => location.hash)).toBe('#' + screen);
  await expect(frame.locator('#view h1')).toBeVisible();
  await expect.poll(async () => page.locator(kit('screen')).textContent()).toBe(
    await frame.locator('body').evaluate(() => document.title));
  await expect(page.locator(`${kit('comment')}[data-status="open"]`)).toHaveCount(
    seed.comments.filter(comment => comment.status === 'open' && comment.screen === screen).length);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await frame.locator('body').evaluate(() => document.fonts.ready);
}

export async function visiblePins(page) {
  return page.locator(kit('pin')).evaluateAll(pins => pins.filter(pin => {
    const box = pin.getBoundingClientRect(), clip = pin.parentElement.getBoundingClientRect();
    return getComputedStyle(pin).visibility !== 'hidden' && getComputedStyle(pin).display !== 'none' &&
      box.left >= clip.left && box.right <= clip.right && box.top >= clip.top && box.bottom <= clip.bottom;
  }).length);
}

export async function showPins(page, comments, maximum = Infinity) {
  const pins = comments.filter(comment => comment.status === 'open' && comment.pin);
  if (pins.length < 2) throw new Error('Capture needs at least two pinned open comments on this screen');
  await expect(page.locator(kit('pin'))).toHaveCount(pins.length);
  // Centre a cluster of pins using the real content coordinates, without changing feedback.
  const ys = pins.map(comment => comment.pin.y).sort((a, b) => a - b);
  const height = await page.locator(kit('frame')).evaluate(frame => frame.clientHeight);
  const end = Math.min(ys.length, Number.isFinite(maximum) ? maximum : ys.length) - 1;
  const top = Math.max(0, (ys[0] + ys[end] - height) / 2);
  await page.frameLocator(kit('frame')).locator('body').evaluate((_, top) => window.scrollTo(0, top), top);
  await expect.poll(() => visiblePins(page)).toBeGreaterThanOrEqual(2);
  if (Number.isFinite(maximum)) await expect.poll(() => visiblePins(page)).toBeLessThanOrEqual(maximum);
}
