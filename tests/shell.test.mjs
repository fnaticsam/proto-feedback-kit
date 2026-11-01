import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const shell = await readFile(path.resolve(import.meta.dirname, '../kit/index.html'), 'utf8');

test('the shell is a complete document that works when a host serves it as is', () => {
  assert.match(shell, /^<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" /);
  assert.ok(shell.includes('[hidden]{display:none!important}'), 'hidden elements need their own rule: class display rules beat the hidden attribute');
});

// Exercise the built-in adapter in isolation without a browser or runtime capabilities.
const generic = new Function('str', 'S', 'rootScroller',
  'return (' + shell.match(/const generic = (\{[\s\S]*?\n  \});\n  const ADAPTERS/)[1] + ')'
)((v, max) => typeof v === 'string' ? v.slice(0, max) : '', {}, () => null);

test('generic screens are optional, support a function, and navigate only by hash', () => {
  const w = { location: { hash: '#/home' } };
  assert.equal(generic.screens(w), null);
  assert.equal(generic.side(w), 'web');
  const groups = [{ name: 'Explore', items: [{ id: '/list', title: 'List', hash: '#/list' }] }];
  w.kitScreens = groups;
  assert.deepEqual(generic.screens(w), [{ name: 'Explore', items: [{ ...groups[0].items[0], job: '' }] }]);
  w.kitScreens = () => groups;
  assert.equal(generic.screens(w)[0].items[0].hash, '#/list');
  generic.go(w, generic.screens(w)[0].items[0]);
  assert.equal(w.location.hash, '#/list');
  w.kitSide = 'phone';
  assert.equal(generic.side(w), 'phone');
  w.kitSide = 'invalid';
  assert.equal(generic.side(w), 'web');
});

test('generic screens drop malformed groups and items and bound all strings', () => {
  const item = { id: 'a'.repeat(200), title: 'b'.repeat(100), hash: '#' + 'c'.repeat(600), job: 'd'.repeat(400) };
  const groups = generic.screens({ kitScreens: [null, [], {}, { name: 'Bad', items: {} },
    { name: 'Empty', items: [null, {}, { id: 'x', title: 'X', hash: 'https://example.invalid/' }] },
    { name: 'n'.repeat(70), items: [item, { id: '', title: 'Missing id', hash: '#bad' },
      { id: 'x', title: 42, hash: '#x' }, { id: 'x', title: 'X', hash: 42 }] }
  ] });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name.length, 60);
  assert.equal(groups[0].items.length, 1);
  const valid = groups[0].items[0];
  assert.deepEqual(Object.values(valid).map(s => s.length), [120, 80, 500, 300]);
  assert.equal(generic.screens({ kitScreens: { name: 'Invalid' } }), null);
  assert.equal(generic.screens({ kitScreens: [{ name: 'Empty', items: [] }] }), null);
});

test('the complete inline shell script parses', async () => {
  const { Script } = await import('node:vm');
  assert.doesNotThrow(() => new Script(shell.match(/<script>\n([\s\S]*)<\/script>/)[1]));
});
