import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../kit/index.html', import.meta.url), 'utf8');
const start = html.indexOf('  function createRemote(');
const end = html.indexOf('  async function connect()', start);
assert.ok(start >= 0 && end > start, 'remote adapter is embedded in the standalone shell');
const createRemote = new Function(html.slice(start, end) + '\nreturn createRemote;')();
const config = { supabaseUrl: 'https://example.invalid/', anonKey: 'fictional-public-anon-key', project: 'sprout' };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
  const stored = options.stored || new Map();
  const requests = [], replaced = [], intervals = new Map(), events = new Map();
  const state = { docs: [], names: {}, ...options.state };
  const env = {
    crypto: webcrypto,
    location: { href: options.href || 'https://example.invalid/review/index.html' },
    history: { state: { preserved: true }, replaceState(...args) { replaced.push(args); } },
    localStorage: {
      getItem(key) { if (options.blockStorage) throw Error('blocked'); return stored.get(key) ?? null; },
      setItem(key, value) { if (options.blockStorage) throw Error('blocked'); stored.set(key, value); },
      removeItem(key) { if (options.blockStorage) throw Error('blocked'); stored.delete(key); }
    },
    document: {
      hidden: false,
      addEventListener(name, callback) { events.set(name, callback); },
      removeEventListener(name, callback) { if (events.get(name) === callback) events.delete(name); }
    },
    setInterval(callback, delay) { const id = intervals.size + 1; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
    async fetch(url, init) {
      const fn = url.split('/').at(-1), args = JSON.parse(init.body);
      requests.push({ url, init, fn, args });
      if (options.respond) return options.respond(fn, args, state);
      let result;
      if (fn === 'pf_list') result = { docs: state.docs, names: state.names };
      else if (fn === 'pf_whoami') result = args.p_owner_key === 'fictional-owner-key'
        ? { author: 'owner', isOwner: true } : { author: 'reviewer-id', isOwner: false };
      else if (fn === 'pf_set_name') {
        const author = args.p_owner_key === 'fictional-owner-key' ? 'owner' : 'reviewer-id';
        state.names[author] = args.p_name.trim();
        result = { author, name: state.names[author] };
      } else result = null;
      return { ok: true, status: result === null ? 204 : 200, json: async () => structuredClone(result) };
    }
  };
  const backend = createRemote(config, env);
  return { backend, env, stored, requests, replaced, intervals, events, state,
    poll: () => [...intervals.values()].forEach(({ callback }) => callback()),
    visibility: () => events.get('visibilitychange')?.() };
}

