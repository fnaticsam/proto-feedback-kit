import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { startServer, wrapper } from '../dev/harness/serve.mjs';
import { buildFixture, versions } from '../dev/harness/build.mjs';
import { me, comment } from '../dev/harness/data.mjs';
import { kit, row, testPage, post } from '../dev/harness/browser.mjs';

let browser, harness;
before(async () => {
  harness = await startServer({ fixture: await buildFixture() });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await harness?.close();
});
async function open(t, config = {}, { feedback = true, ...extra } = {}) {
  const page = await testPage(t, browser, harness.url, { config: { me, ...config }, ...extra });
  if (feedback) await page.locator(kit('feedback-open')).click();
  return page;
}

test('Artifact wrapper loads the newest version, first screen, and feedback panel', async t => {
  const page = await open(t);
  await expect(page.locator(kit('panel'))).toBeVisible();
  await expect(page.locator(kit('version'))).toHaveText('v2');
  await expect(page.locator(kit('screen'))).toHaveText('Home');
  await expect(page.frameLocator(kit('frame')).getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.locator('.stage-msg')).toBeHidden();
  assert.equal(await page.evaluate(() => document.compatMode), 'CSS1Compat');
  const get = await page.request.get(harness.url);
  assert.ok((await get.text()).startsWith(wrapper));
  const head = await page.request.head(harness.url + '/proto-v2.html');
  assert.equal(head.status(), 200);
  assert.equal((await head.body()).length, 0);
  assert.equal((await page.request.head(harness.url + '/missing.html')).status(), 404);
});

test('frame navigation updates the screen label and This screen filters feedback', async t => {
  const page = await open(t, { seed: { comments: [comment('home'), comment('list', 'list')] } });
  await expect(row(page, 'home')).toBeVisible();
  await expect(row(page, 'list')).toHaveCount(0);
  await page.frameLocator(kit('frame')).getByRole('link', { name: 'List', exact: true }).click();
  await expect(page.locator(kit('screen'))).toHaveText('List');
  await expect(row(page, 'list')).toBeVisible();
  await expect(row(page, 'home')).toHaveCount(0);
  await page.locator('[data-scope="all"]').click();
  await expect(page.locator(kit('comment'))).toHaveCount(2);
  await page.locator('[data-scope="screen"]').click();
  await expect(page.locator(kit('comment'))).toHaveCount(1);
});

test('posting feedback stores screen, hash, version, author, status and ISO dates', async t => {
  const page = await open(t);
  await post(page, 'The welcome is clear');
  await expect(page.locator(kit('comment'))).toHaveCount(1);
  await expect(page.locator(kit('comment'))).toContainText('The welcome is clear');
  const [doc] = await page.evaluate(() => __mock.docs('comments'));
  assert.deepEqual({ screen: doc.screen, hash: doc.hash, version: doc.version, pin: doc.pin, author: doc.author, status: doc.status },
    { screen: '/home', hash: '#/home', version: 2, pin: null, author: me.id, status: 'open' });
  assert.equal(new Date(doc.createdAt).toISOString(), doc.createdAt);
  assert.equal(doc.updatedAt, doc.createdAt);
  await expect(page.locator(kit('composer'))).toHaveValue('');
});

