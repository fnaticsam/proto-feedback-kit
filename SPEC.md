# Prototype feedback kit

proto-feedback adds pinned comments, a feedback panel and version history to clickable HTML prototypes published as Claude Artifacts or static sites with the optional Supabase backend. The prototype runs in a same-origin iframe with a feedback panel that starts closed; below 760px the panel becomes a bottom sheet. Reviewers leave comments on a screen, optionally pinned to a point. Every published version stays accessible through the version picker.

The examples and local development tools use fictional content. The example prototype is Sprout, a plant-care app under `examples/sprout/`. Dummy reviewers are Riley Chen (`riley`, the viewer) and Jordan Park (`jordan`).

## Published artifact layout

```text
index.html          kit shell, published as the artifact page
adapters.js         optional custom adapter registrations
versions.json       version manifest
remote.json         optional static-site Supabase configuration
proto-v1.html       complete, self-contained prototype document
proto-v2.html       next prototype version
img/...             assets shared by the prototype versions
```

The shell is `kit/index.html`, a complete document carrying its own reset, so hosts may serve it as is or wrap it. Version files are complete documents. Keep older version files when publishing an update. The iframe and shell must share an origin so adapters can inspect and drive the prototype.

Repository components:

```text
kit/index.html                  shell and built-in generic adapter
tools/bundle.mjs                dependency-free prototype bundler
tools/build-site.mjs            dependency-free static-site builder
backend/supabase/schema.sql     optional remote feedback RPC API
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

## Building a static site

`node tools/build-site.mjs --out <dir> --versions <versions.json> --protos <dir> [--remote <remote.json>] [--title "Name"]` builds a folder without network requests. The output contains a complete document wrapper around the kit, with UTF-8 charset, viewport metadata and an escaped title; the manifest; every referenced `proto-vN.html` version; optional `adapters.js` from `--protos`; and the optional remote configuration. A custom manifest adapter requires `adapters.js` in `--protos`. Copy referenced assets into the output at their expected relative paths. Version entries require distinct positive integer numbers and local filenames matching `^proto-v[1-9]\d*\.html$`; inputs outside the prototype directory are rejected.

The generated `vercel.json` applies `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`. It sets `Cache-Control: no-cache` on `/index.html`, `/versions.json` and `/remote.json`. Other hosts need equivalent header configuration.

A build without `--remote` refuses output that already contains `remote.json`, before writing any files. Use a fresh output directory or supply `--remote` explicitly.

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

Optional adapter methods add a screens rail and a narrow-screen Screens sheet:

```js
screens(win)       // [{ name, items: [{ id, title, hash, job }] }], or null
side(win)          // 'phone' or 'web'; omit for no Phone/Web switch
setSide(win, key)  // switch sides
reset(win)         // reset prototype state; adds a Reset link
```

When `screens` returns a nonempty list, the shell shows a tab fixed to the
window's left edge. Its button opens a 272px list with group
headings, screen buttons and optional Phone/Web and Reset controls. Group names
should use sentence case; `job` is an optional screen tooltip. Hover opens after
120ms and closes 220ms after leaving unless pinned; clicking toggles/pins, focus
opens, and focus leaving, outside pointerdown (including the iframe), or Escape
closes. Escape refocuses the rail button. Selecting a screen calls
`go(win, { hash })` and closes for non-mouse pointers. Current screen and side use
`aria-current` and `aria-pressed`. The list rebuilds only when JSON of
`[groups, side]` changes; otherwise aria state updates in place. Call the adapter's
`onChange` callback when groups or side change; polling also refreshes the rail.
Below 760px, Screens in the bottom bar opens the same list as a bottom sheet.
Choosing a screen, Escape or tapping outside closes it; Escape returns focus to
Screens. Without screens data the button is hidden.

### Generic screens and side

The built-in generic adapter optionally reads `window.kitScreens` from the
prototype window, either an array or a synchronous function returning an array:

```js
window.kitScreens = [{ name: 'Explore', items: [
  { id: '/plants', title: 'Plants', hash: '#/plants', job: 'Browse the fictional garden' },
  { id: '/care', title: 'Care', hash: '#/care' }
] }];
window.kitSide = 'web'; // or 'phone'
```

Groups require a string `name` and an `items` array. Each item requires nonempty
string `id` and `title` and a string `hash` starting with `#`; `job` is optional.
Invalid groups/items and empty groups are dropped. String limits are 60 for group
names, 120 for ids, 80 for titles, 500 for hashes and 300 for jobs. Use ids matching
the route without its leading `#`. Missing, invalid or empty screens data yields
no rail; throwing providers are ignored by the rail’s adapter-call boundary.
Rail clicks use generic `go()` to assign the prototype hash. The rail remains
reachable with feedback closed.

