import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const shell = await readFile(new URL('../kit/index.html', import.meta.url), 'utf8');
const between = (start, end) => shell.slice(shell.indexOf(start), shell.indexOf(end));
const panelCode = between('  function setPanel(', "  narrowMq.addEventListener('change', syncSheet);");
const badgeCode = between('  function openCount(', '  function renderBar(') + between('  function renderPeek()', '  function renderComposer(');

function runtime({ narrow = false, search = '', preference = null, blockedStorage = false } = {}) {
  const storage = new Map(preference === null ? [] : [['kit:panel', preference]]), nodes = {}, classes = new Set();
  let focused = null;
  const node = name => nodes[name] ||= { name, hidden: false, textContent: '', attrs: {},
    focus() { focused = name; }, setAttribute(key, value) { this.attrs[key] = value; },
    insertBefore(child) { child.parentElement = this; } };
  const S = { panel: false, sheet: false, menu: false, placing: false, rail: { side: 'web' }, feed: 'ready', comments: [], screen: { id: '/home' } };
  const context = vm.createContext({ S, URLSearchParams, location: { search }, window: { localStorage: {
    getItem(key) { if (blockedStorage) throw Error('blocked'); return storage.get(key) ?? null; },
    setItem(key, value) { if (blockedStorage) throw Error('blocked'); storage.set(key, value); }
  } }, isNarrow: () => narrow, isOpen: c => c.status === 'open', $: selector => node(selector),
  app: { classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } } },
  panel: node('panel'), panelBody: node('panelBody'), scrim: node('scrim'), peek: node('peek'),
  vmenu: node('vmenu'), versionHome: node('versionHome'), cluster: node('cluster'), infoBtn: node('infoBtn'),
  form: node('form'), composer: node('composer'), follow() {}, renderPins() {}, railOpen() {}, railDock() {},
  closeMenu() { S.menu = false; }, setPlacing(on) { S.placing = on; }
  });
  vm.runInContext(between('  function sget(', '  const str =') + badgeCode + panelCode +
    between("  S.panel = new URLSearchParams", "  S.scope = sget") +
    '\nthis.api = { setPanel, setSheet, syncSheet, renderPeek };', context);
  return { ...context.api, S, context, node, storage, classes, get focused() { return focused; } };
}

test('panel preference defaults closed, remembers both choices, and honours panel=1 even if storage is blocked', () => {
  assert.equal(runtime().S.panel, false);
  assert.equal(runtime({ preference: '0' }).S.panel, false);
  assert.equal(runtime({ preference: '1' }).S.panel, true);
  assert.equal(runtime({ preference: '0', search: '?panel=1' }).S.panel, true);
  assert.equal(runtime({ search: '?panel=0' }).S.panel, false);
  assert.equal(runtime({ blockedStorage: true }).S.panel, false);
  assert.equal(runtime({ blockedStorage: true, search: '?panel=1' }).S.panel, true);
});

test('opening and closing update persistence, accessibility, version menu location and focus', () => {
  const r = runtime();
  r.syncSheet();
  assert.equal(r.node('panel').inert, true);
  assert.equal(r.node('vmenu').parentElement, r.node('cluster'));
  r.setPanel(true, true);
  assert.equal(r.storage.get('kit:panel'), '1');
  assert.equal(r.node('panel').inert, false);
  assert.equal(r.node('peek').attrs['aria-expanded'], 'true');
  assert.equal(r.node('vmenu').parentElement, r.node('versionHome'));
  assert.equal(r.focused, 'composer');
  r.S.menu = true; r.S.placing = true;
  r.setPanel(false, true);
  assert.equal(r.storage.get('kit:panel'), '0');
  assert.equal(r.S.menu, false);
  assert.equal(r.S.placing, false);
  assert.equal(r.node('panel').inert, true);
  assert.equal(r.node('peek').attrs['aria-expanded'], 'false');
  assert.equal(r.focused, 'peek');
});

test('narrow opening avoids the keyboard and temporarily lowering the sheet retains the open preference', () => {
  const r = runtime({ narrow: true });
  r.setPanel(true, true);
  assert.equal(r.focused, '.ph-close');
  assert.equal(r.node('scrim').hidden, false);
  r.setSheet(false);
  assert.equal(r.node('panel').inert, true);
  assert.equal(r.node('scrim').hidden, true);
  assert.equal(r.S.panel, true);
  assert.equal(r.storage.get('kit:panel'), '1');
  r.setSheet(true);
  assert.equal(r.node('panel').inert, false);
  r.setPanel(false, true);
  assert.equal(r.focused, 'peek');
});

test('badge and live status count open comments on this screen, independent of scope and version', () => {
  const r = runtime();
  r.S.scope = 'all';
  r.S.comments = [{ screen: '/home', status: 'open', version: 1 }, { screen: '/home', status: 'open', version: 2 },
    { screen: '/home', status: 'done' }, { screen: '/home', status: 'wontdo' }, { screen: '/list', status: 'open' }];
  r.renderPeek();
  assert.equal(r.node('.peek-count').textContent, '2');
  assert.equal(r.node('.peek-count').hidden, false);
  assert.equal(r.node('peek').attrs['aria-label'], 'Leave feedback, 2 open comments on this screen');
  assert.equal(r.node('[data-kit="feedback-count"]').textContent, '2 open comments on this screen');
  r.S.screen.id = '/list'; r.renderPeek();
  assert.equal(r.node('[data-kit="feedback-count"]').textContent, '1 open comment on this screen');
  r.S.screen.id = '/detail'; r.renderPeek();
  assert.equal(r.node('.peek-count').hidden, true);
});

test('Pin placement and following a comment always open feedback', () => {
  const r = runtime();
  Object.assign(r.context, { geom: () => ({}), flash() {}, capture: { focus() {} }, renderComposer() {} });
  vm.runInContext(between('  function setPlacing(', '  function scrollFrame('), r.context);
  vm.runInContext('setPlacing(true);', r.context);
  assert.equal(r.S.panel, true);
  assert.equal(r.S.placing, true);
  assert.equal(r.node('panel').inert, true);
  vm.runInContext('setPlacing(false);', r.context);
  assert.equal(r.node('panel').inert, false);
  r.setPanel(false);
  let navigated;
  r.S.adapter = { go(_win, c) { navigated = c.hash; } }; r.S.win = {};
  vm.runInContext(between('  function goTo(', '  /* ---------- pins'), r.context);
  r.context.comment = { screen: '/list', hash: '#/list' };
  vm.runInContext('goTo(comment);', r.context);
  assert.equal(r.S.panel, true);
  assert.equal(navigated, '#/list');
});

test('version notes are announced once for each viewed version after manifest loading', async () => {
  const r = runtime();
  Object.assign(r.context, { showStage() {}, render() {}, fetch: async () => ({ status: 200 }), detach() {},
    setPlacing() {}, frame: {}, isNarrow: () => false });
  r.S.manifest = { title: 'Sprout', wideQuery: '', narrowQuery: '' };
  r.S.token = 0;
  vm.runInContext(between('  async function openVersion(', "  frame.addEventListener('load'"), r.context);
  for (const [n, expected] of [[2, true], [2, false], [1, true], [2, false], [1, false]]) {
    r.context.version = { n, file: 'proto-v' + n + '.html', notes: ['A fictional update'], fixed: [] };
    await vm.runInContext('openVersion(version, false)', r.context);
    assert.equal(r.S.news, expected);
    assert.equal(r.storage.get('kit:seen:' + n), '1');
  }
});
