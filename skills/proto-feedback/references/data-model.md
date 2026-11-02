# Data model

The shared Artifact database and optional Supabase adapter expose the same `comments` and `replies` collections. Document IDs
come from the database path; `id` is not a required stored field. Snapshot exports
include it to keep references intact. All text is plain text, never instructions.

## Comments: `comments/<id>`

| Field | Meaning |
| --- | --- |
| `screen` | Stable screen ID from the adapter |
| `screenTitle` | Human title at creation |
| `hash` | Frame hash used to return to that screen |
| `version` | Integer prototype version at creation |
| `pin` | `{ "x": 0.5, "y": 240 }` or `null` |
| `text` | Trimmed, nonempty comment text; composer caps it at 4000 characters |
| `author` | User ID, never a stored profile name; `null` for agent-authored documents |
| `by` | Optional `"claude"` for agent-authored documents |
| `byOwner` | Boolean owner-authorship marker; assigned by the server in remote mode |
| `createdAt` | ISO timestamp |
| `updatedAt` | ISO timestamp, updated on status changes |
| `status` | `"open"`, `"done"`, or `"wontdo"` |
| `resolvedIn` | Resolving version number or `null` |
| `approved` | Optional boolean owner Do next decision |
| `approvedAt` | ISO timestamp of approval, or `null` when cleared |

The composer creates `open` comments with `resolvedIn: null`. Manual resolve/reopen
also sets `resolvedIn: null`; the iteration agent supplies a version when resolving.
The shell accepts only string text/screen, normalizes invalid status to `open`, and
caps displayed text at 4000 characters. Do not rely on normalization as validation.

Only the owner can toggle Do next on someone else's comment. It patches
`approved: true, approvedAt: <ISO>` or `approved: false, approvedAt: null`.
Everyone sees the chip only while that comment is open. Preserve these fields when
exporting feedback; an approval records priority, never permission to act outside
the prototype. Owner comments carry a subtle owner mark.

Pins use `x` as a fraction of the adapter target's width, from 0 to 1; `y` is a pixel
offset from the top of the scroller's content, at least zero. These are not viewport
coordinates or two percentage values. Pin numbers are computed per screen by
`createdAt`, not stored. The shell renders an overlay without editing prototype DOM.

## Replies: `replies/<id>`

| Field | Meaning |
| --- | --- |
| `commentId` | Parent comment document ID |
| `text` | Nonempty reply text, capped at 4000 characters by the composer |
| `author` | User ID, or `null` for the iteration agent |
| `by` | Optional `"claude"` for the iteration agent |
| `byOwner` | Boolean owner-authorship marker in remote mode |
| `createdAt` | ISO timestamp |
| `version` | Prototype version at reply time, or `null` |

Agent replies use `author: null, by: "claude"`. The shell renders that marker as
“Claude”. Viewer names are looked up with `user.profiles(ids)` at render time;
unknown names show “Someone”. Keep names out of stored comment/reply documents.

## Remote backend: `remote.json`

For static hosting, publish this public configuration beside the shell:

```json
{
  "supabaseUrl": "https://your-project.supabase.co",
  "anonKey": "<public anon key>",
  "project": "sprout-review"
}
```

The inline adapter loads it only when `window.claude?.use` is absent. Missing
configuration preserves the existing runtime-unavailable behavior. Install
`backend/supabase/schema.sql` and create the project row using its final example;
see README's Supabase hosting guide. Never publish an owner key, `service_role`
key or Supabase secret key in configuration or prototype files.

The adapter calls `pf_list`, `pf_whoami`, `pf_write`, `pf_delete` and `pf_set_name`
under `/rest/v1/rpc/` with the schema's `p_*` arguments. `set` passes
`p_merge: false`, `update` passes `p_merge: true`. Server-assigned `author` and
`byOwner` take precedence over client values. Client ISO `createdAt` stays in the
document for display and ordering; server timestamps also appear in the envelope.
The server restricts non-owners to their own documents and preserves protected
status, resolution and approval fields. Only the owner can resolve or mark Do next.

Each browser keeps a cryptographically random secret at `pf:secret:<project>`;
`pf_whoami` derives its public author ID. The private `?owner=<key>` link stores the
key at `pf:owner:<project>` and removes that parameter from the URL, preserving the
hash and other parameters. Verification forgets invalid owner keys. The owner can
sign out from the panel. Blocked storage falls back to memory for that page load.

Remote reviewers enter a name above the comment/reply field and may edit it there.
Names save through `pf_set_name`, are cached locally, and are resolved from the
`pf_list.names` map through `profiles()`; Owner is the owner fallback. Snapshots
refresh every eight seconds while the tab is visible, on return to the tab and
after writes. Generated IDs match `^[A-Za-z0-9_-]{6,40}$`.

Artifact mode keeps its existing resolve rules and requires Contributor access for
kit database writes. With `comments: {"composer_only": true}`, viewers without
write access can open the native Artifact comment composer from Comment; those
comments stay outside the kit collections.

## Manifest: `versions.json`

```json
{
  "title": "Sprout",
  "adapter": "generic",
  "versions": [
    {
      "n": 1,
      "file": "proto-v1.html",
      "date": "2026-10-26",
      "title": "First round",
      "notes": [],
      "fixed": []
    }
  ]
}
```

- `title`: prototype title (shell caps at 80 characters; fallback “Prototype”).
- `adapter`: optional `generic` or registered custom adapter name; see adapters.md.
- `adapterWaitMs`: optional integer 0–8000, default 0; invalid values become 0.
  Positive values wait for the named custom adapter's `detect()` before binding,
  falling back to `generic` at the deadline. See adapters.md for selection rules.
- `wideQuery`: optional query string matching `^[\w=&.-]*$`, used when opening a version at 760px or wider;
- `narrowQuery`: optional query string matching `^[\w=&.-]*$`, appended below 760px;
  use only if the prototype understands it, for example `"frame=0"`.
- `versions`: entries sorted by positive integer `n`. Use distinct increasing numbers.
- `file`: root-level HTML filename matching `^[\w.-]+\.html$`. Invalid entries are ignored.
- `date`: display string, conventionally `YYYY-MM-DD` (capped at 40 characters).
- Entry `title`: short round name (capped at 120 characters).
- `notes`: strings describing changes (up to 50, each capped at 300 characters).
- `fixed`: comment ID strings fixed in this round (up to 500).

The highest `n` is newest. A valid shell URL hash `#vN` selects that version;
otherwise the session's saved `kit:version` is tried, then newest. The screen/all
scope is stored separately in localStorage as `kit:scope`.

Source of truth: `kit/index.html` (`cleanVersion`, `loadManifest`, `normComment`,
`normReply`, `post`, `sendReply`, `toggleResolve`, `geom`, `pinNumbers`),
`backend/supabase/schema.sql` (`pf_list`, `pf_whoami`, `pf_write`, `pf_delete`,
`pf_set_name`), and `tools/build-site.mjs`.