Generic `side(win)` reads `window.kitSide`: `phone` and `web` are supported, with
`web` as the fallback. Web shows the hover tab; phone docks the list at widths of
at least 1200px while feedback is closed, unless the viewer has hidden it. Opening
feedback undocks the list to its tab; closing feedback docks it again. Generic reports its side without
adding Phone/Web switch buttons. Custom `adapters.js` registrations keep their
existing screens, side switching and navigation behavior.

## Version manifest

```json
{
  "title": "Sprout",
  "adapter": "generic",
  "narrowQuery": "frame=0",
  "wideQuery": "shell=1",
  "versions": [
    { "n": 1, "file": "proto-v1.html", "date": "2026-10-25", "title": "First round", "notes": [], "fixed": [] },
    { "n": 2, "file": "proto-v2.html", "date": "2026-10-26", "title": "Clearer plant cards", "notes": ["Made the watering reminder easier to find."], "fixed": ["watering-note"] }
  ]
}
```

`adapter`, `adapterWaitMs`, `narrowQuery` and `wideQuery` are optional. `adapterWaitMs` must be an integer from 0 through 8000 milliseconds; invalid values, including strings, default to 0. It controls readiness only for a known, explicitly named custom adapter. Version numbers must be positive integers; filenames must match `^[\w.-]+\.html$`. Invalid entries are ignored, valid entries are sorted by number, and the highest number is the newest. With no valid entries the shell displays an empty-version notice. Manifest fetch failures show a retry action.

The shell chooses a version from the shell URL's `#vN`, then the session's last selection (`sessionStorage` key `kit:version`), then the newest version. Switching versions preserves the current screen's hash. Notes and fixed-comment references appear with each version. Missing version files show a retry action.

Fixed-comment links occupy one line with an ellipsis when needed. Their accessible names retain the screen title and full comment text, and their title attributes expose the full comment. Clicking a link still navigates to and focuses that feedback.

`wideQuery` is the query string used when opening a version at 760px or wider;
`narrowQuery` is used below 760px. Each is optional and must match `^[\w=&.-]*$`;
invalid values become an empty query. Resizing alone does not reload the version.

`narrowQuery` must match `^[\w=&.-]*$` and is added only under 760px. A prototype can use it to hide its own decorative frame. Manifest title, date, notes and fixed-comment lists are bounded and filtered before use; unrelated manifest validation applies equally to custom and generic adapters.

## Pins and feedback

A pin is `{ x, y }`: `x` is a fraction from 0 to 1 of the adapter target's width; `y` is pixels from the top of the scrolling content. Because `x` uses the full frame width, pins on content inside a centred fixed-width column drift as the frame resizes; centred pins (`x: 0.5`) remain stable. The overlay sits above the iframe and follows captured scroll events, resize and screen changes without inserting pin elements into the prototype. Within each screen, pinned comments are numbered in creation order; the numbers are derived, not stored.

“This screen” filters comments by stable screen id; “All” includes other screens. Clicking another screen's comment invokes the adapter's `go` method. The scope choice is stored in `localStorage` under `kit:scope`. Replies, resolve/reopen and two-step deletion update the shared database.

## Feedback panel visibility

Feedback starts closed, giving the prototype the full available stage width. On
wide windows a cluster 16px from the bottom-right holds the compact version chip
and a 44px pencil-accent “Leave feedback” button. The version chip uses the same
version menu as the open panel. The button’s badge counts open comments on the
current screen across versions, independently of This screen / All, and hides at
zero. Its accessible name includes the count, `aria-expanded` reports visibility,
`aria-controls` identifies the panel, and a separate polite live status announces
count changes.

Opening slides the panel in from the right in 200ms ease-out and restores the
existing desktop width (`clamp(340px, 34vw, 460px)`). Web prototypes (including an
omitted side) use a right overlay, preserving the iframe width; phone prototypes
keep a second column with the screens rail undocked. Reduced motion disables the
transition. Wide-window button opening focuses the composer; narrow opening
focuses Hide feedback to avoid raising the keyboard. The compact header contains
the truncated prototype title, version picker, an info button that toggles the
version’s change notes, and Hide feedback. The notes toggle reports
`aria-expanded`. Hide feedback or Escape within the panel closes it and returns
focus to the opener. Escape first dismisses an open version menu or cancels Pin
placement when either is active. Hidden panel controls are inert.

