# Prototype feedback kit

proto-feedback adds pinned comments, a feedback panel and version history to clickable HTML prototypes published as Claude Artifacts. The prototype runs in a same-origin iframe beside a feedback panel; below 760px the panel becomes a bottom sheet. Reviewers leave comments on a screen, optionally pinned to a point. Every published version stays accessible through the version picker.

The examples and local development tools use fictional content. The example prototype is Sprout, a plant-care app under `examples/sprout/`. Dummy reviewers are Riley Chen (`riley`, the viewer) and Jordan Park (`jordan`).

## Published artifact layout

```text
index.html          kit shell, published as the artifact page
adapters.js         optional custom adapter registrations
versions.json       version manifest
proto-v1.html       complete, self-contained prototype document
proto-v2.html       next prototype version
img/...             assets shared by the prototype versions
```

The shell is `kit/index.html`, a fragment without a doctype because the artifact runtime supplies the document wrapper. Version files are complete documents. Keep older version files when publishing an update. The iframe and shell must share an origin so adapters can inspect and drive the prototype.

Repository components:

```text
kit/index.html                  shell and built-in generic adapter
tools/bundle.mjs                dependency-free prototype bundler
dev/mock-claude.js              in-memory artifact capabilities for local use
dev/fixtures/                   dummy prototypes and custom adapters
dev/harness/                    fixture builder, local server and browser helpers
tests/                          unit and Playwright browser tests
skills/proto-feedback/SKILL.md   agent skill for the next feedback round
```

The agent skill works in Claude Code (`~/.claude/skills/`) and Codex (`~/.codex/skills/`). The Claude Code plugin marketplace is `.claude-plugin/marketplace.json`; the plugin manifest is `.claude-plugin/plugin.json`, with the repository root as the plugin.

## Bundling a prototype

Use Node 22 or newer:

```sh
node tools/bundle.mjs --src examples/sprout --out out/proto-v1.html --version 1
node tools/bundle.mjs --src path/to/prototype --out out/proto-v2.html --version 2 --embed-glob 'screens/*.js'
```

`--src` contains the prototype's `index.html`. Asset paths in the result are relative to that directory's root, which becomes the artifact root. `--out` is the output document and `--version` becomes `<meta name="kit:version" content="…">`. Unknown or incomplete options are usage errors.

The bundler:

- Inlines local stylesheets, rebasing their relative `url(...)` references to the root. Absolute, protocol-relative, data and remote URLs stay intact; external font links remain links.
- Inlines local scripts in document order and escapes closing script tags in their contents. Script `onload` and `onerror` attributes are dropped; missing local scripts are skipped with a warning.
- Optionally embeds matching lazy scripts in an ASCII JSON map, `window.__kitFiles`. The loader serves mapped script requests made through `appendChild`, `insertBefore` or `document.write` without network requests, preserving lazy execution timing. Files already inlined are excluded. A glob matching no additional files warns.
- Rewrites `window.claude` reads to `(window.__kitClaude||window.claude)`. Assigning to `window.claude` is a hard error. Bare `claude.use(...)` calls warn because they cannot use the bridge reliably.
- Inserts a bridge prelude that reads `parent.claude` into `window.__kitClaude` when accessible. This lets same-origin version pages use the shell's capabilities.
- Produces a complete HTML document with a UTF-8 charset near the start, viewport metadata and version metadata. Fragment sources also receive the standard document reset.

The command prints script, stylesheet, embedded-screen and rewrite counts, warning count and output bytes. Hard errors produce a nonzero exit code. Publish referenced image assets alongside the bundled version.

## Adapter contract

An adapter tells the kit how to read and drive one kind of prototype:

```js
{
  name: 'acme',                       // unique, lowercase
  detect(win)        -> boolean,      // recognises the iframe prototype
  screen(win)        -> { id, title, hash }, // stable id, human title, return hash
  onChange(win, cb)  -> unsubscribe,  // notify on screen changes; return cleanup
  target(win)        -> { el, scroller }, // pin target and its scrolling element
  go(win, comment)                    // return to comment.hash
}
```

