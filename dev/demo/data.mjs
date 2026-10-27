import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from '../harness/serve.mjs';
import { screenshotConfig } from '../harness/data.mjs';

// The current seed is the newer state, so its records replace v1 records with the same id.
function merge(older, newer) {
  const records = new Map();
  for (const list of [older, newer]) {
    const ids = new Set();
    for (const record of list) {
      if (!record.id || ids.has(record.id)) throw new Error('Missing or duplicate seed id: ' + record.id);
      if (!['riley', 'jordan'].includes(record.author)) throw new Error('Unknown dummy reviewer: ' + record.author);
      ids.add(record.id);
      records.set(record.id, record);
    }
  }
  return structuredClone([...records.values()]);
}

// Build a fresh seed without changing the exported feedback or its original version.
export function buildSeed(feedback, current, manifest) {
  const fixed = new Map();
  for (const version of [...manifest.versions].sort((a, b) => a.n - b.n)) {
    for (const id of version.fixed || []) if (!fixed.has(id)) fixed.set(id, version.n);
  }
  const comments = merge(feedback.comments, current.comments).map(comment => {
    const resolvedIn = fixed.get(comment.id);
    return resolvedIn === undefined ? comment : Object.assign(comment, { status: 'done', resolvedIn });
  });
  const replies = merge(feedback.replies, current.replies);
  for (const id of fixed.keys()) {
    if (!comments.some(comment => comment.id === id)) throw new Error('Fixed comment is missing from seed: ' + id);
  }
  for (const reply of replies) {
    if (!comments.some(comment => comment.id === reply.commentId)) throw new Error('Reply has no parent: ' + reply.id);
  }
  return { comments, replies };
}

export async function loadDemo() {
  const directory = path.join(root, 'examples/sprout');
  async function json(file) {
    try { return JSON.parse(await readFile(path.join(directory, file), 'utf8')); }
    catch (error) { throw new Error(`Cannot load Sprout ${file}: ${error.message}`, { cause: error }); }
  }
  const [manifest, feedback, current] = await Promise.all([
    json('versions.json'), json('feedback/v1.json'), json('seed/v2-comments.json')
  ]);
  const seed = buildSeed(feedback, current, manifest);
  return { manifest, config: { ...screenshotConfig, seed } };
}

export function shotTargets(seed) {
  const open = seed.comments.filter(comment => comment.status === 'open');
  const thread = open.find(comment => seed.replies.some(reply => reply.commentId === comment.id));
  if (!thread) throw new Error('Panel capture needs an open comment with a reply');
  const counts = new Map();
  for (const comment of open.filter(comment => comment.pin)) {
    counts.set(comment.screen, (counts.get(comment.screen) || 0) + 1);
  }
  const [pinsScreen, count] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
  if (!(count >= 2)) throw new Error('Pins capture needs a screen with several pinned open comments');
  return { thread, pinsScreen };
}