test('remote capabilities and whoami use public RPC headers and persistent project credentials', async t => {
  const f = fixture(); t.after(() => f.backend.dispose());
  assert.equal(f.backend.remote, true);
  assert.equal((await f.backend.use('db')).collection, f.backend.db.collection);
  assert.equal(await f.backend.use('user'), f.backend.user);
  assert.equal(await f.backend.use('comments'), null);
  assert.equal(await f.backend.user.can('data.write'), true);
  assert.equal(await f.backend.user.can('unknown'), false);
  assert.equal(f.stored.has('pf:secret:sprout'), false, 'secret is lazy');
  assert.deepEqual(await f.backend.user.me(), { id: 'reviewer-id', isOwner: false });
  await f.backend.user.me();
  assert.equal(f.requests.length, 1, 'identity is cached');
  const { url, init, args } = f.requests[0];
  assert.equal(url, 'https://example.invalid/rest/v1/rpc/pf_whoami');
  assert.equal(init.method, 'POST');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.deepEqual(init.headers, { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}`, 'Content-Type': 'application/json' });
  assert.equal(args.p_project, 'sprout');
  assert.equal(args.p_owner_key, null);
  assert.match(args.p_secret, /^[A-Za-z0-9_-]{32,128}$/);
  assert.equal(f.stored.get('pf:secret:sprout'), args.p_secret);
  const second = fixture({ stored: f.stored }); t.after(() => second.backend.dispose());
  await second.backend.user.me();
  assert.equal(second.requests[0].args.p_secret, args.p_secret);
});

test('blocked storage keeps one secret in memory for identity and every write', async t => {
  const f = fixture({ blockStorage: true, href: 'https://example.invalid/?owner=invalid#preview' });
  t.after(() => f.backend.dispose());
  await f.backend.user.me();
  await f.backend.db.collection('comments').doc().set({ text: 'Hello' });
  await f.backend.user.setName('Riley Chen');
  await f.backend.user.signOut();
  const secrets = f.requests.filter(r => r.args.p_secret).map(r => r.args.p_secret);
  assert.ok(secrets.length >= 4);
  assert.equal(new Set(secrets).size, 1);
  assert.match(secrets[0], /^[A-Za-z0-9_-]{32,128}$/);
});

test('malformed stored secrets are replaced with cryptographic ids', async t => {
  const f = fixture({ stored: new Map([['pf:secret:sprout', 'too short!']]) });
  t.after(() => f.backend.dispose());
  await f.backend.user.me();
  assert.match(f.stored.get('pf:secret:sprout'), /^[A-Za-z0-9_-]{32,128}$/);
});

test('owner links persist the key and strip it while preserving URL state, other parameters and hash', async t => {
  const f = fixture({ href: 'https://example.invalid/review/index.html?version=v2&owner=fictional-owner-key&view=open#pin-1' });
  t.after(() => f.backend.dispose());
  assert.equal(f.stored.get('pf:owner:sprout'), 'fictional-owner-key');
  assert.deepEqual(f.replaced, [[{ preserved: true }, '', '/review/index.html?version=v2&view=open#pin-1']]);
  assert.deepEqual(await f.backend.user.me(), { id: 'owner', isOwner: true });
  assert.equal(f.requests[0].args.p_owner_key, 'fictional-owner-key');
  const second = fixture({ stored: f.stored }); t.after(() => second.backend.dispose());
  assert.deepEqual(await second.backend.user.me(), { id: 'owner', isOwner: true });
  assert.equal(second.replaced.length, 0);
});

test('invalid stored owner keys are forgotten and sign out rechecks anonymous identity', async t => {
  const invalid = fixture({ stored: new Map([['pf:owner:sprout', 'invalid']]) });
  t.after(() => invalid.backend.dispose());
  assert.equal((await invalid.backend.user.me()).isOwner, false);
  assert.equal(invalid.stored.has('pf:owner:sprout'), false);
  await invalid.backend.db.collection('comments').doc().set({ text: 'Hello' });
  assert.equal(invalid.requests.find(r => r.fn === 'pf_write').args.p_owner_key, null);
  const owner = fixture({ href: 'https://example.invalid/?owner=fictional-owner-key' });
  t.after(() => owner.backend.dispose());
  await owner.backend.user.me();
  assert.deepEqual(await owner.backend.user.signOut(), { id: 'reviewer-id', isOwner: false });
  assert.equal(owner.stored.has('pf:owner:sprout'), false);
  assert.equal(owner.requests.filter(r => r.fn === 'pf_whoami').at(-1).args.p_owner_key, null);
});

test('set, update and delete use generated ids, exact merge arguments, and refresh after each write', async t => {
  const f = fixture(); t.after(() => f.backend.dispose());
  const collection = f.backend.db.collection('comments');
  const ref = collection.doc();
  assert.match(ref.id, /^[A-Za-z0-9_-]{6,40}$/);
  assert.notEqual(ref.id, collection.doc().id);
  const data = { text: 'Hello', createdAt: '2026-01-01T00:00:00Z' };
  await ref.set(data);
  await ref.update({ approved: true, approvedAt: '2026-01-02T00:00:00Z' });
  await ref.delete();
  assert.deepEqual(f.requests.map(r => r.fn), ['pf_write', 'pf_list', 'pf_write', 'pf_list', 'pf_delete', 'pf_list']);
  const [set, update, del] = f.requests.filter(r => r.fn !== 'pf_list').map(r => r.args);
  assert.deepEqual(set, { p_project: 'sprout', p_secret: f.stored.get('pf:secret:sprout'), p_owner_key: null,
    p_collection: 'comments', p_id: ref.id, p_data: data, p_merge: false });
  assert.equal(update.p_merge, true);
  assert.deepEqual(update.p_data, { approved: true, approvedAt: '2026-01-02T00:00:00Z' });
  assert.deepEqual(del, { p_project: 'sprout', p_secret: set.p_secret, p_owner_key: null, p_collection: 'comments', p_id: ref.id });
  assert.equal(collection.doc('explicit_id').id, 'explicit_id');
});

for (const [status, code] of [[400, 'invalid_argument'], [403, 'not_granted'], [404, 'unavailable'], [429, 'rate_limited'], [500, 'unavailable']]) {
  test(`HTTP ${status} maps to ${code} on identity, writes and snapshot errors`, async t => {
    const f = fixture({ respond: async () => ({ ok: false, status }) });
    t.after(() => f.backend.dispose());
    await assert.rejects(f.backend.user.me(), { code });
    await assert.rejects(f.backend.db.collection('comments').doc().set({}), { code });
    const errors = [];
    f.backend.db.collection('comments').onSnapshot(() => assert.fail('unexpected snapshot'), error => errors.push(error.code));
    await tick();
    assert.deepEqual(errors, [code]);
  });
}

test('network and malformed JSON failures are unavailable and identity can retry', async t => {
  let fail = true;
  const f = fixture({ respond: async () => {
    if (fail) throw Error('offline');
    return { ok: true, status: 200, json: async () => ({ author: 'reviewer-id', isOwner: false }) };
  } });
  t.after(() => f.backend.dispose());
  await assert.rejects(f.backend.user.me(), { code: 'unavailable' });
  await assert.rejects(f.backend.db.collection('comments').doc().delete(), { code: 'unavailable' });
  fail = false;
  assert.deepEqual(await f.backend.user.me(), { id: 'reviewer-id', isOwner: false });
  const bad = fixture({ respond: async () => ({ ok: true, status: 200, json: async () => { throw Error('invalid JSON'); } }) });
  t.after(() => bad.backend.dispose());
  await assert.rejects(bad.backend.user.me(), { code: 'unavailable' });
});

test('snapshots order and limit per query, preserve client dates, expose server fields and keep copies immutable', async t => {
  const f = fixture({ state: { docs: [
    { collection: 'comments', id: 'older-id', data: { text: 'Old', createdAt: '2026-01-01', nested: { value: 1 } }, author: 'reviewer-id', byOwner: false, createdAt: '2026-02-03' },
    { collection: 'comments', id: 'newer-id', data: { text: 'New', author: 'forged', byOwner: false, createdAt: '2026-01-02', nested: { value: 2 } }, author: 'owner', byOwner: true, createdAt: '2026-02-02' },
    { collection: 'replies', id: 'reply-id', data: { text: 'Reply' }, author: 'reviewer-id', byOwner: false, createdAt: '2026-01-03' }
  ], names: { 'reviewer-id': 'Riley Chen' } } });
  t.after(() => f.backend.dispose());
  const events = [], replies = [];
  const comments = f.backend.db.collection('comments');
  comments.orderBy('createdAt', 'desc').limit(1).onSnapshot(snap => events.push(snap));
  f.backend.db.collection('replies').onSnapshot(snap => replies.push(snap));
  await tick();
  assert.equal(events.length, 1);
  assert.equal(events[0].docs.length, 1);
  assert.equal(events[0].docs[0].id, 'newer-id');
  assert.deepEqual(events[0].docs[0].data(), { text: 'New', author: 'owner', byOwner: true, createdAt: '2026-01-02', nested: { value: 2 } });
  assert.equal(replies[0].docs[0].data().createdAt, '2026-01-03', 'server date is a fallback');
  assert.deepEqual(await f.backend.user.profiles(['reviewer-id', 'owner', 'missing']), {
    'reviewer-id': { name: 'Riley Chen' }, owner: { name: 'Owner' }, missing: { name: '' }
  });
  const exposed = events[0].docs[0].data();
  exposed.nested.value = 99;
  assert.equal(events[0].docs[0].data().nested.value, 2);
  f.state.docs[1].data.text = 'Changed';
  f.poll(); await tick();
  assert.equal(events[0].docs[0].data().text, 'New');
  assert.equal(events[1].docs[0].data().text, 'Changed');
  const all = [];
  comments.onSnapshot(snap => all.push(snap)); await tick();
  assert.equal(all[0].docs.length, 2, 'order and limit do not mutate the original query');
});

test('polls every eight seconds only while visible, refreshes on visibility and writes, and cleans up', async t => {
  const f = fixture(); t.after(() => f.backend.dispose());
  assert.deepEqual([...f.intervals.values()].map(x => x.delay), [8000]);
  const events = [];
  const off = f.backend.db.collection('comments').onSnapshot(snap => events.push(snap));
  await tick();
  assert.equal(events.length, 1);
  f.env.document.hidden = true;
  f.poll(); f.visibility(); await tick();
  assert.equal(events.length, 1);
  f.env.document.hidden = false;
  f.visibility(); await tick();
  assert.equal(events.length, 2);
  f.poll(); await tick();
  assert.equal(events.length, 3);
  await f.backend.db.collection('comments').doc().set({ text: 'Hello' });
  assert.equal(events.length, 4);
  off();
  const requestCount = f.requests.length;
  f.poll(); f.visibility(); await tick();
  assert.equal(f.requests.length, requestCount);
  assert.equal(events.length, 4);
  const cancel = f.backend.db.collection('comments').onSnapshot(() => assert.fail('canceled delivery'));
  cancel(); await tick();
  f.backend.dispose();
  assert.equal(f.intervals.size, 0);
  assert.equal(f.events.size, 0);
});

test('a write during an in-flight poll fetches fresh data after the stale response completes', async t => {
  let release, listCalls = 0;
  const f = fixture({ respond: async fn => {
    if (fn !== 'pf_list') return { ok: true, status: 204 };
    listCalls++;
    if (listCalls === 1) await new Promise(resolve => { release = resolve; });
    return { ok: true, status: 200, json: async () => ({ names: {}, docs: listCalls === 1 ? [] : [
      { collection: 'comments', id: 'fresh-id', author: 'reviewer-id', byOwner: false,
        data: { text: 'Just posted', createdAt: '2026-01-01' } }
    ] }) };
  } });
  t.after(() => f.backend.dispose());
  const events = [];
  f.backend.db.collection('comments').onSnapshot(snap => events.push(snap));
  await tick();
  const writing = f.backend.db.collection('comments').doc('fresh-id').set({ text: 'Just posted' });
  await tick();
  assert.equal(listCalls, 1, 'write waits for the current request');
  release();
  await writing;
  assert.equal(listCalls, 2, 'stale poll cannot replace the post-write refresh');
  assert.equal(events.at(-1).docs[0].data().text, 'Just posted');
});

test('name lookup loads server names before first comment, and saving refreshes profiles and local cache', async t => {
  const f = fixture({ state: { names: { 'reviewer-id': 'Riley Chen' } } });
  t.after(() => f.backend.dispose());
  assert.equal(await f.backend.user.getName(), 'Riley Chen');
  assert.equal(await f.backend.user.setName('Jordan Park'), 'Jordan Park');
  assert.equal(f.stored.get('pf:name:sprout:reviewer-id'), 'Jordan Park');
  assert.equal(await f.backend.user.getName(), 'Jordan Park');
  assert.deepEqual(await f.backend.user.profiles(['reviewer-id']), { 'reviewer-id': { name: 'Jordan Park' } });
  const saved = f.requests.find(r => r.fn === 'pf_set_name');
  assert.equal(saved.args.p_name, 'Jordan Park');
  assert.equal(saved.args.p_secret, f.stored.get('pf:secret:sprout'));
  const owner = fixture({ href: 'https://example.invalid/?owner=fictional-owner-key' });
  t.after(() => owner.backend.dispose());
  await owner.backend.user.setName('Riley Chen');
  assert.deepEqual(await owner.backend.user.profiles(['owner']), { owner: { name: 'Riley Chen' } });
});

for (const owner of [false, true]) {
  test(`shell reconnects ${owner ? 'owner' : 'reviewer'} identity after initial whoami network failure`, async t => {
    let identityCalls = 0, releaseList;
    const listGate = new Promise(resolve => { releaseList = resolve; });
    const author = owner ? 'owner' : 'reviewer-id';
    const f = fixture({
      href: 'https://example.invalid/review/' + (owner ? '?owner=fictional-owner-key' : ''),
      respond: async (fn, args) => {
        if (fn === 'pf_whoami') {
          identityCalls++;
          if (identityCalls === 1) throw Error('temporary network failure');
          assert.equal(args.p_owner_key, owner ? 'fictional-owner-key' : null);
          return { ok: true, status: 200, json: async () => ({ author, isOwner: owner }) };
        }
        assert.equal(fn, 'pf_list');
        await listGate;
        return { ok: true, status: 200, json: async () => ({ docs: [], names: { [author]: 'Riley Chen' } }) };
      }
    });
    t.after(() => f.backend.dispose());
    const recoverStart = html.indexOf('  async function recoverRemoteViewer()');
    const connectEnd = html.indexOf('  async function write(', recoverStart);
    assert.ok(recoverStart >= 0 && connectEnd > recoverStart);
    const S = { remote: false, me: null, owner: false, canWrite: false, feed: 'loading' };
    const nameInput = { value: '' }, window = {};
    let renders = 0, scheduled = 0, configFetches = 0;
    const shell = new Function('S', 'window', 'fetch', 'createRemote', 'nameInput', 'render', 'scheduleRender',
      'normComment', 'normReply', 'byCreated', html.slice(recoverStart, connectEnd) + '\nreturn { connect, recoverRemoteViewer };')(
      S, window,
      async (url, init) => {
        configFetches++;
        assert.equal(url, 'remote.json');
        assert.equal(init.cache, 'no-store');
        assert.equal(init.referrerPolicy, 'no-referrer');
        return { ok: true, json: async () => config };
      },
      value => { assert.deepEqual(value, config); return f.backend; },
      nameInput, () => { renders++; }, () => { scheduled++; },
      (id, data) => ({ id, ...data }), (id, data) => ({ id, ...data }), () => 0
    );
    await shell.connect();
    assert.equal(identityCalls, 1, 'initial identity request failed');
    assert.equal(S.me, null);
    assert.equal(S.canWrite, false);
    assert.equal(S.remote, true);
    assert.equal(S.db.collection, f.backend.db.collection);
    assert.equal(window.claude, f.backend);
    assert.equal(configFetches, 1);
    releaseList();
    await tick();
    assert.equal(identityCalls, 2, 'first successful snapshot retries identity');
    assert.equal(S.me, author);
    assert.equal(S.owner, owner, 'owner controls follow verified identity');
    assert.equal(S.canWrite, true);
    assert.equal(S.feed, 'ready');
    assert.equal(S.gotC, true);
    assert.equal(S.savedName, 'Riley Chen');
    assert.equal(nameInput.value, 'Riley Chen');
    assert.equal(S.identityLoading, false);
    assert.ok(renders >= 2);
    assert.ok(scheduled >= 2);
    f.poll(); await tick();
    assert.equal(identityCalls, 2, 'later snapshots reuse recovered identity');
  });
}