test('a pin lands within 4px of the click and follows its content when the frame scrolls', async t => {
  const page = await open(t);
  const frame = page.frameLocator(kit('frame'));
  const landmark = frame.locator('#landmark');
  // Begin with a scrolled document so storage must use content coordinates.
  await frame.locator('body').evaluate(() => window.scrollTo(0, 100));
  await expect.poll(() => frame.locator('body').evaluate(() => window.scrollY)).toBe(100);
  const before = await landmark.boundingBox();
  const click = { x: before.x + 110, y: before.y + 24 };
  await page.locator(kit('pin-toggle')).click();
  await page.mouse.click(click.x, click.y);
  await post(page, 'Look at this point');
  const marker = page.locator(`${kit('pin')} .pin-shape`);
  await expect(marker).toBeVisible();
  // The rotated drop's bottom tip is its anchor, rather than its centre.
  async function tip() {
    // Read atomically: snapshots replace the pin nodes during a render.
    return marker.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.bottom };
    });
  }
  await expect.poll(async () => {
    const p = await tip();
    return Math.max(Math.abs(p.x - click.x), Math.abs(p.y - click.y));
  }).toBeLessThanOrEqual(4);
  const [doc] = await page.evaluate(() => __mock.docs('comments'));
  assert.deepEqual(Object.keys(doc.pin).sort(), ['x', 'y']);
  assert.ok(doc.pin.x >= 0 && doc.pin.x <= 1);
  const frameBox = await page.locator(kit('frame')).boundingBox();
  assert.ok(Math.abs(doc.pin.y - (click.y - frameBox.y + 100)) <= 1);
  await frame.locator('body').evaluate(() => window.scrollBy(0, 160));
  await expect.poll(() => frame.locator('body').evaluate(() => window.scrollY)).toBe(260);
  await expect.poll(async () => {
    const after = await landmark.boundingBox(), p = await tip();
    return Math.max(Math.abs(p.x - click.x), Math.abs((p.y - after.y) - 24));
  }).toBeLessThanOrEqual(4);
  assert.deepEqual((await page.evaluate(() => __mock.docs('comments')))[0].pin, doc.pin);
});

test('reply, resolve, reopen and two-step deletion update the store and rows', async t => {
  const page = await open(t, { seed: { comments: [comment('thread')] } });
  const thread = row(page, 'thread');
  await thread.locator(kit('reply')).click();
  await thread.getByRole('textbox', { name: 'Reply', exact: true }).fill('More detail');
  await thread.locator('.rbar').getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(thread.locator('.replies')).toContainText('More detail');
  const [reply] = await page.evaluate(() => __mock.docs('replies'));
  assert.equal(reply.commentId, 'thread');
  assert.equal(reply.author, me.id);
  assert.equal(reply.version, 2);
  assert.equal(new Date(reply.createdAt).toISOString(), reply.createdAt);
  await thread.locator(kit('resolve')).click();
  await expect(thread).toHaveAttribute('data-status', 'done');
  assert.equal((await page.evaluate(() => __mock.docs('comments')))[0].status, 'done');
  await page.locator('.shut > summary').click();
  await thread.locator(kit('resolve')).click();
  await expect(thread).toHaveAttribute('data-status', 'open');
  assert.equal((await page.evaluate(() => __mock.docs('comments')))[0].status, 'open');
  // A reply also requires an explicit second click to delete.
  await thread.locator('.replies').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(thread.locator('.replies').getByRole('button', { name: 'Delete?', exact: true })).toBeVisible();
  assert.equal((await page.evaluate(() => __mock.docs('replies'))).length, 1);
  await thread.locator('.replies').getByRole('button', { name: 'Delete?', exact: true }).click();
  await expect(thread.locator('.replies')).toHaveCount(0);
  await thread.locator(':scope > .c-acts').getByRole('button', { name: 'Delete', exact: true }).click();
  assert.equal((await page.evaluate(() => __mock.docs('comments'))).length, 1);
  await thread.locator(':scope > .c-acts').getByRole('button', { name: 'Delete?', exact: true }).click();
  await expect(thread).toHaveCount(0);
  assert.deepEqual(await page.evaluate(() => __mock.store), { comments: [], replies: [] });
});

test('clicking feedback for another screen in All navigates the prototype', async t => {
  const page = await open(t, { seed: { comments: [comment('elsewhere', 'detail')] } });
  await page.locator('[data-scope="all"]').click();
  await row(page, 'elsewhere').locator('.c-text').click();
  await expect(page.locator(kit('screen'))).toHaveText('Detail');
  await expect(page.frameLocator(kit('frame')).getByRole('heading', { name: 'Detail', exact: true })).toBeVisible();
});

