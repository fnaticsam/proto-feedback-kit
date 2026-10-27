# Feedback shell harness

The harness runs the kit locally with dummy prototypes and an in-memory mock of the artifact runtime. It needs Node 20 or newer and Playwright Chromium:

```sh
npm install
npx playwright install chromium
npm test
npm run e2e
```

All fixtures use fictional content and dummy reviewer identities: Riley Chen (`riley`, the viewer) and Jordan Park (`jordan`). No external prototype checkout or artifact account is required. The unit suite checks the bundler and mock; browser tests cover comments, pins, scrolling, navigation, versions, permissions, responsive layout and custom adapter selection.

For a manual run:

```sh
npm run build:fixture
npm run harness
# Optional fixture directory and port:
node dev/harness/serve.mjs out/shell 4173
```

Open `http://127.0.0.1:4173/`. The dependency-free loopback server wraps the shell in a complete document, injects the mock before the shell and serves the chosen fixture's files through GET and HEAD. `out/` holds generated versions, manifests and screenshots and is ignored by Git. Fixture builds always use the current source.

## Fixtures and adapters

`dev/fixtures/proto/` is a hash-routed dummy prototype used with the built-in `generic` adapter. `dev/fixtures/mini/` exercises local styles, scripts and lazy-script bundling. `dev/fixtures/custom-adapter/` contains a dummy garden prototype with an inner scrolling element and an `adapters.js` registration.

A published artifact contains the shell as `index.html`, `versions.json`, bundled `proto-vN.html` documents, any shared `img/` assets and optionally a sibling `adapters.js`. Build a version with:

```sh
node tools/bundle.mjs --src dev/fixtures/proto --out out/shell/proto-v1.html --version 1
```

The bundler inlines local styles and scripts, bridges the parent artifact capabilities, and optionally embeds lazy scripts with `--embed-glob 'screens/*.js'`. Copy custom `adapters.js` beside the shell, separate from the prototype bundle.

Register adapters with `(window.kitAdapters = window.kitAdapters || []).push({ ... })`. Each adapter needs a unique lowercase `name` and functions `detect(win)`, `screen(win)` returning `{ id, title, hash }`, `onChange(win, cb)` returning an unsubscribe function, `target(win)` returning `{ el, scroller }`, and `go(win, comment)` to navigate to `comment.hash`.

The shell waits for `adapters.js` to load or fail, with a 1500ms timeout. Invalid registrations warn and are skipped. The manifest's named adapter wins; otherwise the first registered adapter whose `detect()` succeeds wins; otherwise `generic` handles hash routes and document titles. Unknown names warn and fall back to detection. Missing or failed adapter downloads are harmless.

`versions.json` lists a title, optional adapter and narrow-screen query, and versions with `n`, `file`, `date`, `title`, `notes` and `fixed`. The highest valid version number is newest; `#vN` selects an older version. See `SPEC.md` for validation rules, the complete adapter contract and database schema. The agent skill lives at `skills/proto-feedback/SKILL.md`.

## Seeded sessions

Import `startServer({ fixture, config })` from `serve.mjs` for another fixture or seeded session. Tests can use `page.addInitScript` to set `window.__mockClaudeConfig` before loading the shell. Each browser context gets its own in-memory store.

```js
window.__mockClaudeConfig = {
  me: { id: 'riley', name: 'Riley Chen' },
  canWrite: null, // true, false, or unknown (null)
  refuseWrites: null, // e.g. 'invalid_argument' or 'revoked'
  people: { jordan: { id: 'jordan', name: 'Jordan Park' } },
  seed: { comments: [], replies: [] } // flat documents, each with an id
};
```

Comments store `screen`, `screenTitle`, `hash`, `version`, optional `pin`, `text`, `author`, timestamps, `status` and `resolvedIn`. Replies store `commentId`, `text`, `author`, `createdAt` and `version`. Either may carry `by: 'claude'` for an agent-authored document. Display names come from profiles rather than the stored author field.

In the console, `__mock.docs('comments')` and `__mock.store` return copies of stored data. `__mock.set(collection, id, data)`, `.update(collection, id, patch)` and `.delete(collection, id)` change the store and notify subscribers. `__mock.refuseWrites = 'revoked'` rejects subsequent capability writes; `null` restores writes when permissions allow. Direct store helpers intentionally bypass permissions. The mock implements only the capabilities the shell consumes and does not enforce a production schema.

## Browser helpers and captures

Use stable hooks such as `[data-kit="frame"]`, `[data-kit="screen"]`, `[data-kit="comment"][data-id="note"]`, `[data-kit="pin"]`, `[data-kit="composer"]`, `[data-kit="submit"]` and `[data-kit="version-option"][data-n="1"]`. The full hook table is in `SPEC.md`. Browser helpers in `browser.mjs` create isolated contexts, inject configuration and assert that browser execution has no errors. Optional adapter download failures are allowed; unrelated resource and script errors still fail the test. Optional remote font styles are fulfilled locally.

Pin tests measure the drop's tip against a content landmark before and after real iframe scrolling. Navigation and rendering waits use observable states or awaited events. The adapter timeout test uses a controlled browser clock.

`npm run shots` writes seeded screenshots to `out/shots/`:

- `desktop-light.png` — 1440×900
- `desktop-dark.png` — 1440×900 with dark colour scheme
- `mobile-closed.png` — 400×860 with the sheet closed
- `mobile-open.png` — 400×860 with the sheet open
- `desktop-versions.png` — 1440×900 with the version menu open
