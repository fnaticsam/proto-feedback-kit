import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the shell's real registration and choice logic without a browser or network.
const shell = await readFile(new URL('../kit/index.html', import.meta.url), 'utf8');
const adapters = shell.slice(shell.indexOf('  /* ---------- adapters'), shell.indexOf('  /* ---------- the screens rail'));
const attach = shell.slice(shell.indexOf('  function attach()'), shell.indexOf('  function bind('));
function adapter(name = 'garden', matches = true) {
  return { name, detect: () => matches, screen: () => ({ id: 'garden', title: 'Garden', hash: '#/garden' }),
    onChange: () => () => {}, target: () => null, go() {} };
}
function runtime({ entries, outcome = 'load', named = null, adapterWaitMs = 0 } = {}) {
  const timers = new Map(), warnings = [], chosen = [], scripts = [];
  let now = 0, serial = 0, removed = 0;
  const context = vm.createContext({
    window: {}, S: { manifest: { adapter: named, adapterWaitMs }, token: 0 },
    frame: { contentWindow: { document: { body: {} } } },
    document: {
      createElement: () => ({ remove() { removed++; } }),
      head: { appendChild(script) {
        scripts.push(script);
        queueMicrotask(() => {
          if (outcome === 'hang') return;
          if (entries !== undefined) context.window.kitAdapters = entries;
          script[outcome === 'load' ? 'onload' : 'onerror']();
        });
      } }
    },
    console: { warn: (...args) => warnings.push(args) },
    setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id), performance: { now: () => now },
    detach() {}, render() {}, bind: (_token, _win, selected) => chosen.push(selected)
  });
  vm.runInContext(adapters + '\n' + attach + '\nthis.api = { loadAdapters, attach, generic };', context);
  return { ...context.api, warnings, chosen, scripts, timers, get removed() { return removed; },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      now = end;
    }
  };
}

test('manifest readiness waits accept only integers from zero through eight seconds', async () => {
  const load = shell.slice(shell.indexOf('  function cleanVersion('), shell.indexOf('  async function openVersion('));
  for (const [value, expected] of [[undefined, 0], [null, 0], ['8000', 0], [-1, 0], [1.5, 0], [8001, 0], [0, 0], [1, 1], [8000, 8000]]) {
    const context = vm.createContext({
      S: {}, document: {}, location: { hash: '' }, showStage() {}, openVersion() {},
      str: (value, max) => typeof value === 'string' ? value.slice(0, max) : '',
      sget: () => null, latest: () => null,
      fetch: async () => ({ ok: true, json: async () => ({ adapterWaitMs: value, versions: [{ n: 1, file: 'proto-v1.html' }] }) })
    });
    await vm.runInContext(load + '\nloadManifest();', context);
    assert.equal(context.S.manifest.adapterWaitMs, expected, String(value));
  }
});

test('an opted-in named adapter waits for readiness and never selects another detector', async () => {
  let ready = false;
  const selected = { ...adapter('manual'), detect: () => ready };
  const r = runtime({ entries: [adapter(), selected], named: 'manual', adapterWaitMs: 8000 });
  await r.loadAdapters(); r.attach();
  r.advance(7900);
  assert.equal(r.chosen.length, 0);
  ready = true; r.advance(100);
  assert.equal(r.chosen[0], selected);
  assert.equal(r.timers.size, 0);
});

test('an opted-in named adapter falls back to generic at its readiness deadline', async () => {
  for (const detect of [() => false, () => { throw new Error('not ready'); }]) {
    const r = runtime({ entries: [adapter(), { ...adapter('manual'), detect }], named: 'manual', adapterWaitMs: 8000 });
    await r.loadAdapters(); r.attach();
    r.advance(7900);
    assert.equal(r.chosen.length, 0);
    r.advance(100);
    assert.equal(r.chosen[0], r.generic);
    assert.equal(r.timers.size, 0);
  }
});

test('generic stays immediate and unknown names keep automatic detection timing', async () => {
  const generic = runtime({ entries: [adapter()], named: 'generic', adapterWaitMs: 8000 });
  await generic.loadAdapters(); generic.attach();
  assert.equal(generic.chosen[0], generic.generic);
  const unknown = runtime({ entries: [adapter('manual', false)], named: 'unknown', adapterWaitMs: 8000 });
  await unknown.loadAdapters(); unknown.attach(); unknown.advance(2000);
  assert.equal(unknown.chosen[0], unknown.generic);
  assert.equal(unknown.warnings.length, 1);
});

test('a new frame attach cancels a stale readiness poll and restarts detection', async () => {
  let ready = false;
  const selected = { ...adapter('manual'), detect: () => ready };
  const r = runtime({ entries: [selected], named: 'manual', adapterWaitMs: 8000 });
  await r.loadAdapters(); r.attach(); r.advance(100);
  r.attach(); ready = true; r.advance(100);
  assert.deepEqual(r.chosen, [selected]);
  r.advance(8000);
  assert.deepEqual(r.chosen, [selected]);
});

