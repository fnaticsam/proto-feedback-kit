#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer } from '../harness/serve.mjs';
import { buildDemo } from './build.mjs';
import { loadDemo } from './data.mjs';

export async function startDemo({ port = 0 } = {}) {
  const { manifest, config } = await loadDemo();
  const fixture = await buildDemo(manifest);
  let running;
  try { running = await startServer({ fixture, config, port }); }
  catch (error) { await rm(fixture, { recursive: true, force: true }); throw error; }
  async function close() {
    try { await running.close(); } finally { await rm(fixture, { recursive: true, force: true }); }
  }
  return { ...running, close, manifest, config };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const running = await startDemo({ port: Number(process.env.PORT ?? 4174) });
  console.log(`Sprout demo: ${running.url}/#v2 — state lives in page memory; reloading resets feedback.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    running.close().catch(error => { console.error(error); process.exitCode = 1; });
  });
}