test('feedback actions in All keep the current screen and deleting a thread removes its replies', async t => {
  const page = await open(t, { seed: { comments: [comment('elsewhere', 'detail')], replies: [{
    id: 'child', commentId: 'elsewhere', text: 'A reply', author: me.id, createdAt: '2026-10-26T10:01:00.000Z', version: 2
  }] } });
  await page.locator('[data-scope="all"]').click();
  const thread = row(page, 'elsewhere');
  await thread.locator(kit('reply')).click();
  await expect(thread.getByRole('textbox', { name: 'Reply', exact: true })).toBeVisible();
  await expect(page.locator(kit('screen'))).toHaveText('Home');
  await thread.getByRole('textbox', { name: 'Reply', exact: true }).fill('Do not navigate while editing');
  await thread.locator('.rbar').getByRole('button', { name: 'Cancel', exact: true }).click();
  await thread.locator(':scope > .c-acts').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator(kit('screen'))).toHaveText('Home');
  assert.equal((await page.evaluate(() => __mock.docs('comments'))).length, 1);
  await thread.locator(':scope > .c-acts').getByRole('button', { name: 'Delete?', exact: true }).click();
  await expect(thread).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => __mock.docs('replies').length)).toBe(0);
  await expect(page.locator(kit('screen'))).toHaveText('Home');
});

test('version selection preserves the screen, shows notes and fixed feedback, and honours #v1', async t => {
  const page = await open(t, { seed: { comments: [comment('fixed-home', 'home', { status: 'done', resolvedIn: 2 })] } });
  await page.locator(kit('notes-toggle')).click();
  await expect(page.locator('.vnotes')).toContainText('A greener welcome.');
  await expect(page.locator('.vnotes summary')).toHaveText('What changed in v2 · 1 fixed');
  await expect(page.locator('.vnotes-fixed')).toContainText('Feedback on home');
  await page.frameLocator(kit('frame')).getByRole('link', { name: 'List', exact: true }).click();
  await expect(page.locator(kit('screen'))).toHaveText('List');
  await page.locator(kit('version')).click();
  await page.locator(`${kit('version-option')}[data-n="1"]`).click();
  await expect(page.locator(kit('frame'))).toHaveAttribute('src', 'proto-v1.html#/list');
  await expect(page.locator(kit('screen'))).toHaveText('List');
  await expect(page.frameLocator(kit('frame')).locator('#round')).toContainText('Round one');
  await page.locator(kit('notes-toggle')).click();
  await expect(page.locator('.vnotes')).toContainText('The first round');
  await expect(page.locator('.vnotes')).not.toContainText('null');
  const deepLink = await open(t, {}, { hash: '#v1' });
  await expect(deepLink.locator(kit('version'))).toHaveText('v1');
  await expect(deepLink.locator(kit('frame'))).toHaveAttribute('src', 'proto-v1.html');
  await expect(deepLink.frameLocator(kit('frame')).locator('#round')).toContainText('Round one');
});

for (const width of [400, 1440]) for (const colorScheme of ['light', 'dark']) {
  test(`fixed-comment links stay compact and open the full feedback at ${width}px in ${colorScheme}`, async t => {
    const text = 'Please keep the fictional fern watering reminder near the plant card. '.repeat(8).trim();
    const page = await open(t, { seed: { comments: [comment('fixed-home', 'home', { text, status: 'done', resolvedIn: 2 })] } },
      { viewport: { width, height: 900 }, colorScheme });
    await page.locator(kit('notes-toggle')).click();
    const link = page.locator('.vnotes-fixed button');
    await expect(link).toHaveAccessibleName('Home · ' + text);
    await expect(link).toHaveAttribute('title', text);
    await expect(link).toHaveCSS('text-overflow', 'ellipsis');
    const size = await link.evaluate(el => ({ height: el.clientHeight, line: parseFloat(getComputedStyle(el).lineHeight),
      clipped: el.scrollWidth > el.clientWidth, mark: getComputedStyle(el, '::before').content }));
    if (width === 400) assert.equal(size.height, 44);
    else assert.ok(size.height < size.line * 1.5);
    assert.equal(size.clipped, true);
    assert.equal(size.mark, 'none');
    if (width === 400) await page.locator(kit('feedback-close')).click();
    await page.frameLocator(kit('frame')).getByRole('link', { name: 'List', exact: true }).click();
    await expect(page.locator(kit('screen'))).toHaveText('List');
    if (width === 400) await page.locator('.peek').click();
    await link.click();
    await expect(page.locator(kit('screen'))).toHaveText('Home');
    await expect(row(page, 'fixed-home')).toBeVisible();
    await expect(row(page, 'fixed-home').locator('.c-text')).toHaveText(text);
  });
}

