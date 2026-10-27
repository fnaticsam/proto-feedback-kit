import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const script = await readFile(new URL('../dev/mock-claude.js', import.meta.url), 'utf8');
function mock(config = {}) {
  const window = { __mockClaudeConfig: config };
  vm.runInNewContext(script, { window, setTimeout, structuredClone });
  return window;
}
// Normalize values crossing the VM boundary, keeping assertions about public results.
const plain = value => JSON.parse(JSON.stringify(value));

test('capabilities resolve on a later task, including unsupported names, and supply user and sample namespaces', async () => {
  const { claude } = mock({ me: { id: 'riley', name: 'Riley Chen' }, canWrite: null, people: { jordan: { name: 'Jordan Park' } } });
  let resolved = false;
  const pending = claude.use('user').then(user => { resolved = true; return user; });
  await Promise.resolve();
  assert.equal(resolved, false, 'a microtask is too early for use()');
  const user = await pending;
  assert.equal(await user.id(), 'riley');
  assert.equal((await user.me()).name, 'Riley Chen');
  assert.equal(await user.isOwner(), false);
  assert.equal(await user.canEdit(), true);
  assert.equal(await user.can('data.write'), null);
  assert.deepEqual(plain(await user.profiles(['jordan', 'unknown'])), { jordan: { id: 'jordan', name: 'Jordan Park' }, unknown: { id: 'unknown', name: '' } });
  assert.equal(await claude.use('unknown'), null);
  assert.equal(await claude.use('toString'), null);
  const sample = await claude.use('sample');
  assert.deepEqual(plain(await sample('hello', {})), { text: 'Mock answer', truncated: false });
  assert.deepEqual(plain(await sample.json('hello', {})), { text: 'Mock answer', truncated: false });
});

test('snapshot delivery is asynchronous, ordered and limited, follows every change, and unsubscribes', async () => {
  const { claude, __mock } = mock({ seed: { comments: [{ id: 'a', createdAt: '1', text: 'old' }, { id: 'b', createdAt: '2' }] } });
  const db = await claude.use('db');
  const events = [];
  let delivered;
  let pending = new Promise(resolve => { delivered = resolve; });
  const unsubscribe = db.collection('comments').orderBy('createdAt', 'desc').limit(1).onSnapshot(snap => {
    events.push(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    delivered();
  }, error => { throw error; });
  assert.equal(events.length, 0);
  await pending;
  assert.deepEqual(plain(events[0]), [{ id: 'b', createdAt: '2' }]);
  pending = new Promise(resolve => { delivered = resolve; });
  __mock.update('comments', 'a', { createdAt: '3', text: 'new' });
  await pending;
  assert.deepEqual(plain(events[1]), [{ id: 'a', createdAt: '3', text: 'new' }]);
  pending = new Promise(resolve => { delivered = resolve; });
  await db.collection('comments').doc('a').set({ createdAt: '4' });
  await pending;
  assert.deepEqual(plain(events[2]), [{ id: 'a', createdAt: '4' }], 'set replaces rather than merges');
  assert.deepEqual(plain(events[1]), [{ id: 'a', createdAt: '3', text: 'new' }], 'old snapshots retain their values');
  pending = new Promise(resolve => { delivered = resolve; });
  await db.collection('comments').doc('a').delete();
  await pending;
  assert.equal(events.length, 4);
  unsubscribe();
  __mock.set('comments', 'c', { createdAt: '5' });
  // A later task after notification would have been enqueued.
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(events.length, 4);
  let count = 0;
  const cancel = db.collection('comments').onSnapshot(() => count++);
  cancel();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(count, 0, 'unsubscribe cancels the initial delivery too');
});

test('document operations copy data, merge updates, generate ids and return coded write errors', async () => {
  const { claude, __mock } = mock({ canWrite: true });
  const collection = (await claude.use('db')).collection('comments');
  const ref = collection.doc();
  assert.notEqual(ref.id, collection.doc().id);
  const value = { text: 'one', nested: { value: 1 } };
  await ref.set(value);
  value.nested.value = 2;
  await ref.update({ text: 'two' });
  assert.deepEqual(plain((await ref.get()).data()), { text: 'two', nested: { value: 1 } });
  const saved = (await ref.get()).data();
  saved.nested.value = 99;
  assert.equal((await ref.get()).data().nested.value, 1);
  await ref.delete();
  await ref.delete();
  assert.equal((await ref.get()).exists, false);
  await assert.rejects(ref.update({ text: 'missing' }), error => error.name === 'Error' && error.code === 'invalid_argument');
  for (const n of [0, 1001, 1.5]) assert.throws(() => collection.limit(n), error => error.code === 'invalid_argument');
  collection.limit(1); collection.limit(1000);
  __mock.refuseWrites = 'revoked';
  await assert.rejects(ref.set({ text: 'no' }), error => error.code === 'revoked');
  __mock.refuseWrites = null;
  await ref.set({ text: 'allowed again' });
  assert.equal(__mock.docs('comments').length, 1);
  const readonly = await mock({ canWrite: false }).claude.use('db');
  await assert.rejects(readonly.collection('comments').doc().set({}), error => error.code === 'not_granted');
});
