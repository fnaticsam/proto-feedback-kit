import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const fixture = path.join(root, 'dev/fixtures/mini');

async function bundle(extra = []) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bundle-test-'));
  const src = path.join(dir, 'mini');
  const out = path.join(dir, 'out.html');
  await cp(fixture, src, { recursive: true });
  const result = await exec(process.execPath, [path.join(root, 'tools/bundle.mjs'), '--src', src, '--out', out, '--version', '7', ...extra], { cwd: root });
  return { src, out, html: await readFile(out, 'utf8'), ...result };
}

test('bundles local assets, embeds lazy screens, and makes a standalone document', async () => {
  const result = await bundle(['--embed-glob', 'screens/*.js']);
  const html = result.html;
  assert.match(html, /^<!doctype html><html><head><meta charset="utf-8">/i);
  assert.match(html, /name="kit:version" content="7"/);
  assert.match(html, /:root\{color-scheme:light/);
  assert.match(html, /url\(img\/x\.png\)/);
  assert.match(html, /\(window\.__kitClaude\|\|window\.claude\)\.use/);
  assert.match(html, /<\\\/script>/);
  assert.doesNotMatch(html, /onload=|onerror=|src="app\/a\.js"/);
  assert.ok(html.indexOf("concat('app')") < html.indexOf("concat('manifest')"));
  const map = /window\.__kitFiles=(\{.*?\});\(function kitLoader/s.exec(html)[1];
  assert.match(map, /^[ -~]*$/, 'embedded map is pure ASCII');
  const files = JSON.parse(map);
  assert.deepEqual(Object.keys(files), ['screens/one.js', 'screens/two.js']);
  assert.equal(files['screens/one.js'], await readFile(path.join(fixture, 'screens/one.js'), 'utf8'));
  assert.equal(html.split("concat('one')").length, 2, 'screen code appears only in the embedded map');
  assert.match(result.stderr, /warning: missing script app\/missing\.js/);
  assert.match(result.stdout, /scripts inlined=2 styles inlined=1 screens embedded=2 rewrites=1 warnings=1/);
});

test('rejects options it does not know', async () => {
  await assert.rejects(bundle(['--inline-glob', 'screens/*.js']), error => /usage:/.test(error.stderr));
});

test('fails rather than changing a window.claude assignment', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bundle-assignment-'));
  const src = path.join(dir, 'mini');
  await cp(fixture, src, { recursive: true });
  await writeFile(path.join(src, 'app/a.js'), 'window.claude = {}');
  await assert.rejects(
    exec(process.execPath, [path.join(root, 'tools/bundle.mjs'), '--src', src, '--out', path.join(dir, 'out.html'), '--version', '1']),
    error => /assignment to window\.claude/.test(error.stderr),
  );
});