test('400×860 has a bottom sheet, no horizontal overflow, working peek and Escape, and frame=0', async t => {
  const page = await open(t, {}, { viewport: { width: 400, height: 860 }, feedback: false });
  const panel = page.locator(kit('panel')), peek = page.locator('.peek');
  await expect(panel).toHaveCSS('position', 'fixed');
  await expect(page.locator(kit('frame'))).toHaveAttribute('src', 'proto-v2.html?frame=0');
  async function noOverflow() {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    assert.equal(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  }
  await noOverflow();
  await expect(peek).toHaveAttribute('aria-expanded', 'false');
  const closed = await panel.boundingBox();
  assert.ok(closed.y >= 860);
  const bar = await page.locator('.feedback-cluster').boundingBox();
  const stage = await page.locator('.stage').boundingBox();
  assert.ok(stage.y + stage.height <= bar.y);
  assert.ok((await peek.boundingBox()).height >= 44);
  assert.equal(await page.locator('.panel-body').evaluate(el => el.inert), true);
  await peek.click();
  await expect(peek).toHaveAttribute('aria-expanded', 'true');
  const opened = await panel.boundingBox();
  assert.ok(opened.y < 240 && Math.abs(opened.y + opened.height - 860) <= 1);
  assert.equal(await page.locator('.panel-body').evaluate(el => el.inert), false);
  await noOverflow();
  await expect(page.locator(kit('composer'))).not.toBeFocused();
  await page.locator(kit('feedback-close')).click();
  await expect(peek).toHaveAttribute('aria-expanded', 'false');
  await peek.click();
  await page.keyboard.press('Escape');
  await expect(peek).toHaveAttribute('aria-expanded', 'false');
  await expect(peek).toBeFocused();
});

test('explicit read-only capability hides the composer', async t => {
  const page = await open(t, { canWrite: false });
  await expect(page.locator(kit('readonly'))).toBeVisible();
  await expect(page.locator(kit('composer'))).toBeHidden();
});

test('a missing user capability makes the shell read-only', async t => {
  const page = await open(t, { user: null });
  await expect(page.locator(kit('readonly'))).toBeVisible();
  await expect(page.locator(kit('composer'))).toBeHidden();
});

test('an unknown permission keeps the composer until invalid_argument refuses a post and preserves the draft', async t => {
  const page = await open(t, { canWrite: null, refuseWrites: 'invalid_argument' });
  await expect(page.locator(kit('composer'))).toBeVisible();
  await expect(page.locator(kit('readonly'))).toBeHidden();
  await post(page, 'Keep my draft');
  await expect(page.locator(kit('readonly'))).toBeVisible();
  await expect(page.locator(kit('composer'))).toBeHidden();
  await expect(page.locator(kit('composer'))).toHaveValue('Keep my draft');
  assert.deepEqual(await page.evaluate(() => __mock.docs('comments')), []);
});

test('a live write revocation preserves the draft and a Claude reply is attributed to Claude', async t => {
  const page = await open(t, { seed: { comments: [comment('thread')], replies: [{ id: 'answer', commentId: 'thread',
    text: 'Updated in v2', by: 'claude', author: me.id, version: 2, createdAt: '2026-10-26T10:01:00.000Z' }] } });
  await expect(row(page, 'thread').locator('.replies .c-name')).toHaveText('Claude');
  await page.evaluate(() => { __mock.refuseWrites = 'revoked'; });
  await post(page, 'Draft after revocation');
  await expect(page.locator(kit('readonly'))).toBeVisible();
  await expect(page.locator(kit('composer'))).toHaveValue('Draft after revocation');
  assert.equal((await page.evaluate(() => __mock.docs('comments'))).length, 1);
});

test('feedback starts closed, opens at the original width, and Escape or Hide returns focus', async t => {
  const page = await open(t, {}, { feedback: false });
  const pill = page.locator(kit('feedback-open')), panel = page.locator(kit('panel'));
  await expect(panel).toBeHidden();
  await expect(pill).toHaveAttribute('aria-controls', 'feedback-panel');
  await expect(pill).toHaveAttribute('aria-expanded', 'false');
  const fullWidth = (await page.locator('.stage').boundingBox()).width;
  await pill.click();
  await expect(panel).toBeVisible();
  await expect(pill).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(kit('composer'))).toBeFocused();
  assert.equal(Math.round((await panel.boundingBox()).width), 460);
  await expect.poll(async () => (await page.locator('.stage').boundingBox()).width).toBe(fullWidth);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(pill).toBeFocused();
  await pill.click();
  await page.locator(kit('feedback-close')).click();
  await expect(pill).toBeFocused();
  assert.equal((await page.locator('.stage').boundingBox()).width, fullWidth);
});

