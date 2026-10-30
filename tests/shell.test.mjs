import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const shell = await readFile(path.resolve(import.meta.dirname, '../kit/index.html'), 'utf8');

test('the shell is a complete document that works when a host serves it as is', () => {
  assert.match(shell, /^<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" /);
  assert.ok(shell.includes('[hidden]{display:none!important}'), 'hidden elements need their own rule: class display rules beat the hidden attribute');
});
