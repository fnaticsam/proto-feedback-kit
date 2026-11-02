import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'tools/build-site.mjs');

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'build-site-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const protos = path.join(dir, 'protos');
  const out = path.join(dir, 'site');
  const versions = path.join(dir, 'versions.json');
  const remote = path.join(dir, 'remote.json');
  await mkdir(protos);
  const manifest = { title: 'Sprout', adapter: 'generic', versions: [{ n: 1, file: 'proto-v1.html' }, { n: 2, file: 'proto-v2.html' }] };
  await writeFile(versions, JSON.stringify(manifest));
  await writeFile(remote, JSON.stringify({ supabaseUrl: 'https://example.invalid', anonKey: 'fictional-public-anon-key', project: 'sprout' }));
  await writeFile(path.join(protos, 'proto-v1.html'), '<!doctype html><title>Sprout v1</title>');
  await writeFile(path.join(protos, 'proto-v2.html'), '<!doctype html><title>Sprout v2</title>');
  return { dir, protos, out, versions, remote, manifest, build: extra => exec(process.execPath, [script, '--out', out, '--versions', versions, '--protos', protos, ...(extra || [])]) };
}

test('builds one complete document and copies only referenced local files and public configuration', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.protos, 'proto-v3.html'), 'not published');
  const result = await f.build(['--remote', f.remote, '--title', 'Sprout <review> & "notes"']);
  assert.match(result.stdout, /wrote 6 files/);
  assert.deepEqual((await readdir(f.out)).sort(), ['index.html', 'proto-v1.html', 'proto-v2.html', 'remote.json', 'vercel.json', 'versions.json']);
  const html = await readFile(path.join(f.out, 'index.html'), 'utf8');
  assert.match(html, /^<!doctype html><html lang="en"><head><meta charset="utf-8">/);
  assert.equal((html.match(/<!doctype html>/gi) || []).length, 1);
  assert.equal((html.match(/<html\b/gi) || []).length, 1);
  assert.equal((html.match(/<head>/g) || []).length, 1);
  assert.equal((html.match(/<body>/g) || []).length, 1);
  assert.match(html, /<title>Sprout &lt;review&gt; &amp; &quot;notes&quot;<\/title>/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /<\/head><body>\s*<nav/);
  assert.match(html, /<\/body><\/html>\n$/);
  assert.match(html, /data-kit="frame"/);
  for (const file of ['versions.json', 'remote.json']) assert.equal(await readFile(path.join(f.out, file), 'utf8'), await readFile(f[file === 'versions.json' ? 'versions' : 'remote'], 'utf8'));
  assert.equal(await readFile(path.join(f.out, 'proto-v2.html'), 'utf8'), '<!doctype html><title>Sprout v2</title>');
  const { headers } = JSON.parse(await readFile(path.join(f.out, 'vercel.json'), 'utf8'));
  assert.deepEqual(headers[0], { source: '/(.*)', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Referrer-Policy', value: 'no-referrer' }] });
  for (const source of ['/', '/index.html', '/versions.json', '/remote.json']) assert.deepEqual(headers.find(rule => rule.source === source)?.headers, [{ key: 'Cache-Control', value: 'no-cache' }]);
});

test('supports local-only builds, a manifest title and custom adapters', async t => {
  const f = await fixture(t);
  f.manifest.adapter = 'sprout';
  await writeFile(f.versions, JSON.stringify(f.manifest));
  await assert.rejects(f.build(), error => /requires adapters.js/.test(error.stderr));
  await writeFile(path.join(f.protos, 'adapters.js'), 'window.kitAdapters=[];');
  await f.build();
  assert.equal(await readFile(path.join(f.out, 'adapters.js'), 'utf8'), 'window.kitAdapters=[];');
  assert.match(await readFile(path.join(f.out, 'index.html'), 'utf8'), /<title>Sprout<\/title>/);
  assert.ok(!(await readdir(f.out)).includes('remote.json'));
});

test('refuses a local-only rebuild over existing remote configuration without changing output', async t => {
  const f = await fixture(t);
  await f.build(['--remote', f.remote]);
  const originalIndex = await readFile(path.join(f.out, 'index.html'), 'utf8');
  const originalRemote = await readFile(path.join(f.out, 'remote.json'), 'utf8');
  await assert.rejects(f.build(['--title', 'Changed title']), error => /Output already contains remote.json.*fresh --out directory.*--remote explicitly/.test(error.stderr));
  assert.equal(await readFile(path.join(f.out, 'index.html'), 'utf8'), originalIndex);
  assert.equal(await readFile(path.join(f.out, 'remote.json'), 'utf8'), originalRemote);
  await f.build(['--remote', f.remote, '--title', 'Changed title']);
  assert.match(await readFile(path.join(f.out, 'index.html'), 'utf8'), /<title>Changed title<\/title>/);
});

test('rejects missing, duplicate and unknown CLI arguments', async t => {
  const f = await fixture(t);
  for (const extra of [['--unknown', 'x'], ['--title'], ['--out', f.out]]) await assert.rejects(f.build(extra), error => /usage:/.test(error.stderr));
});

test('rejects malformed manifests, traversal, remote files and missing prototypes before writing', async t => {
  const f = await fixture(t);
  for (const versions of [[], [{ n: 1, file: '../proto-v1.html' }], [{ n: 1, file: 'https://example.invalid/proto-v1.html' }], [{ n: 1, file: 'proto-v1.html' }, { n: 1, file: 'proto-v2.html' }], [{ n: 3, file: 'proto-v3.html' }]]) {
    await writeFile(f.versions, JSON.stringify({ versions }));
    await assert.rejects(f.build());
  }
  await assert.rejects(readdir(f.out), { code: 'ENOENT' });
});

test('rejects prototype symlinks escaping the source directory', async t => {
  const f = await fixture(t);
  await rm(path.join(f.protos, 'proto-v1.html'));
  await symlink(f.versions, path.join(f.protos, 'proto-v1.html'));
  await assert.rejects(f.build(), error => /must be inside/.test(error.stderr));
});

test('rejects non-public configuration fields and invalid remote endpoints or project slugs', async t => {
  const f = await fixture(t);
  const valid = { supabaseUrl: 'https://example.invalid', anonKey: 'fictional-public-anon-key', project: 'sprout' };
  for (const config of [{ ...valid, ownerKey: 'not-public' }, { ...valid, supabaseUrl: 'file:///tmp/example' }, { ...valid, supabaseUrl: 'https://user:password@example.invalid' }, { ...valid, supabaseUrl: 'https://example.invalid?key=hidden' }, { ...valid, project: '../bad' }, { ...valid, anonKey: '' }]) {
    await writeFile(f.remote, JSON.stringify(config));
    await assert.rejects(f.build(['--remote', f.remote]));
  }
  await assert.rejects(readdir(f.out), { code: 'ENOENT' });
});