test('panel choice persists across reload and panel=1 overrides the closed preference', async t => {
  const page = await open(t, {}, { feedback: false });
  const pill = page.locator(kit('feedback-open')), panel = page.locator(kit('panel'));
  await pill.click();
  assert.equal(await page.evaluate(() => localStorage.getItem('kit:panel')), '1');
  await page.reload();
  await expect(panel).toBeVisible();
  await page.locator(kit('feedback-close')).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('kit:panel')), '0');
  await page.reload();
  await expect(panel).toBeHidden();
  await page.goto(harness.url + '/?panel=1');
  await expect(panel).toBeVisible();
  await expect(page.locator(kit('screen'))).toHaveText('Home');
});

test('closed badge counts only open feedback on the current screen and announces changes', async t => {
  const page = await open(t, { seed: { comments: [comment('one'), comment('two'),
    comment('done', 'home', { status: 'done' }), comment('no', 'home', { status: 'wontdo' }), comment('elsewhere', 'list')] } }, { feedback: false });
  const pill = page.locator(kit('feedback-open')), badge = pill.locator('.peek-count');
  await expect(badge).toHaveText('2');
  await expect(pill).toHaveAccessibleName('Leave feedback, 2 open comments on this screen');
  await expect(page.locator(kit('feedback-count'))).toHaveAttribute('aria-live', 'polite');
  await page.evaluate(() => __mock.update('comments', 'two', { status: 'done' }));
  await expect(badge).toHaveText('1');
  await expect(page.locator(kit('feedback-count'))).toHaveText('1 open comment on this screen');
  await page.frameLocator(kit('frame')).getByRole('link', { name: 'Detail', exact: true }).click();
  await expect(badge).toBeHidden();
  await expect(pill).toHaveAccessibleName('Leave feedback, 0 open comments on this screen');
  await expect(page.locator(kit('panel'))).toBeHidden();
});

test('pins disappear when closed, retain coordinates on reopening, and focus their comment', async t => {
  const page = await open(t, { seed: { comments: [comment('pinned', 'home', { pin: { x: 0.5, y: 200 } })] } }, { feedback: false });
  const pin = page.locator(`${kit('pin')}[data-id="pinned"]`);
  await expect(pin).toHaveCount(0);
  await page.locator(kit('feedback-open')).click();
  await expect(pin).toBeVisible();
  const original = await pin.boundingBox();
  await pin.click();
  await expect(row(page, 'pinned')).toHaveClass(/flash/);
  await page.locator(kit('feedback-close')).click();
  await expect(pin).toHaveCount(0);
  await page.locator(kit('feedback-open')).click();
  assert.deepEqual(await pin.boundingBox(), original);
  assert.deepEqual((await page.evaluate(() => __mock.docs('comments')))[0].pin, { x: 0.5, y: 200 });
  // A programmatic Pin action must also open the panel before capturing a point.
  await page.locator(kit('feedback-close')).click();
  await page.locator(kit('pin-toggle')).dispatchEvent('click');
  await expect(page.locator(kit('panel'))).toBeHidden();
  await expect(page.locator('.capture')).toBeVisible();
});

