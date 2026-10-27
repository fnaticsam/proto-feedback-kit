#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { root } from './serve.mjs';

export const fixture = path.join(root, 'out/shell');
export const versions = {
  title: 'Feedback prototype', adapter: 'generic', narrowQuery: 'frame=0',
  versions: [
    { n: 1, file: 'proto-v1.html', date: '2026-10-25', title: 'First idea', notes: ['The first round of the prototype.'], fixed: [] },
    { n: 2, file: 'proto-v2.html', date: '2026-10-26', title: 'A fresh direction', notes: ['A greener welcome.', 'Clearer detail navigation.'], fixed: ['fixed-home'] }
  ]
};
export async function buildFixture() {
  await mkdir(fixture, { recursive: true });
  for (const version of versions.versions) {
    await promisify(execFile)(process.execPath, [path.join(root, 'tools/bundle.mjs'), '--src', path.join(root, 'dev/fixtures/proto'),
      '--out', path.join(fixture, version.file), '--version', String(version.n)]);
  }
  await writeFile(path.join(fixture, 'versions.json'), JSON.stringify(versions, null, 2) + '\n');
  return fixture;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(await buildFixture());
}
