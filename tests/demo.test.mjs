import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSeed, shotTargets } from '../dev/demo/data.mjs';

const comment = (id, extra = {}) => ({ id, screen: '/today', screenTitle: 'Today', hash: '#/today',
  version: 1, pin: null, text: 'A fictional note', author: 'jordan', createdAt: '2026-10-19T10:00:00Z',
  updatedAt: '2026-10-19T10:00:00Z', status: 'open', resolvedIn: null, ...extra });
const feedback = { comments: [comment('fixed'), comment('still-open')], replies: [] };
const current = { comments: [comment('new', { author: 'riley', version: 2, pin: { x: .5, y: 100 } }),
  comment('another', { version: 2, pin: { x: .7, y: 200 } })],
replies: [{ id: 'reply', commentId: 'new', author: 'jordan', text: 'A fictional reply', version: 2 }] };
const manifest = { versions: [{ n: 1, fixed: [] }, { n: 2, fixed: ['fixed'] }] };

test('demo seed combines rounds and resolves fixed v1 comments in v2 without mutating input', () => {
  const before = structuredClone({ feedback, current, manifest });
  const seed = buildSeed(feedback, current, manifest);
  assert.equal(seed.comments.length, 4);
  assert.equal(seed.replies.length, 1);
  assert.deepEqual(seed.comments.filter(comment => comment.status === 'done').map(({ id, version, resolvedIn }) =>
    ({ id, version, resolvedIn })), [{ id: 'fixed', version: 1, resolvedIn: 2 }]);
  assert.equal(seed.comments.filter(comment => comment.status === 'open').length, 3);
  assert.ok([...seed.comments, ...seed.replies].every(record => ['riley', 'jordan'].includes(record.author)));
  assert.deepEqual({ feedback, current, manifest }, before);
  seed.comments[2].pin.x = 0;
  assert.equal(current.comments[0].pin.x, .5);
});

test('a current seed record replaces the v1 record with the same id', () => {
  const later = { comments: [...current.comments, comment('fixed', { text: 'Fixed in v2' })], replies: [] };
  const seed = buildSeed(feedback, later, manifest);
  assert.equal(seed.comments.length, 4);
  assert.equal(seed.comments.find(comment => comment.id === 'fixed').text, 'Fixed in v2');
  assert.equal(seed.comments.find(comment => comment.id === 'fixed').status, 'done');
});

test('demo seed rejects missing fixed comments, duplicate ids and unknown reviewers', () => {
  assert.throws(() => buildSeed(feedback, current, { versions: [{ n: 2, fixed: ['missing'] }] }), /missing/);
  assert.throws(() => buildSeed({ comments: [comment('twice'), comment('twice')], replies: [] }, current, manifest), /duplicate/);
  assert.throws(() => buildSeed({ comments: [comment('fixed', { author: 'unknown' })], replies: [] }, current, manifest), /reviewer/);
});

test('capture targets come from open threads and pin counts, and missing targets fail loudly', () => {
  const seed = buildSeed(feedback, current, manifest);
  assert.equal(shotTargets(seed).thread.id, 'new');
  assert.equal(shotTargets(seed).pinsScreen, '/today');
  assert.throws(() => shotTargets({ ...seed, replies: [] }), /reply/);
  assert.throws(() => shotTargets({ ...seed, comments: seed.comments.slice(0, 3) }), /several/);
});
