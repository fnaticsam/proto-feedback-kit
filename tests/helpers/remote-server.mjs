import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

export const remoteProject = 'sprout-review';
export const ownerKey = 'fictional-owner-key-for-browser-tests';
export const anonKey = 'fictional-public-anon-key';
const guarded = ['status', 'resolvedIn', 'resolvedAt', 'resolvedBy', 'approved', 'approvedAt', 'by'];
const hash = value => createHash('sha256').update(value).digest('hex');
const isOwnerAuthor = author => author === 'owner' || author.startsWith('owner:');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

// This fake follows backend/supabase/schema.sql, including immutable authors and
// owner fields. It deliberately does not trust identity fields sent by the shell.
export function createRpcBackend({ project = remoteProject, key = ownerKey, ownerKeys = {}, maxDocs = 5000 } = {}) {
  const docs = new Map(), names = {}, writes = [];
  // Each backend represents one project; mutate this map to provision or revoke a key.
  ownerKeys = new Map(ownerKeys instanceof Map ? ownerKeys : Object.entries(ownerKeys));
  const identity = args => {
    if (args.p_project !== project) fail(404, 'not_found');
    if (args.p_owner_key) {
      if (key && hash(args.p_owner_key) === hash(key)) return { author: 'owner', isOwner: true };
      for (const [id, extraKey] of ownerKeys) {
        if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(id)) throw Error('invalid owner id');
        if (hash(args.p_owner_key) === hash(extraKey)) return { author: 'owner:' + id, isOwner: true };
      }
    }
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(args.p_secret || '')) fail(400, 'invalid_argument');
    return { author: 'a_' + hash(args.p_secret).slice(0, 20), isOwner: false };
  };
  const rate = (author, ip) => {
    const now = Date.now(), minute = writes.filter(w => w.at > now - 60_000);
    if (isOwnerAuthor(author)) {
      if (minute.filter(w => w.author === author).length >= 60) fail(429, 'rate_limited');
    } else if (minute.filter(w => w.author === author).length >= 20 ||
        (ip && minute.filter(w => w.ip === ip && !isOwnerAuthor(w.author)).length >= 60) ||
        writes.filter(w => w.at > now - 86_400_000 && !isOwnerAuthor(w.author)).length >= 3000) {
      fail(429, 'rate_limited');
    }
    return () => writes.push({ at: now, author, ip });
  };
  const validCollection = value => ['comments', 'replies'].includes(value);
  return { docs, names, writes, ownerKeys, call(fn, args, ip = '127.0.0.1') {
    if (fn === 'pf_list') return {
      docs: args.p_project === project ? [...docs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [],
      names: args.p_project === project ? { ...names } : {}, serverTime: new Date().toISOString()
    };
    const who = identity(args);
    if (fn === 'pf_whoami') return who;
    if (fn === 'pf_set_name') {
      const name = String(args.p_name ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, 60);
      if (!name) fail(400, 'invalid_argument');
      const record = rate(who.author, ip);
      names[who.author] = name; record();
      return { author: who.author, name };
    }
    if (!validCollection(args.p_collection)) fail(400, 'invalid_argument');
    const docKey = args.p_collection + ':' + args.p_id, old = docs.get(docKey);
    if (fn === 'pf_delete') {
      if (!old) return null;
      if (!who.isOwner && old.author !== who.author) fail(403, 'not_granted');
      const record = rate(who.author, ip);
      docs.delete(docKey);
      if (args.p_collection === 'comments') for (const [id, doc] of docs) {
        if (doc.collection === 'replies' && doc.data.commentId === args.p_id) docs.delete(id);
      }
      record(); return null;
    }
    if (fn !== 'pf_write') fail(404, 'not_found');
    const data = args.p_data;
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(args.p_id || '') || !data || typeof data !== 'object' ||
        Array.isArray(data) || Buffer.byteLength(JSON.stringify(data)) > 8000 || String(data.text ?? '').length > 4000) {
      fail(400, 'invalid_argument');
    }
    const record = rate(who.author, ip);
    if (old && !who.isOwner && old.author !== who.author) fail(403, 'not_granted');
    if (!old && docs.size >= maxDocs) fail(429, 'quota_exceeded');
    const next = args.p_merge && old ? { ...old.data, ...data } : { ...data };
    if (!who.isOwner) {
      for (const field of guarded) {
        delete next[field];
        if (old && Object.hasOwn(old.data, field)) next[field] = old.data[field];
      }
      if (!old && args.p_collection === 'comments') Object.assign(next, { status: 'open', resolvedIn: null });
    }
    next.author = old?.author ?? who.author;
    next.byOwner = old?.byOwner ?? who.isOwner;
    if (Buffer.byteLength(JSON.stringify(next)) > 9000) fail(400, 'invalid_argument');
    const now = new Date().toISOString();
    const doc = { collection: args.p_collection, id: args.p_id, author: next.author,
      byOwner: next.byOwner, data: next, createdAt: old?.createdAt ?? now, updatedAt: now };
    docs.set(docKey, doc); record();
    return structuredClone(doc);
  } };
}

export async function startRemoteServer({ directory, ...options }) {
  const backend = createRpcBackend(options), requests = [];
  const base = await realpath(directory);
  const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript' };
  const server = http.createServer(async (request, response) => {
    const send = (status, body = '', type = 'application/json') => {
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.startsWith('/rest/v1/rpc/')) {
        if (request.method !== 'POST') { send(405); return; }
        if (request.headers.apikey !== anonKey || request.headers.authorization !== 'Bearer ' + anonKey) {
          send(403, JSON.stringify({ code: 'PT403', message: 'not_granted' })); return;
        }
        let body = '';
        for await (const chunk of request) body += chunk;
        const args = JSON.parse(body), fn = pathname.slice('/rest/v1/rpc/'.length);
        requests.push({ fn, args: structuredClone(args) });
        send(200, JSON.stringify(backend.call(fn, args))); return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) { send(405); return; }
      if (pathname === '/favicon.ico') { send(204); return; }
      const file = await realpath(path.resolve(base, pathname === '/' ? 'index.html' : '.' + pathname));
      if (!file.startsWith(base + path.sep)) { send(403); return; }
      if (!(await stat(file)).isFile()) { send(404); return; }
      send(200, await readFile(file), types[path.extname(file)] || 'application/octet-stream');
    } catch (error) {
      const status = error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 400);
      send(status, JSON.stringify({ code: 'PT' + status, message: error.message }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { backend, requests, url: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
