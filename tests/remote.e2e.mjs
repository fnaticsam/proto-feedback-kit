import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';
import { kit, post, row } from '../dev/harness/browser.mjs';
import { anonKey, ownerKey, remoteProject, startRemoteServer } from './helpers/remote-server.mjs';

const root = path.resolve(import.meta.dirname, '..');
const extraOwnerKey = 'fictional-extra-owner-key-for-browser-tests';
let browser, server, temporary;
before(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'pf-remote-e2e-'));
  const site = path.join(temporary, 'site');
  await mkdir(site);
  server = await startRemoteServer({ directory: site, ownerKeys: { riley: extraOwnerKey } });
  await writeFile(path.join(temporary, 'proto-v1.html'), '<!doctype html><html><head><title>Sprout</title></head><body><h1>Sprout</h1><p>Water your fictional fern.</p></body></html>');
  await writeFile(path.join(temporary, 'versions.json'), JSON.stringify({ title: 'Sprout', adapter: 'generic', versions: [
    { n: 1, file: 'proto-v1.html', date: '2026-10-26', title: 'First idea', notes: [], fixed: [] }
  ] }));
  await writeFile(path.join(temporary, 'remote.json'), JSON.stringify({ supabaseUrl: server.url, anonKey, project: remoteProject }));
  await promisify(execFile)(process.execPath, [path.join(root, 'tools/build-site.mjs'),
    '--out', site, '--versions', path.join(temporary, 'versions.json'), '--protos', temporary,
    '--remote', path.join(temporary, 'remote.json'), '--title', 'Sprout']);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

async function open(t, query = '') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
    route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  // Drive the real eight-second polling interval without waiting eight wall-clock seconds.
  await page.clock.install();
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); });
  await page.goto(server.url + '/' + query, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(kit('screen'))).not.toHaveText('…');
  await page.mouse.move(1439, 0);
  if (!await page.locator(kit('panel')).isVisible()) await page.locator(kit('feedback-open')).click();
  await expect(page.locator(kit('name'))).toBeVisible();
  return page;
}

async function poll(page, fn) {
  const count = server.requests.filter(r => r.fn === 'pf_list').length;
  await page.clock.fastForward(8100);
  await expect.poll(() => server.requests.filter(r => r.fn === 'pf_list').length).toBeGreaterThan(count);
  await fn();
}