The kit ships one built-in adapter, `generic`: screen id and return hash come from the iframe's hash route, the title comes from its document title, and pins use the document root and document scrolling element. It listens for `hashchange` and `popstate` and navigates by assigning the hash. An empty hash has screen id `/`.

Place custom registrations in `adapters.js` next to the shell's `index.html`, separate from the bundled prototype:

```js
(window.kitAdapters = window.kitAdapters || []).push({
  name: 'acme',
  detect(win) { return !!win.document.querySelector('[data-prototype]'); },
  screen(win) {
    return { id: win.location.hash || '/', title: win.document.title, hash: win.location.hash };
  },
  onChange(win, cb) {
    win.addEventListener('hashchange', cb);
    return () => win.removeEventListener('hashchange', cb);
  },
  target(win) {
    const el = win.document.querySelector('[data-prototype]');
    return { el, scroller: el };
  },
  go(win, comment) { win.location.hash = comment.hash; }
});
```

The shell inserts a script tag and waits for load or error before detection. A 1500ms timeout bounds the wait; a missing or failing download is harmless. Registrations must be an array of objects with a unique lowercase name and all five required functions. `generic` is reserved. Invalid or duplicate entries are skipped with a console warning; an invalid registry also warns.

Choice order:

1. Use the adapter named by `versions.json` `adapter`, either `generic` or a registered name. An explicit selection does not require `detect()` to return true unless `adapterWaitMs` opts into a readiness wait.
2. Otherwise use the first registered adapter whose `detect(win)` returns true.
3. Otherwise use `generic`.

An unknown manifest name warns and falls back to detection. Automatic detection polls every 100ms for up to two seconds to allow asynchronously initialized prototypes to become ready. Adapter selection runs again on each version frame load. The shell calls the `onChange` unsubscribe when detaching a frame and also polls screen state to catch missed navigation notifications. See `dev/fixtures/custom-adapter/` for a working dummy adapter with an inner scrolling element.

For a named custom adapter that needs asynchronous initialization, set `adapterWaitMs` in `versions.json` (for example `8000`). The shell polls only that adapter's `detect(win)` every 100ms, binds once it returns true, and falls back to `generic` if it is still false or throwing at the deadline. No custom adapter methods other than `detect` run during the wait. A new frame load cancels the previous selection and starts a fresh wait. Omitted or zero waits preserve immediate explicit selection; `generic` always binds immediately. Unknown or absent names keep the normal automatic detection order and two-second limit.

## Version manifest

```json
{
  "title": "Sprout",
  "adapter": "generic",
  "narrowQuery": "frame=0",
  "versions": [
    { "n": 1, "file": "proto-v1.html", "date": "2026-10-25", "title": "First round", "notes": [], "fixed": [] },
    { "n": 2, "file": "proto-v2.html", "date": "2026-10-26", "title": "Clearer plant cards", "notes": ["Made the watering reminder easier to find."], "fixed": ["watering-note"] }
  ]
}
```

`adapter`, `adapterWaitMs` and `narrowQuery` are optional. `adapterWaitMs` must be an integer from 0 through 8000 milliseconds; invalid values, including strings, default to 0. It controls readiness only for a known, explicitly named custom adapter. Version numbers must be positive integers; filenames must match `^[\w.-]+\.html$`. Invalid entries are ignored, valid entries are sorted by number, and the highest number is the newest. With no valid entries the shell displays an empty-version notice. Manifest fetch failures show a retry action.

The shell chooses a version from the shell URL's `#vN`, then the session's last selection (`sessionStorage` key `kit:version`), then the newest version. Switching versions preserves the current screen's hash. Notes and fixed-comment references appear with each version. Missing version files show a retry action.

Fixed-comment links occupy one line with an ellipsis when needed. Their accessible names retain the screen title and full comment text, and their title attributes expose the full comment. Clicking a link still navigates to and focuses that feedback.

