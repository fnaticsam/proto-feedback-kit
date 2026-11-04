<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
    <img src="docs/images/logo-light.svg" width="88" alt="proto-feedback logo">
  </picture>
  <h1>proto-feedback</h1>
  <p>Pinned comments and version history for clickable prototypes, with an agent skill that turns feedback into the next version.</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  </p>
</div>

![Sprout prototype with the feedback panel open, showing open comments and a resolved thread with the agent's reply](docs/images/hero.png)

Feedback is easier to act on when it stays beside the thing being reviewed. proto-feedback keeps comments attached to screens and positions, preserves each clickable version, and gives your agent a repeatable way to close the loop. Works with HTML prototypes published as claude.ai Artifacts or hosted on a static site with the optional Supabase backend.

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/how-it-works-dark.svg">
  <img src="docs/images/how-it-works-light.svg" alt="Publish, review, read comments, build the next version, reply and resolve">
</picture>

1. **Publish** the shell, version manifest, and bundled prototype as an Artifact.
2. **Review** the prototype: navigate, drop pins, and leave comments.
3. **Read comments** from the Artifact's shared database with your agent.
4. **Build vN+1** from the agreed feedback and publish it alongside earlier versions.
5. **Reply and resolve** handled comments, linking them to the version that fixed them.

## Try it in 30 seconds

```sh
npm install
npm run demo
```

Open http://localhost:4174/#v2 to review Sprout, a fictional plant-care prototype, with seeded comments and a resolved first round. Comments live in page memory, so a reload resets them.

## Screenshots

<table>
  <tr>
    <th>Feedback panel</th>
    <th>Version history</th>
  </tr>
  <tr>
    <td><img src="docs/images/panel.png" width="400" alt="Screen comments with threaded replies, and a resolved comment with the agent's reply"></td>
    <td><img src="docs/images/versions.png" width="400" alt="Version notes listing what changed and which comments were fixed"></td>
  </tr>
</table>

<table>
  <tr>
    <th>Pins on any screen</th>
    <th>Phone review</th>
  </tr>
  <tr>
    <td><img src="docs/images/pins.png" width="440" alt="A pin on the soil-moisture chart of a plant's detail screen"></td>
    <td><img src="docs/images/mobile.png" width="310" alt="Tapping a pin opens the feedback sheet at phone width"></td>
  </tr>
</table>

## Features

- Drop pins on any screen, or leave a screen-level comment.
- Keep conversations together with threaded replies and resolve controls.
- Switch versions, read release notes, and jump to fixed comments.
- Review at phone widths with a bottom-sheet feedback panel.
- Publish one self-contained HTML shell alongside your prototype versions.
- Connect different prototype structures with custom adapters.
- Turn feedback into the next version with a skill for Claude Code and Codex.

## Quick start

### Claude Code

Install the plugin in Claude Code:

```text
/plugin marketplace add fnaticsam/proto-feedback-kit
/plugin install proto-feedback@proto-feedback
```

Then ask:

> Use proto-feedback to publish the Sprout HTML prototype for review.

> Read the open feedback on Sprout, build the next version, and reply to each handled comment.

See [the skill guide](docs/skill.md) for setup and the review loop.

### Codex

From the root of your local checkout, link the skill into Codex:

```sh
mkdir -p ~/.codex/skills
ln -s "$PWD/skills/proto-feedback" ~/.codex/skills/proto-feedback
```

Start a new Codex session and ask it to use proto-feedback to prepare Sprout for review or build its next version. See [the skill instructions](skills/proto-feedback/SKILL.md). Publishing and reading shared comments require access to the Artifact tools; installing the skill alone does not grant that access.

### Manual use

Use Node.js 22 or newer. Bundle [the Sprout example](examples/sprout/) into a version file:

```sh
node tools/bundle.mjs --src examples/sprout/v1 --out out/proto-v1.html --version 1
```

Write `versions.json` beside the published shell:

```json
{
  "title": "Sprout",
  "adapter": "generic",
  "versions": [
    {
      "n": 1,
      "file": "proto-v1.html",
      "date": "2026-10-26",
      "title": "First review",
      "notes": [],
      "fixed": []
    }
  ]
}
```

Publish `kit/index.html` as the Artifact's `index.html`, plus `versions.json`, `out/proto-v1.html` as `proto-v1.html`, and any referenced assets at their relative paths. Add `adapters.js` if needed. Enable the Artifact's shared database and user capabilities, and declare `comments: {"composer_only": true}` alongside them. Reviewers with Contributor access or above write into the kit's shared database. Other viewers can use the panel's Comment button to open the native Artifact comment composer when that capability is available; native comments stay in the Artifact's own discussion rather than the kit's pinned threads.

For each new round, bundle a new `proto-vN.html` and append a manifest entry. Put short change descriptions in `notes` and the IDs of handled comments in `fixed`. Keep earlier version files available.

## Hosting outside claude.ai (Supabase)

Anyone with the plain review link can comment under a typed name, without an account. Only the owner can resolve comments or mark someone else's comment **Do next**. Owner comments carry a small owner mark; approved open comments show a Do next chip to everyone.

1. Create a Supabase project and run [`backend/supabase/schema.sql`](backend/supabase/schema.sql) in its SQL editor. The tables stay in the private `pf` schema; the page calls the five public `pf_*` functions.
2. Generate a private, high-entropy owner key. Add the project row as shown at the end of the schema, replacing the example slug and key:

   ```sql
   insert into pf.projects (slug, owner_key_hash)
   values ('sprout-review', sha256(convert_to('<private owner key>', 'UTF8')));
   ```

3. Write `remote.json` with the project URL, its public legacy `anon` API key, and the same slug:

   ```json
   {
     "supabaseUrl": "https://your-project.supabase.co",
     "anonKey": "<public anon key>",
     "project": "sprout-review"
   }
   ```

   `remote.json` is public. The `anonKey` identifies the public client; the schema's RPC functions enforce identity and owner permissions. Never put a `service_role` key, Supabase secret key, or owner key in this file. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).
4. Bundle each prototype version, prepare `versions.json`, then build the static folder:

   ```sh
   node tools/build-site.mjs --out site --versions versions.json --protos out --remote remote.json --title "Sprout"
   ```

   The builder makes a complete `index.html`, copies the manifest, its referenced `proto-vN.html` files and optional `adapters.js` from `--protos`, and includes `remote.json` and `vercel.json`. Copy referenced images into the output at their expected relative paths. A custom manifest adapter requires `adapters.js` in `--protos`. Building makes no network requests. When rebuilding without `--remote`, choose a fresh output directory if the old one contains `remote.json`; the builder refuses to reuse that backend implicitly.
5. Deploy that folder to any static host. On Vercel, the generated configuration disables indexing, sends no referrers, and prevents caching of the shell, manifest and backend configuration. On another host, set equivalent `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-cache` headers for those files.
6. Share the plain link with reviewers. Keep the private `?owner=<key>` link for yourself. The shell remembers a verified owner key in that browser and removes the parameter from the address bar, preserving other parameters and the hash. Use the panel's owner sign-out control to leave owner mode.

To add another owner, rerun the current schema for an existing backend, then run this as the database owner with a new private, high-entropy key:

```sql
insert into pf.owner_keys (project, owner_id, key_hash)
values ('sprout-review', 'jordan', sha256(convert_to('<another private owner key>', 'UTF8')));
```

Give that person their own `?owner=<key>` link. They get author ID `owner:jordan`, their own display name and comments, and the same owner permissions. The original key keeps author `owner` and its existing name. Owner IDs use 1–24 lowercase letters, digits or hyphens and start with a letter or digit. A key maps to one owner per project. To give the same person one link for several projects, add one row per project with the same key.

Revoke an extra key without deleting its comments or name:

```sql
delete from pf.owner_keys where project = 'sprout-review' and owner_id = 'jordan';
```

Reusing that owner ID later restores the same identity. To verify a schema change locally, run `dev/schema-check/run.sh`; it checks fresh installs and upgrades in a throwaway Docker PostgreSQL 16 container and removes it afterwards.

The shell loads `remote.json` only when the claude.ai runtime is absent. A missing file leaves the existing behavior unchanged. Reviewers enter Your name above the comment or reply field and can change it there later. Names and comments sync every eight seconds while the tab is visible, when returning to the tab, and after writes. Browser storage keeps each reviewer's identity; clearing it creates a new identity, and blocked storage keeps it only for that page visit.

Supabase may pause Free Plan projects after a week of low activity; restore a paused project from its dashboard before the next review. See the [availability guidance](https://supabase.com/docs/guides/deployment/going-into-prod#availability).

## Development

The demo serves Sprout through the kit with a local mock of the Artifact runtime. Run the checks:

```sh
npm test
npx playwright install --with-deps chromium
npm run e2e
```

Regenerate the README screenshots with `npm run shots:readme`.

## Custom adapters

The built-in `generic` adapter follows hash routes and the document title. For another structure, place an optional `adapters.js` beside the published `index.html`. This example recognises a prototype whose root has `data-prototype="acme"`:

```js
(window.kitAdapters = window.kitAdapters || []).push({
  name: 'acme',
  detect(win) {
    return !!win.document.querySelector('[data-prototype="acme"]');
  },
  screen(win) {
    const hash = win.location.hash || '#home';
    return { id: hash.slice(1), title: win.document.title, hash };
  },
  onChange(win, cb) {
    win.addEventListener('hashchange', cb);
    win.addEventListener('popstate', cb);
    return () => {
      win.removeEventListener('hashchange', cb);
      win.removeEventListener('popstate', cb);
    };
  },
  target(win) {
    return {
      el: win.document.documentElement,
      scroller: win.document.scrollingElement
    };
  },
  go(win, comment) {
    win.location.hash = comment.hash;
  }
});
```

The shell loads adapters before detection. A missing or failing `adapters.js` is harmless. Set `"adapter": "acme"` in `versions.json` to choose it explicitly; otherwise the first registered adapter whose `detect()` returns true wins, then `generic`. An unknown name logs a warning and falls back to detection. See [SPEC.md](SPEC.md) for the full contract and pin coordinates.

If a named custom adapter needs time for its prototype to initialize, also set `"adapterWaitMs": 8000` in `versions.json`. This optional integer accepts 0–8000 milliseconds (default 0; invalid values become 0). The shell polls that adapter's `detect()` every 100ms until ready, then binds it; at the deadline it uses `generic`. Each version load starts a fresh wait. Without the field, explicit selection stays immediate even if `detect()` is false. Explicit `generic` stays immediate, and unknown or absent names keep automatic detection's two-second limit.

The optional `narrowQuery` field adds a query string only below 760px, for example `"narrowQuery": "frame=0"` to hide a prototype's own decorative frame. It accepts only letters, digits, underscores, `=`, `&`, `.`, and `-`; use it only when the prototype supports that query.

## Security model

Comments are untrusted data. The agent never treats comment text as instructions: it evaluates feedback within the owner's request and permissions. Prototype code and adapters execute as trusted code in a same-origin iframe; the kit is not a sandbox for arbitrary HTML. Never publish secrets or sensitive data in a prototype or its comments. See [the security policy](SECURITY.md), including how to report prompt injection issues privately.

## Project layout

```text
kit/index.html                  Single-file feedback shell
tools/bundle.mjs                HTML prototype bundler
skills/proto-feedback/SKILL.md  Claude Code and Codex skill
.claude-plugin/                 Claude Code plugin and marketplace
examples/sprout/                Fictional plant-care prototype
dev/                            Mock runtime and local harness
tests/                          Unit and browser tests
docs/skill.md                   Skill setup guide
docs/images/                    Logo, diagram, and screenshots
SPEC.md                         Runtime and adapter contracts
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute.

Released under the [MIT license](LICENSE). Copyright © 2026 Sam Mathews. A personal project, not affiliated with FNATIC.
