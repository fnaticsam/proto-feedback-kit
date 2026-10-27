import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { root } from '../harness/serve.mjs';

// Each run gets its own folder so a running demo and a screenshot pass never share files.
export async function buildDemo(manifest) {
  await mkdir(path.join(root, 'out'), { recursive: true });
  const fixture = await mkdtemp(path.join(root, 'out/demo-'));
  for (const n of [1, 2]) {
    const version = manifest.versions.find(version => version.n === n);
    if (!version || !/^[\w.-]+\.html$/.test(version.file)) throw new Error(`Missing or invalid Sprout v${n} file`);
    await promisify(execFile)(process.execPath, [path.join(root, 'tools/bundle.mjs'),
      '--src', path.join(root, 'examples/sprout', 'v' + n),
      '--out', path.join(fixture, version.file), '--version', String(n)]);
  }
  await writeFile(path.join(fixture, 'versions.json'), JSON.stringify(manifest, null, 2) + '\n');
  // The generic adapter needs no registrations; avoid an optional-script 404 in captures.
  await writeFile(path.join(fixture, 'adapters.js'), '// Uses the built-in generic adapter.\n');
  return fixture;
}