`localStorage['kit:panel']` stores `"1"` (open) or `"0"` (closed), defaulting to
closed. `?panel=1` in the shell URL overrides the stored choice on load. Storage
being unavailable does not prevent using the shell. Pin actions and following
comment links also open feedback. Stage pins render only while feedback is open;
stored `{ x, y }` values are unchanged, so wide-layout pins use the same stage
width as when placed. On wide web prototypes, arming Pin slides the overlay off
the right edge; placement or Escape restores it without resizing the iframe.
On narrow windows Pin temporarily lowers the sheet while
retaining the open preference, allowing stage interaction; placing a pin or
clicking an existing pin brings the sheet back.

Below 760px the opener is a slim bar **below** the stage, reserving 56px plus the
bottom safe area so it does not cover a prototype’s bottom tabs. It holds the
speech-bubble icon, Feedback, badge, optional Screens button and version chip; Feedback opens the existing
78dvh sheet. Touch targets are at least 44px, including invisible padding around
stage pins. The same visibility preference applies across widths.

After `versions.json` loads, the first selection of a version checks
`localStorage['kit:seen:<n>']`. Versions with notes or fixed comments get a small
dismissible “What changed in vN” card above the closed controls; feedback stays
closed. The selection records `"1"` for that version, so subsequent visits keep
notes behind the info button. Fixed references in this card are summarized as a
count; full fixed-comment links remain in the panel’s notes. Wide cards show at
most three notes and an All notes button that opens the panel with notes expanded.
Below 760px, the card is a single line above Feedback: “What changed in vN · X
notes ›” (singular “1 note”), with a separate dismiss button and a maximum height
of 56px. Tapping the line opens all notes in the panel. Opening the version menu
dismisses the card. A version without
notes or fixed comments has no card or info button. If feedback is already open,
the card stays hidden until it closes during that visit.

## Database schema

The shell uses a shared `db` and `user` interface, supplied by the Artifact runtime or the remote adapter below. Each collection document has a database id.

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
| `byOwner` | Boolean owner-authorship marker |
| `createdAt`, `updatedAt` | ISO timestamps |
| `status` | `"open"`, `"done"` or `"wontdo"` |
| `resolvedIn` | Version number that resolved the comment, or `null` |
| `approved` | Optional boolean; owner marked this comment Do next |
| `approvedAt` | Approval ISO timestamp, or `null` when cleared |

`replies/<id>`:

| Field | Value |
| --- | --- |
| `commentId` | Parent comment id |
| `text` | Plain-text reply |
| `author` | User id |
| `by` | Optional `"claude"` |
| `byOwner` | Boolean owner-authorship marker in remote mode |
| `createdAt` | ISO timestamp |
| `version` | Prototype version number |

Names are resolved with `user.profiles(ids)` and displayed as the name or “Someone”. Documents marked `by: "claude"` display “Claude”. The shell subscribes to the latest 1000 documents in each collection, ordered by `createdAt` descending.

In Artifact mode, shared-database writes require Contributor access or above. The composer is visible for a known viewer when `user.can("data.write")` is true or unknown (`null`). A rejected write with `not_granted`, `revoked`, `capability_disabled` or `capability_removed` switches the shell to read-only for the visit. `invalid_argument` while creating a comment or reply also switches it to read-only. `unavailable` is retried once after a short delay. Other failures show a message and retain the draft. Declare `comments: {"composer_only": true}` in the Artifact capabilities: viewers without database write access get a Comment action that calls `claude.use("comments")` and `openComposer({element})`, targeting the prototype frame or panel. If unavailable, the panel keeps a one-line notice. Native comments belong to the Artifact discussion, not the kit collections.

Only the owner sees Do next on comments by other people. Toggling it patches `approved` and `approvedAt`; approved open comments show a Do next chip. Owner-authored comments have a subtle owner mark. Artifact owner identity comes from `user.me().isOwner` or `user.isOwner()`; owner comment writes include `byOwner: true`. Existing Artifact resolve rules remain in effect. Remote resolve and won't-do controls are owner-only.

### Remote backend

