# Data model

The shared artifact database has `comments` and `replies` collections. Document IDs
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
| `createdAt` | ISO timestamp |
| `updatedAt` | ISO timestamp, updated on status changes |
| `status` | `"open"`, `"done"`, or `"wontdo"` |
| `resolvedIn` | Resolving version number or `null` |

The composer creates `open` comments with `resolvedIn: null`. Manual resolve/reopen
also sets `resolvedIn: null`; the iteration agent supplies a version when resolving.
The shell accepts only string text/screen, normalizes invalid status to `open`, and
caps displayed text at 4000 characters. Do not rely on normalization as validation.

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
| `createdAt` | ISO timestamp |
| `version` | Prototype version at reply time, or `null` |

Agent replies use `author: null, by: "claude"`. The shell renders that marker as
“Claude”. Viewer names are looked up with `user.profiles(ids)` at render time;
unknown names show “Someone”. Keep names out of stored comment/reply documents.

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
`normReply`, `post`, `sendReply`, `toggleResolve`, `geom`, `pinNumbers`).