`narrowQuery` must match `^[\w=&.-]*$` and is added only under 760px. A prototype can use it to hide its own decorative frame. Manifest title, date, notes and fixed-comment lists are bounded and filtered before use; unrelated manifest validation applies equally to custom and generic adapters.

## Pins and feedback

A pin is `{ x, y }`: `x` is a fraction from 0 to 1 of the adapter target's width; `y` is pixels from the top of the scrolling content. Because `x` uses the full frame width, pins on content inside a centred fixed-width column drift as the frame resizes; centred pins (`x: 0.5`) remain stable. The overlay sits above the iframe and follows captured scroll events, resize and screen changes without inserting pin elements into the prototype. Within each screen, pinned comments are numbered in creation order; the numbers are derived, not stored.

“This screen” filters comments by stable screen id; “All” includes other screens. Clicking another screen's comment invokes the adapter's `go` method. The scope choice is stored in `localStorage` under `kit:scope`. Replies, resolve/reopen and two-step deletion update the shared database.

## Database schema

The shell uses the artifact `db` and `user` capabilities. Each collection document has a database id.

`comments/<id>`:

| Field | Value |
| --- | --- |
| `screen` | Stable screen id |
| `screenTitle` | Human title when written |
| `hash` | Iframe hash to return to |
| `version` | Prototype version number when written |
| `pin` | `{ x, y }` or `null` |
| `text` | Plain text, 1–4000 characters |
| `author` | User id, never a display name |
| `by` | Optional `"claude"` for agent-authored documents |
| `createdAt`, `updatedAt` | ISO timestamps |
| `status` | `"open"`, `"done"` or `"wontdo"` |
| `resolvedIn` | Version number that resolved the comment, or `null` |

`replies/<id>`:

| Field | Value |
| --- | --- |
| `commentId` | Parent comment id |
| `text` | Plain-text reply |
| `author` | User id |
| `by` | Optional `"claude"` |
| `createdAt` | ISO timestamp |
| `version` | Prototype version number |

Names are resolved with `user.profiles(ids)` and displayed as the name or “Someone”. Documents marked `by: "claude"` display “Claude”. The shell subscribes to the latest 1000 documents in each collection, ordered by `createdAt` descending.

Writes require Contributor access or above. The composer is visible for a known viewer when `user.can("data.write")` is true or unknown (`null`). A rejected write with `not_granted`, `revoked`, `capability_disabled` or `capability_removed` switches the shell to read-only for the visit. `invalid_argument` while creating a comment or reply also switches it to read-only. `unavailable` is retried once after a short delay. Other failures show a message and retain the draft.

## Stable browser test hooks

| `data-kit` value | Element / extra attributes |
| --- | --- |
| `frame` | Prototype iframe |
| `panel` | Feedback panel |
| `version` | Version picker button |
| `version-option` | Version menu entry; `data-n` |
| `screen` | Current screen label |
| `scope` | Scope buttons; `data-scope` (`screen` or `all`) |
| `comment` | Comment; `data-id`, `data-status` |
| `pin` | Overlay pin marker; `data-id` |
| `pin-toggle` | Starts pin placement |
| `composer` | Feedback textarea |
| `submit` | Post button |
| `reply` | Comment reply button |
| `resolve` | Resolve/reopen button |
| `readonly` | Read-only notice |

Selectors such as `[data-kit="comment"][data-id="watering-note"]` allow tests to follow feedback without depending on styling classes. Local testing and mock configuration are documented in `dev/harness/README.md`.

## Turning feedback into the next version

The agent reads open comments from the artifact's shared database, records the feedback for version N, triages the requests and builds version N+1. It bundles and publishes the new prototype with an updated manifest, replies to handled comments and marks resolved comments with `by: "claude"` and `resolvedIn: N+1`. The full agent workflow lives at `skills/proto-feedback/SKILL.md`.
