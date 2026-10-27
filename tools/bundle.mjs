#!/usr/bin/env node
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const usage = 'usage: node tools/bundle.mjs --src <dir> --out <file> --version <n> [--embed-glob <glob>]';

function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--') || argv[i + 1] === undefined) throw new Error(usage);
    result[key.slice(2)] = argv[i + 1];
  }
  const known = ['src', 'out', 'version', 'embed-glob'];
  if (!result.src || !result.out || !result.version || Object.keys(result).some(key => !known.includes(key))) throw new Error(usage);
  return result;
}

// Runs in the bundled page. Scripts the prototype adds at run time (appendChild/insertBefore of a
// <script src>, or document.write of one) are served from the embedded files instead of the network,
// so lazy loaders keep their own timing. Serialized with toString(): keep it ES5 and free of "</script".
function kitLoader(files) {
  var base = new URL('.', document.baseURI).href;
  function key(src) {
    try {
      var href = new URL(src, document.baseURI).href.split(/[?#]/)[0];
      var k = href.indexOf(base) === 0 ? decodeURIComponent(href.slice(base.length)) : null;
      return k && Object.prototype.hasOwnProperty.call(files, k) ? k : null;
    } catch (e) { return null; }
  }
  function serve(node) {
    if (!node || node.nodeName !== 'SCRIPT' || node.__kitServed || !node.hasAttribute('src')) return false;
    var k = key(node.getAttribute('src'));
    if (!k) return false;
    node.__kitServed = true;
    node.removeAttribute('src');
    node.text = files[k] + '\n//# sourceURL=' + k;
    return true;
  }
  ['appendChild', 'insertBefore'].forEach(function (name) {
    var original = Node.prototype[name];
    Node.prototype[name] = function (node) {
      var served = this.isConnected && serve(node);
      var result = original.apply(this, arguments);
      if (served) setTimeout(function () { node.dispatchEvent(new Event('load')); }, 0);
      return result;
    };
  });
  var write = document.write;
  document.write = function () {
    var html = Array.prototype.join.call(arguments, '').replace(/<script\b([^>]*?)\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>\s*<\/script\s*>/gi, function (tag, before, a, b, c, after) {
      var k = key(a || b || c);
      return k ? '<script' + before + after + '>' + files[k].replace(/<\/(script)/gi, '<\\/$1') + '\n//# sourceURL=' + k + '<\/script>' : tag;
    });
    return write.call(document, html);
  };
}

function attr(attrs, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return match && (match[1] ?? match[2] ?? match[3]);
}

function local(value) {
  return value && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
}

function cleanScriptAttrs(attrs) {
  return attrs.replace(/\s+on(?:error|load)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

function rewrite(source, state, label) {
  if (/\bwindow\s*\.\s*claude\s*=(?!=)/.test(source)) throw new Error(`hard error: assignment to window.claude in ${label}`);
  const matches = source.match(/\bwindow\s*\.\s*claude\b/g) || [];
  state.rewrites += matches.length;
  if (/(^|[^.\w$])claude\s*\.\s*use\s*\(/m.test(source)) state.warnings.push(`bare claude.use in ${label}`);
  return source.replace(/\bwindow\s*\.\s*claude\b/g, '(window.__kitClaude||window.claude)');
}

function rebaseCss(css, stylesheet) {
  return css.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (all, quote, value) => {
    const trimmed = value.trim();
    if (!local(trimmed)) return all;
    const rootPath = path.posix.normalize(path.posix.join(path.posix.dirname(stylesheet), trimmed));
    return `url(${quote}${rootPath.replace(/^\.\//, '')}${quote})`;
  });
}

async function filesUnder(dir) {
  const found = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) found.push(full);
    }
  }
  await visit(dir);
  return found;
}

function globMatcher(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

async function main() {
  const opt = args(process.argv.slice(2));
  const src = path.resolve(opt.src);
  const out = path.resolve(opt.out);
  const state = { scripts: 0, styles: 0, screens: 0, rewrites: 0, warnings: [] };
  let html = await readFile(path.join(src, 'index.html'), 'utf8');

  html = await replaceAsync(html, /<link\b([^>]*)>/gi, async (tag, attrs) => {
    const href = attr(attrs, 'href');
    if (!/\bstylesheet\b/i.test(attr(attrs, 'rel') || '') || !local(href)) return tag;
    const relative = href.split(/[?#]/)[0];
    try {
      const css = await readFile(path.join(src, relative), 'utf8');
      state.styles += 1;
      return `<style>\n${rebaseCss(css, relative).replace(/<\/style/gi, '<\\/style')}\n</style>`;
    } catch (error) {
      state.warnings.push(`missing stylesheet ${href}`);
      return tag;
    }
  });

  const inlined = new Set();
  html = await replaceAsync(html, /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, async (tag, attrs, contents) => {
    const scriptSrc = attr(attrs, 'src');
    if (local(scriptSrc)) {
      const relative = path.posix.normalize(scriptSrc.split(/[?#]/)[0]);
      try {
        const code = rewrite(await readFile(path.join(src, relative), 'utf8'), state, relative).replace(/<\/script/gi, '<\\/script');
        state.scripts += 1;
        inlined.add(relative);
        return `<script${cleanScriptAttrs(attrs.replace(/\s+src\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, ''))}>\n${code}\n</script>`;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        state.warnings.push(`missing script ${relative}`);
        return '';
      }
    }
    return `<script${attrs}>${rewrite(contents, state, 'inline script')}</script>`;
  });

  // Embedded files are not run here: the page's own loader asks for them when the app is ready.
  const embedded = {};
  if (opt['embed-glob']) {
    const matcher = globMatcher(opt['embed-glob']);
    for (const full of (await filesUnder(src)).sort()) {
      const relative = path.relative(src, full).split(path.sep).join('/');
      if (!matcher.test(relative) || inlined.has(relative)) continue;
      embedded[relative] = rewrite(await readFile(full, 'utf8'), state, relative);
      state.screens += 1;
    }
    if (!state.screens) state.warnings.push(`--embed-glob matched no files: ${opt['embed-glob']}`);
  }

  let prelude = '<script>try{var p=window.parent!==window&&window.parent.claude;if(p)window.__kitClaude=p}catch(e){}</script>';
  // The map is kept pure ASCII so it reads the same whatever charset the page ends up decoded with.
  const map = JSON.stringify(embedded).replace(/[^ -~]|</g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  if (state.screens) prelude += `<script>window.__kitFiles=${map};(${kitLoader})(window.__kitFiles)</script>`;
  const meta = `<meta name="kit:version" content="${escapeHtml(opt.version)}">`;
  const basics = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';
  if (/<html\b/i.test(html)) {
    // charset must sit in the first 1024 bytes, ahead of the embedded files.
    if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, match => `${match}${basics}${prelude}${meta}`);
    else html = html.replace(/<html\b[^>]*>/i, match => `${match}<head>${basics}${prelude}${meta}</head>`);
    html = html.replace(/^\s*(?:<!doctype[^>]*>\s*)?/i, '<!doctype html>');
  } else {
    const reset = ':root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px/1.4 system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}';
    html = `<!doctype html><html><head>${basics}${prelude}${meta}<style>${reset}</style></head><body>${html}</body></html>`;
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, html);
  const bytes = (await stat(out)).size;
  const summary = `bundle: scripts inlined=${state.scripts} styles inlined=${state.styles} screens embedded=${state.screens} rewrites=${state.rewrites} warnings=${state.warnings.length} output bytes=${bytes}`;
  console.log(summary);
  for (const warning of state.warnings) console.warn(`warning: ${warning}`);
}

async function replaceAsync(text, regex, fn) {
  const matches = [...text.matchAll(regex)];
  let offset = 0;
  let result = '';
  for (const match of matches) {
    result += text.slice(offset, match.index) + await fn(...match);
    offset = match.index + match[0].length;
  }
  return result + text.slice(offset);
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

main().catch(error => { console.error(error.message); process.exitCode = 1; });
