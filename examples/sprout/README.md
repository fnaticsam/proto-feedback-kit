# Sprout example (fictional)

Sprout is a made-up plant-care app, not affiliated with any real product or company, used to show proto-feedback end to end. It has two versions, the comments reviewers left on the first one, and the comments waiting on the second.

## Screens

| Hash | Screen |
|---|---|
| `#/today` | Today's watering and feeding, with the streak |
| `#/plants` | The plant collection, filtered by room |
| `#/plants/<id>` | One plant: when to water, a soil moisture chart, care and history |
| `#/add` | Add a plant |
| `#/settings` | Reminders, away mode and units |

Each version is one self-contained HTML file (inline CSS, JS and SVG, no network requests). It routes on `location.hash` and sets `document.title` on every screen, so the kit's `generic` adapter tracks it without any extra code. Watering, undo, the room filter, the add form and the settings all work; state resets on reload.

## What changed in v2

Reviewers Riley Chen and Jordan Park left six comments on v1 ([`feedback/v1.json`](feedback/v1.json)). Five were fixed in v2:

- **Bigger watering targets.** The small check circles on Today became 52 px buttons with a drop or leaf icon.
- **A clearer streak.** The grey "6-day streak" caption became a row of the last seven days; today's dot fills in when everything is done.
- **Readable "Thirsty".** The light orange label on the plant grid (about 2:1 contrast) is now dark terracotta with a drop (about 6:1).
- **A calmer plant header.** Seven badges and a paragraph became the plant, its kind and room, and when to water. The other facts moved to a Care list below the chart.
- **Waterings on the chart.** Each watering has a drop marker above its jump.

The sixth, a dark theme toggle, was declined with a reply.

## Files

```
v1/index.html             version 1 source
v2/index.html             version 2 source
versions.json             version list for the kit shell
feedback/v1.json          comments and replies on v1, after the v2 rerun
seed/v2-comments.json     open comments and new replies on v2, for the demo and screenshots
```

Both JSON files hold `{ "comments": [...], "replies": [...] }` in the kit's document format (see `SPEC.md`). Each document carries its `id`, so the files can be passed straight to the dev harness as `seed`.

## Run it

```sh
npm install
npm run demo
```

This builds both versions, loads the v1 feedback and the open v2 comments, and serves the shell at http://localhost:4174/#v2. Comments live in page memory, so a reload resets them. `npm run shots:readme` captures the README screenshots from the same demo.