test('adapter loading awaits the sibling script and honours registration order', async () => {
  const skipped = adapter('other', false), selected = adapter(), later = adapter('later');
  const r = runtime({ entries: [skipped, selected, later] });
  await r.loadAdapters();
  assert.equal(r.scripts[0].src, 'adapters.js');
  assert.equal(r.removed, 1);
  assert.equal(r.timers.size, 0);
  r.attach();
  assert.equal(r.chosen[0], selected);
  assert.equal(r.warnings.length, 0);
});

test('a named registered adapter wins without requiring detection and generic remains selectable', async () => {
  const selected = adapter('manual', false);
  const named = runtime({ entries: [adapter(), selected], named: 'manual' });
  await named.loadAdapters(); named.attach();
  assert.equal(named.chosen[0], selected);
  const generic = runtime({ entries: [adapter()], named: 'generic' });
  await generic.loadAdapters(); generic.attach();
  assert.equal(generic.chosen[0], generic.generic);
});

test('unknown manifest names warn and fall back to detection or generic', async () => {
  const selected = adapter();
  const detected = runtime({ entries: [selected], named: 'unknown' });
  await detected.loadAdapters(); detected.attach();
  assert.equal(detected.chosen[0], selected);
  assert.match(detected.warnings[0][0], /unknown adapter "unknown"/);
  const missing = runtime({ outcome: 'error', named: 'toString' });
  await missing.loadAdapters(); missing.attach();
  assert.equal(missing.chosen[0], missing.generic);
  assert.match(missing.warnings[0][0], /unknown adapter "toString"/);
});

test('invalid entries, missing methods, reserved names and duplicates warn and are skipped', async () => {
  const valid = adapter();
  const invalid = [null, 1, 'adapter', [], {}, adapter(''), adapter('Uppercase'), adapter(42), adapter('generic'),
    { ...valid, get name() { throw new Error('getter'); } }];
  for (const method of ['detect', 'screen', 'onChange', 'target', 'go']) invalid.push({ ...valid, [method]: null });
  const r = runtime({ entries: [...invalid, valid, adapter()] });
  await r.loadAdapters(); r.attach();
  assert.equal(r.chosen[0], valid);
  assert.equal(r.warnings.length, invalid.length + 1);
});

test('an invalid registry warns while an absent registry silently selects generic', async () => {
  const invalid = runtime({ entries: {} });
  await invalid.loadAdapters(); invalid.attach();
  assert.equal(invalid.chosen[0], invalid.generic);
  assert.match(invalid.warnings[0][0], /must be an array/);
  const absent = runtime({ outcome: 'error' });
  await absent.loadAdapters(); absent.attach();
  assert.equal(absent.chosen[0], absent.generic);
  assert.equal(absent.warnings.length, 0);
});

test('a hung script times out, removes the tag and allows generic selection', async () => {
  const r = runtime({ outcome: 'hang' });
  let loaded = false;
  const pending = r.loadAdapters().then(() => { loaded = true; });
  r.advance(1499); await Promise.resolve();
  assert.equal(loaded, false);
  r.advance(1); await pending;
  assert.equal(loaded, true);
  assert.equal(r.removed, 1);
  assert.equal(r.scripts[0].onload, null);
  assert.equal(r.scripts[0].onerror, null);
  r.attach();
  assert.equal(r.chosen[0], r.generic);
});

test('automatic detection allows delayed initialization and bounds nonmatching or throwing detectors', async () => {
  let ready = false;
  const selected = { ...adapter(), detect() { return ready; } };
  const r = runtime({ entries: [{ ...adapter('broken'), detect() { throw new Error('not ready'); } }, selected] });
  await r.loadAdapters(); r.attach();
  assert.equal(r.chosen.length, 0);
  r.advance(100); ready = true; r.advance(100);
  assert.equal(r.chosen[0], selected);
  const fallback = runtime({ entries: [adapter('other', false)] });
  await fallback.loadAdapters(); fallback.attach();
  fallback.advance(2000);
  assert.equal(fallback.chosen[0], fallback.generic);
});

test('manifest queries accept only the bounded query character set', async () => {
  const load = shell.slice(shell.indexOf('  function cleanVersion('), shell.indexOf('  async function openVersion('));
  for (const value of [undefined, null, 42, '', 'shell=1&view=wide-mode.v2', 'bad?query', 'a=#route', 'a=hello world', 'a=%20']) {
    const context = vm.createContext({
      S: {}, document: {}, location: { hash: '' }, showStage() {}, openVersion() {},
      str: (value, max) => typeof value === 'string' ? value.slice(0, max) : '',
      sget: () => null, latest: () => null,
      fetch: async () => ({ ok: true, json: async () => ({ narrowQuery: value, wideQuery: value, versions: [{ n: 1, file: 'proto-v1.html' }] }) })
    });
    await vm.runInContext(load + '\nloadManifest();', context);
    const expected = typeof value === 'string' && /^[\w=&.-]*$/.test(value) ? value : '';
    assert.equal(context.S.manifest.narrowQuery, expected);
    assert.equal(context.S.manifest.wideQuery, expected);
  }
});