When `window.claude?.use` is absent, the shell attempts `remote.json` beside the page with `{ "supabaseUrl": "…", "anonKey": "…", "project": "slug" }`. If missing, existing runtime-unavailable behavior remains. Configuration is public and must contain only the public `anon` API key, never an owner or service-role key.

The inline adapter uses plain POST fetches to `${supabaseUrl}/rest/v1/rpc/<fn>`, with JSON arguments, `apikey: <anonKey>` and `Authorization: Bearer <anonKey>`. Its collection interface shares the panel's existing `orderBy().limit().onSnapshot()` and document `set`, `update` and `delete` paths. Snapshot docs expose `id` and `data()`, sorted using the document's client ISO `createdAt` and limited per collection. Server `author` and `byOwner` override client data; the separate server timestamps remain part of the RPC envelope.

| RPC | Arguments / use |
| --- | --- |
| `pf_list` | `p_project`; returns all collection documents, names map and server time |
| `pf_whoami` | `p_project`, `p_secret`, `p_owner_key`; returns `{author, isOwner}` |
| `pf_write` | `p_project`, `p_collection`, `p_id`, `p_data`, `p_secret`, `p_owner_key`, `p_merge`; set uses false, update uses true |
| `pf_delete` | `p_project`, `p_collection`, `p_id`, `p_secret`, `p_owner_key` |
| `pf_set_name` | `p_project`, `p_secret`, `p_name`, `p_owner_key`; returns `{author, name}` |

Document IDs are cryptographically random and match `^[A-Za-z0-9_-]{6,40}$`. A random secret of at least 32 URL-safe characters is stored at `pf:secret:<project>`; storage failures retain identity in memory for the visit. A first-visit `owner` query parameter is stored at `pf:owner:<project>` and stripped with `history.replaceState`, preserving other parameters and the hash. `pf_whoami` verifies it; a key that does not confer owner status is forgotten. Owner sign-out clears it and returns to the browser's reviewer identity. All storage reads and writes tolerate unavailable storage.

`me()` maps the returned author to `{id, isOwner}` and `can("data.write")` is true. The server protects mutations: non-owners can change or delete only their own documents, owner fields remain protected even on their own comments, and deleting a comment deletes its replies. `author` and `byOwner` are assigned by the server. See `backend/supabase/schema.sql` (`pf_write`, `pf_delete`) for the authority boundary.

Before the first remote comment or reply, a single Your name field saves through `pf_set_name` and caches the name locally. The same field allows later edits. Profiles come from the `pf_list.names` map; owner display falls back to Owner. The adapter polls every eight seconds while visible, immediately on return to a visible tab and after writes, and delivers refreshed snapshots to subscribers.

HTTP 400 maps to `invalid_argument`, 403 to `not_granted`, 429 to `rate_limited`; 404, other HTTP errors and network failures map to `unavailable`. Rate-limit failures retain the draft and ask the viewer to try again in a minute.


## Stable browser test hooks

| `data-kit` value | Element / extra attributes |
| --- | --- |
| `rail` | Screens rail at the window's left edge, or open narrow sheet; requires adapter screens |
| `screens-open` | Narrow bar Screens button; hidden without adapter screens |
| `frame` | Prototype iframe |
| `panel` | Feedback panel; `id="feedback-panel"`, inert while hidden |
| `feedback-open` | Desktop pill / narrow bar opener |
| `feedback-close` | Hide feedback button |
| `feedback-count` | Polite live status for current-screen open count |
| `notes-toggle` | Info button for version notes |
| `whats-new` | Dismissible once-per-version notes card |
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
| `readonly` | Read-only notice or native comment action |
| `native-comment` | Native Artifact comment composer action |
| `name` | Remote reviewer name field |
| `owner-signout` | Leave owner mode action |
| `owner-mark` | Owner-authorship label |
| `approve` | Owner Do next toggle |

Selectors such as `[data-kit="comment"][data-id="watering-note"]` allow tests to follow feedback without depending on styling classes. Local testing and mock configuration are documented in `dev/harness/README.md`.

## Turning feedback into the next version

The agent reads open comments from the artifact's shared database, records the feedback for version N, triages the requests and builds version N+1. It bundles and publishes the new prototype with an updated manifest, replies to handled comments and marks resolved comments with `by: "claude"` and `resolvedIn: N+1`. The full agent workflow lives at `skills/proto-feedback/SKILL.md`.