test("what's new is dismissible and shown once for each selected version", async t => {
  const page = await open(t, {}, { feedback: false });
  const news = page.locator(kit('whats-new'));
  await expect(news).toBeVisible();
  await expect(news).toContainText('A greener welcome.');
  await expect(page.locator(kit('panel'))).toBeHidden();
  assert.equal(await page.evaluate(() => localStorage.getItem('kit:seen:2')), '1');
  await page.getByRole('button', { name: "Dismiss what's new" }).click();
  await expect(news).toBeHidden();
  await page.reload();
  await expect(page.locator(kit('screen'))).toHaveText('Home');
  await expect(news).toBeHidden();
  await page.locator(kit('version')).click();
  await page.locator(`${kit('version-option')}[data-n="1"]`).click();
  await expect(news).toBeVisible();
  await expect(news).toContainText('The first round');
  await page.reload();
  await expect(page.locator(kit('version'))).toHaveText('v1');
  await expect(news).toBeHidden();
  await page.locator(kit('feedback-open')).click();
  await page.locator(kit('notes-toggle')).click();
  await expect(page.locator(kit('notes-toggle'))).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.vnotes-body')).toContainText('The first round');
});

test('generic screens rail is reachable while closed and navigates by hash', async t => {
  const page = await open(t, {}, { feedback: false });
  const rail = page.locator(kit('rail'));
  await expect(rail).toBeVisible();
  await expect(rail).not.toHaveClass(/docked/);
  await rail.locator('.rail-btn').focus();
  await rail.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.frameLocator(kit('frame')).getByRole('heading', { name: 'List', exact: true })).toBeVisible();
  await expect(page.locator(kit('screen'))).toHaveText('List');
  await expect(page.locator(kit('panel'))).toBeHidden();
  await expect(rail.locator('[aria-current="true"]')).toHaveText('List');
  // A reported side cannot be switched without a setSide implementation.
  await expect(rail.getByRole('group', { name: 'Phone or web' })).toHaveCount(0);
});

test('generic rail accepts functions, docks for phone, and vanishes without valid screens', async t => {
  const page = await open(t, {}, { feedback: false, beforeLoad: page => page.addInitScript(() => {
    if (window !== top) {
      window.addEventListener('DOMContentLoaded', () => {
        const groups = window.kitScreens;
        window.kitScreens = () => groups;
        window.kitSide = 'phone';
      });
    }
  }) });
  const rail = page.locator(kit('rail'));
  await expect(rail).toHaveClass(/docked/);
  const menu = await rail.locator('.rail-menu').boundingBox(), stage = await page.locator('.stage').boundingBox();
  assert.ok(menu.x + menu.width <= stage.x);
  await expect(page.locator(kit('panel'))).toBeHidden();
  await page.frameLocator(kit('frame')).locator('body').evaluate(() => {
    delete window.kitScreens;
    window.dispatchEvent(new Event('hashchange'));
  });
  await expect(rail).toBeHidden();
  await expect(page.locator('.app')).not.toHaveClass(/has-rail|rail-docked/);
});

test('mobile Pin lowers the sheet for placement, then a stage pin reopens it', async t => {
  const page = await open(t, { seed: { comments: [comment('pinned', 'home', { pin: { x: 0.5, y: 200 } })] } },
    { viewport: { width: 390, height: 844 } });
  await page.locator(kit('pin-toggle')).click();
  await expect(page.locator(kit('panel'))).toBeHidden();
  await expect(page.locator('.capture')).toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem('kit:panel')), '1');
  await page.keyboard.press('Escape');
  await page.locator(`${kit('pin')}[data-id="pinned"]`).click();
  await expect(page.locator(kit('panel'))).toBeVisible();
  await expect(page.locator('.peek')).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, 'pinned')).toHaveClass(/flash/);
});


test('generic prototypes without kitScreens start without a rail', async t => {
  const page = await open(t, {}, { feedback: false, beforeLoad: page => page.addInitScript(() => {
    if (window !== top) window.addEventListener('DOMContentLoaded', () => { delete window.kitScreens; });
  }) });
  await expect(page.locator(kit('rail'))).toBeHidden();
  await expect(page.locator('.app')).not.toHaveClass(/has-rail|rail-docked/);
});