test('built static site supports named anonymous feedback, polling and distinct private owners', async t => {
  assert.ok((await readFile(path.join(temporary, 'site/index.html'), 'utf8')).startsWith('<!doctype html>'));
  const reviewer = await open(t), observer = await open(t);
  assert.equal(await reviewer.evaluate(() => typeof window.claude?.use), 'function');
  assert.equal(await reviewer.evaluate(() => typeof window.__mock), 'undefined');
  // A name is required before the first comment; the draft stays available.
  await post(reviewer, 'Keep the watering reminder near the fern.');
  await expect(reviewer.locator(kit('name'))).toBeFocused();
  await expect(reviewer.locator(kit('composer'))).toHaveValue('Keep the watering reminder near the fern.');
  assert.equal(server.backend.docs.size, 0);
  assert.equal(server.requests.filter(request => request.fn === 'pf_write').length, 0);
  await reviewer.locator(kit('name')).fill('Riley Chen');
  await post(reviewer, 'Keep the watering reminder near the fern.');
  await expect(reviewer.locator(kit('comment'))).toHaveCount(1);
  const comment = [...server.backend.docs.values()].find(doc => doc.collection === 'comments');
  assert.match(comment.id, /^[A-Za-z0-9_-]{6,40}$/);
  const secret = await reviewer.evaluate(project => localStorage.getItem('pf:secret:' + project), remoteProject);
  assert.match(secret, /^[A-Za-z0-9_-]{32,128}$/);
  assert.equal(comment.author, 'a_' + createHash('sha256').update(secret).digest('hex').slice(0, 20));
  assert.equal(comment.byOwner, false);
  assert.equal(server.backend.names[comment.author], 'Riley Chen');
  assert.equal(comment.data.status, 'open');
  await poll(observer, async () => {
    await expect(row(observer, comment.id)).toContainText('Keep the watering reminder near the fern.');
    await expect(row(observer, comment.id).locator(':scope > .c-head .c-name')).toHaveText('Riley Chen');
  });
  for (const page of [reviewer, observer]) {
    await expect(page.locator(kit('resolve'))).toHaveCount(0);
    await expect(page.locator(kit('approve'))).toHaveCount(0);
    await expect(page.locator(kit('owner-signout'))).toBeHidden();
  }

  // A browser whose first contribution is a reply gets the same compact name
  // field above its reply textarea and cannot submit anonymously.
  const thread = row(observer, comment.id);
  await thread.locator(kit('reply')).click();
  const replyName = thread.locator(kit('reply-name'));
  await expect(replyName).toBeVisible();
  assert.equal(await replyName.evaluate(input => Boolean(input.compareDocumentPosition(
    input.parentElement.querySelector('textarea')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
  await thread.getByRole('textbox', { name: 'Reply', exact: true }).fill('The fern reminder helps.');
  await thread.locator('.rbar').getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(replyName).toBeFocused();
  assert.equal([...server.backend.docs.values()].filter(doc => doc.collection === 'replies').length, 0);
  await expect(thread.getByRole('textbox', { name: 'Reply', exact: true })).toHaveValue('The fern reminder helps.');
  await replyName.fill('Jordan Park');
  await thread.locator('.rbar').getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(thread.locator('.replies')).toContainText('The fern reminder helps.');
  const reply = [...server.backend.docs.values()].find(doc => doc.collection === 'replies');
  assert.equal(reply.data.commentId, comment.id);
  assert.equal(reply.byOwner, false);
  assert.equal(server.backend.names[reply.author], 'Jordan Park');
  // Once the browser has a name, later replies don't ask for it again.
  await thread.locator(kit('reply')).click();
  await expect(thread.getByRole('textbox', { name: 'Reply', exact: true })).toBeVisible();
  await expect(thread.locator(kit('reply-name'))).toHaveCount(0);

  const owner = await open(t, '?view=review&owner=' + encodeURIComponent(ownerKey) + '#v1');
  const cleaned = new URL(owner.url());
  assert.equal(cleaned.searchParams.has('owner'), false);
  assert.equal(cleaned.searchParams.get('view'), 'review');
  assert.equal(cleaned.hash, '#v1');
  assert.equal(await owner.evaluate(project => localStorage.getItem('pf:owner:' + project), remoteProject), ownerKey);
  await expect(row(owner, comment.id).locator(kit('resolve'))).toBeVisible();
  await row(owner, comment.id).locator(kit('approve')).click();
  await expect(row(owner, comment.id).locator('.chip')).toHaveText('Do next');
  await expect(row(owner, comment.id).locator(kit('approve'))).toHaveAttribute('aria-pressed', 'true');
  assert.equal(server.backend.docs.get('comments:' + comment.id).data.approved, true);
  assert.equal(new Date(server.backend.docs.get('comments:' + comment.id).data.approvedAt).toISOString(),
    server.backend.docs.get('comments:' + comment.id).data.approvedAt);
  // Owner action does not replace the original author or turn it into an owner post.
  assert.equal(server.backend.docs.get('comments:' + comment.id).author, comment.author);
  assert.equal(server.backend.docs.get('comments:' + comment.id).byOwner, false);
  await poll(observer, async () => expect(row(observer, comment.id).locator('.chip')).toHaveText('Do next'));
  await row(owner, comment.id).locator(kit('approve')).click();
  await expect(row(owner, comment.id).locator('.chip')).toHaveCount(0);
  assert.equal(server.backend.docs.get('comments:' + comment.id).data.approved, false);
  assert.equal(server.backend.docs.get('comments:' + comment.id).data.approvedAt, null);
  await poll(observer, async () => expect(row(observer, comment.id).locator('.chip')).toHaveCount(0));

  // Names stay editable in the composer; other browsers receive the new name on poll.
  await reviewer.locator(kit('name')).fill('Riley');
  await post(reviewer, 'The plant card is clear.');
  await expect(reviewer.locator(kit('comment'))).toHaveCount(2);
  await poll(observer, async () => expect(row(observer, comment.id).locator(':scope > .c-head .c-name')).toHaveText('Riley'));
  await reviewer.reload();
  if (!await reviewer.locator(kit('panel')).isVisible()) await reviewer.locator(kit('feedback-open')).click();
  await expect(reviewer.locator(kit('name'))).toHaveValue('Riley');
  assert.equal(await reviewer.evaluate(project => localStorage.getItem('pf:secret:' + project), remoteProject), secret);

  await owner.locator(kit('name')).fill('Jordan Park');
  await post(owner, 'I will keep the reminder by the card.');
  await expect(owner.locator(kit('comment')).filter({ hasText: 'I will keep the reminder by the card.' })).toHaveCount(1);
  const ownerComment = [...server.backend.docs.values()].find(doc => doc.collection === 'comments' && doc.byOwner);
  assert.ok(ownerComment);
  await expect(row(owner, ownerComment.id).locator(kit('owner-mark'))).toBeVisible();
  await expect(row(owner, ownerComment.id).locator(kit('approve'))).toHaveCount(0);
  await poll(observer, async () => {
    await expect(row(observer, ownerComment.id).locator('.c-name')).toHaveText('Jordan Park');
    await expect(row(observer, ownerComment.id).locator(kit('owner-mark'))).toBeVisible();
  });
  const extraOwner = await open(t, '?owner=' + encodeURIComponent(extraOwnerKey));
  assert.deepEqual(await extraOwner.evaluate(async () => (await window.claude.use('user')).me()),
    { id: 'owner:riley', isOwner: true });
  await expect(row(extraOwner, comment.id).locator(kit('resolve'))).toBeVisible();
  await row(extraOwner, comment.id).locator(kit('approve')).click();
  await expect(row(extraOwner, comment.id).locator('.chip')).toHaveText('Do next');
  assert.equal(server.backend.docs.get('comments:' + comment.id).data.approved, true);
  await extraOwner.locator(kit('name')).fill('Riley Chen');
  await post(extraOwner, 'The extra owner will review the fern card.');
  const extraComment = extraOwner.locator(kit('comment')).filter({ hasText: 'The extra owner will review the fern card.' });
  await expect(extraComment).toHaveCount(1);
  await expect(extraComment.locator(kit('owner-mark'))).toBeVisible();
  assert.equal(server.backend.names.owner, 'Jordan Park');
  assert.equal(server.backend.names['owner:riley'], 'Riley Chen');
  const extraDoc = [...server.backend.docs.values()].find(doc => doc.author === 'owner:riley');
  assert.equal(extraDoc.byOwner, true);
  await poll(owner, async () => {
    await expect(row(owner, ownerComment.id).locator('.c-name')).toHaveText('Jordan Park');
    await expect(row(owner, extraDoc.id).locator('.c-name')).toHaveText('Riley Chen');
  });
  await extraOwner.reload();
  if (!await extraOwner.locator(kit('panel')).isVisible()) await extraOwner.locator(kit('feedback-open')).click();
  await expect(extraOwner.locator(kit('name'))).toHaveValue('Riley Chen');
  await owner.locator(kit('owner-signout')).click();
  await expect(owner.locator(kit('resolve'))).toHaveCount(0);
  await expect(owner.locator(kit('approve'))).toHaveCount(0);
  assert.equal(await owner.evaluate(project => localStorage.getItem('pf:owner:' + project), remoteProject), null);
});
