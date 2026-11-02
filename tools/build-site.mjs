#!/usr/bin/env node
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

const usage = 'usage: node tools/build-site.mjs --out <dir> --versions <versions.json> --protos <dir> [--remote <remote.json>] [--title "<name>"]';
const root = path.resolve(import.meta.dirname, '..');

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2);
    if (!argv[i]?.startsWith('--') || !['out', 'versions', 'protos', 'remote', 'title'].includes(key) || argv[i + 1] === undefined || key in result) throw new Error(usage);
    result[key] = argv[i + 1];
  }
  if (!result.out || !result.versions || !result.protos) throw new Error(usage);
  return result;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// The kit is already a document with an implicit head/body. Preserve its head
// resources while giving static hosts one explicit, complete document.
function documentHtml(shell, title) {
  let source = shell.replace(/^\s*<!doctype[^>]*>\s*/i, '').replace(/^\s*<html\b[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
  let head, body;
  if (/<head\b/i.test(source)) {
    const match = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(source);
    if (!match) throw new Error('The kit head is incomplete.');
    head = match[1];
    body = source.slice(match.index + match[0].length);
  } else {
    const end = source.indexOf('</style>');
    if (end < 0) throw new Error('The kit stylesheet is missing.');
    head = source.slice(0, end + '</style>'.length);
    body = source.slice(end + '</style>'.length);
  }
  head = head.replace(/<meta\b[^>]*charset[^>]*>/gi, '').replace(/<meta\b[^>]*name=["']viewport["'][^>]*>/gi, '').replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '');
  body = body.replace(/^\s*<body\b[^>]*>/i, '').replace(/<\/body>\s*$/i, '');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>' + escapeHtml(title) + '</title>' + head + '</head><body>' + body + '</body></html>\n';
}

async function safeRead(directory, filename) {
  const base = await realpath(directory);
  const file = await realpath(path.join(base, filename));
  if (path.dirname(file) !== base) throw new Error(`File must be inside --protos: ${filename}`);
  return readFile(file);
}

function remoteConfig(raw) {
  const config = JSON.parse(raw);
  if (!config || Array.isArray(config) || Object.keys(config).sort().join(',') !== 'anonKey,project,supabaseUrl' || typeof config.anonKey !== 'string' || !config.anonKey.trim() || typeof config.project !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(config.project)) throw new Error('remote.json requires only supabaseUrl, anonKey and a project slug.');
  let url;
  try { url = new URL(config.supabaseUrl); } catch { throw new Error('remote.json supabaseUrl must be an HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('remote.json supabaseUrl must be an HTTP(S) origin without credentials.');
  return config;
}

async function main() {
  const opt = options(process.argv.slice(2));
  if (!opt.remote) {
    let existingRemote = false;
    try { await lstat(path.join(opt.out, 'remote.json')); existingRemote = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existingRemote) throw new Error('Output already contains remote.json. Choose a fresh --out directory or provide --remote explicitly. No files were changed.');
  }
  const manifestRaw = await readFile(opt.versions, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  if (!manifest || !Array.isArray(manifest.versions) || !manifest.versions.length) throw new Error('versions.json must contain a nonempty versions array.');
  const numbers = new Set();
  const files = new Map();
  for (const version of manifest.versions) {
    if (!version || !Number.isInteger(version.n) || version.n <= 0 || numbers.has(version.n) || typeof version.file !== 'string' || !/^proto-v[1-9]\d*\.html$/.test(version.file)) throw new Error('Each version needs a unique positive integer n and a local proto-vN.html file.');
    numbers.add(version.n);
    files.set(version.file, await safeRead(opt.protos, version.file));
  }
  try { files.set('adapters.js', await safeRead(opt.protos, 'adapters.js')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (manifest.adapter && manifest.adapter !== 'generic') throw new Error('A custom manifest adapter requires adapters.js in --protos.');
  }
  if (opt.remote) {
    const raw = await readFile(opt.remote, 'utf8');
    remoteConfig(raw);
    files.set('remote.json', raw);
  }
  const shell = await readFile(path.join(root, 'kit/index.html'), 'utf8');
  files.set('index.html', documentHtml(shell, opt.title ?? manifest.title ?? 'Prototype'));
  files.set('versions.json', manifestRaw);
  files.set('vercel.json', JSON.stringify({ headers: [
    { source: '/(.*)', headers: [
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'Referrer-Policy', value: 'no-referrer' }
    ] },
    ...['/', '/index.html', '/versions.json', '/remote.json'].map(source => ({ source, headers: [{ key: 'Cache-Control', value: 'no-cache' }] }))
  ] }, null, 2) + '\n');
  await mkdir(opt.out, { recursive: true });
  for (const [filename, content] of files) await writeFile(path.join(opt.out, filename), content);
  console.log(`build-site: wrote ${files.size} files`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