test('1440×900 web feedback overlays the prototype without changing iframe width', async t => {
  for (const side of ['web', undefined]) await t.test(side || 'no side supplied', async t => {
    const page = await open(t, {}, { feedback: false, viewport: { width: 1440, height: 900 },
      beforeLoad: page => page.addInitScript(side => {
        if (window !== top) window.addEventListener('DOMContentLoaded', () => {
          if (side === undefined) { delete window.kitSide; delete window.kitScreens; }
          else window.kitSide = side;
        });
      }, side) });
    const iframe = page.locator(kit('frame')), panel = page.locator(kit('panel'));
    const width = await iframe.evaluate(el => el.clientWidth);
    await page.locator(kit('feedback-open')).click();
    await expect(panel).toBeVisible();
    await expect.poll(() => iframe.evaluate(el => el.clientWidth)).toBe(width);
    const frameBox = await iframe.boundingBox(), panelBox = await panel.boundingBox();
    assert.ok(panelBox.x > frameBox.x && panelBox.x < frameBox.x + frameBox.width);
    await page.locator(kit('feedback-close')).click();
    await expect(panel).toBeHidden();
    await expect.poll(() => iframe.evaluate(el => el.clientWidth)).toBe(width);
  });
});

test('1440×900 phone feedback undocks the screens rail and closing docks it again', async t => {
  const page = await open(t, {}, { feedback: false, viewport: { width: 1440, height: 900 },
    beforeLoad: page => page.addInitScript(() => {
      if (window !== top) window.addEventListener('DOMContentLoaded', () => { window.kitSide = 'phone'; });
    }) });
  const rail = page.locator(kit('rail')), panel = page.locator(kit('panel'));
  await expect(rail).toHaveClass(/docked/);
  await page.locator(kit('feedback-open')).click();
  await expect(panel).toBeVisible();
  await expect(rail).not.toHaveClass(/docked|open/);
  await expect(rail.locator('.rail-btn')).toBeVisible();
  await expect(page.locator('.app')).not.toHaveClass(/rail-docked/);
  const stage = await page.locator('.stage').boundingBox(), panelBox = await panel.boundingBox();
  assert.ok(stage.width > 760 && stage.x + stage.width <= panelBox.x);
  await page.locator(kit('feedback-close')).click();
  await expect(rail).toHaveClass(/docked/);
  await expect(page.locator('.app')).toHaveClass(/rail-docked/);
});

test('web Pin reveals the covered area and restores feedback after placement or Escape', async t => {
  const page = await open(t);
  const panel = page.locator(kit('panel')), iframe = page.locator(kit('frame'));
  const frameBox = await iframe.boundingBox(), panelBox = await panel.boundingBox();
  const point = { x: panelBox.x + 80, y: frameBox.y + 180 };
  const width = await iframe.evaluate(el => el.clientWidth);
  await page.locator(kit('pin-toggle')).click();
  await expect(panel).toBeHidden();
  await expect(page.locator('.capture')).toBeVisible();
  await expect.poll(() => iframe.evaluate(el => el.clientWidth)).toBe(width);
  await page.mouse.click(point.x, point.y);
  await expect(panel).toBeVisible();
  await expect(page.locator('.capture')).toBeHidden();
  await post(page, 'A point under the feedback overlay');
  await expect.poll(() => page.evaluate(() => __mock.docs('comments').length)).toBe(1);
  const pin = (await page.evaluate(() => __mock.docs('comments')))[0].pin;
  assert.ok(Math.abs(pin.x - (point.x - frameBox.x) / frameBox.width) <= 0.0001);
  assert.ok(Math.abs(pin.y - (point.y - frameBox.y)) <= 1);
  await page.locator(kit('pin-toggle')).click();
  await expect(panel).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await expect(page.locator('.capture')).toBeHidden();
  await expect(page.locator(kit('pin-toggle'))).toHaveAttribute('aria-pressed', 'false');
  assert.deepEqual((await page.evaluate(() => __mock.docs('comments')))[0].pin, pin);
});

function notesManifest(n, notes) {
  return { ...versions, versions: [{ ...versions.versions.at(-1), n, notes }] };
}

test('390×844 first-view notes fit one line and open all version notes', async t => {
  for (const count of [5, 1]) await t.test(`${count} note${count === 1 ? '' : 's'}`, async t => {
    const notes = Array.from({ length: count }, (_, i) => `Fictional change ${i + 1}.`);
    const page = await open(t, {}, { feedback: false, viewport: { width: 390, height: 844 },
      beforeLoad: page => page.route('**/versions.json', route => route.fulfill({ json: notesManifest(6, notes) })) });
    const news = page.locator(kit('whats-new')), summary = news.locator('.news-summary');
    await expect(news).toBeVisible();
    await expect(summary).toHaveText(`What changed in v6 · ${count} note${count === 1 ? '' : 's'} ›`);
    await expect(news.locator('.news-body')).toBeHidden();
    const box = await news.boundingBox(), bar = await page.locator('.feedback-cluster').boundingBox();
    assert.ok(box.height <= 56 && box.y + box.height <= bar.y);
    await summary.click();
    await expect(page.locator(kit('panel'))).toBeVisible();
    await expect(page.locator(kit('notes-toggle'))).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.vnotes-body li')).toHaveText(notes);
    await page.locator(kit('feedback-close')).click();
    await page.getByRole('button', { name: "Dismiss what's new" }).click();
    await expect(news).toBeHidden();
    await page.reload();
    await expect(page.locator(kit('screen'))).toHaveText('Home');
    await expect(news).toBeHidden();
  });
});

test('1440px first-view notes show three notes and All notes, and the version menu dismisses the card', async t => {
  const notes = Array.from({ length: 5 }, (_, i) => `Fictional change ${i + 1}.`);
  const page = await open(t, {}, { feedback: false, beforeLoad: page =>
    page.route('**/versions.json', route => route.fulfill({ json: notesManifest(6, notes) })) });
  const news = page.locator(kit('whats-new'));
  await expect(news.locator('li')).toHaveText(notes.slice(0, 3));
  await news.getByRole('button', { name: 'All notes', exact: true }).click();
  await expect(page.locator(kit('panel'))).toBeVisible();
  await expect(page.locator('.vnotes-body li')).toHaveText(notes);
  await expect(page.locator(kit('notes-toggle'))).toHaveAttribute('aria-expanded', 'true');
  await page.locator(kit('feedback-close')).click();
  await expect(news).toBeVisible();
  await page.locator(kit('version')).click();
  await expect(page.locator(`${kit('version-option')}[data-n="6"]`)).toBeVisible();
  await expect(news).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(news).toBeHidden();
});

test('390×844 Screens opens a sheet, navigates, and closes on choose, Escape or outside tap', async t => {
  const page = await open(t, {}, { feedback: false, viewport: { width: 390, height: 844 } });
  const button = page.locator(kit('screens-open')), rail = page.locator(kit('rail'));
  await expect(button).toBeVisible();
  const feedbackBox = await page.locator(kit('feedback-open')).boundingBox();
  const buttonBox = await button.boundingBox(), versionBox = await page.locator(kit('version')).boundingBox();
  assert.ok(buttonBox.x >= feedbackBox.x + feedbackBox.width && buttonBox.x + buttonBox.width <= versionBox.x);
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(rail.locator('.rail-menu')).toBeVisible();
  await rail.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator(kit('screen'))).toHaveText('List');
  await expect(page.frameLocator(kit('frame')).getByRole('heading', { name: 'List', exact: true })).toBeVisible();
  await expect(rail).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await page.keyboard.press('Escape');
  await expect(rail).toBeHidden();
  await expect(button).toBeFocused();
  await button.click();
  await rail.click({ position: { x: 10, y: 10 } });
  await expect(rail).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await page.frameLocator(kit('frame')).locator('body').evaluate(() => {
    delete window.kitScreens;
    window.dispatchEvent(new Event('hashchange'));
  });
  await expect(button).toBeHidden();
});
