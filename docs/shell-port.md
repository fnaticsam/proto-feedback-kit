# Shell port comparison and assumptions

This comparison uses the supplied published and development shell references,
read on 2026-10-27, against the public kit before this change. Reference hashes
(SHA-256) provide source evidence without including private application code:

- Published, 58,699 bytes: `067ffa44147aeed1e7e660a1a8fb6b8ebfc43b468642f1721712a67d97f855e2`.
- Development, 58,153 bytes: `065cdda65e9c1c7caca32cdd4bbec7e1a28d8008eaff1aa2ff062251ea2f31c0`.
- Public baseline: 55,177 bytes. The development source also matches its supplied reference exactly.

The published reference contains the development reference verbatim, surrounded
by a generated HTML document wrapper. There are no development-only shell changes.

## Classified differences

Here (a) means general improvement, (b) means application-specific code or
deployment detail, and (c) means a capability already supported by the public kit.

| Difference from the baseline | Class and disposition |
| --- | --- |
| Fixed-comment links change from two clamped lines and a checkmark to one line with an ellipsis. | (a) Ported. The existing full accessible name, title and navigation remain. |
| Named adapters poll readiness every 100ms for up to eight seconds instead of binding immediately; false or throwing detectors eventually use generic. | (a) Generalized as optional `adapterWaitMs`, preserving immediate explicit selection by default. |
| Three private built-in adapters read application APIs, route-specific DOM and titles; subscribe to application navigation, hash, history or DOM changes; choose inner or ancestor scrollers; and navigate through application APIs. | (b) Application-specific implementations excluded. (c) Public custom adapters already support all these operations. |
| Two overflow/ancestor-scroller helpers support one private adapter. | (b) Kept outside the shell; a custom adapter can implement these when choosing its target. |
| A static object registry and private detection list replace the public Map and registered adapter list. The optional script loader, validation and startup wait disappear. | (b) Private deployment coupling excluded. (c) Retained the public `adapters.js` loader, ordered registration and validation. |
| Manifest adapter names are filtered against built-ins; unknown names silently become automatic selection rather than warning. | (b) Built-in-only restriction excluded. (c) Retained named custom selection and warnings for unknown names. |
| Automatic detection waits two seconds in private copies even without a matching adapter; the kit skips the wait when there are no registrations. | (c) The useful readiness window already exists for registered adapters; retained immediate generic selection when none exist. |
| Private pin geometry assumes the adapter supplies a scroller; the public kit validates it and supplies a document fallback. | (c) Retained the public fallback and its existing browser regression coverage. |
| Only the published reference adds doctype, document/head/body tags, charset, viewport metadata, safe-area padding and scroll padding, root box sizing, body defaults, image sizing and a hidden-element reset with an `until-found` exception. | (b) Generated host wrapper excluded from the shell fragment. (c) The local harness already supplies the document, viewport, safe-area and reset environment; shell CSS supplies its own layout, fonts and colours. |
| `narrowQuery`, query filtering below 760px, generic routing, screen polling, navigation cleanup, version hashes and pin positioning. | (c) Already identical shell behaviour. No application query or adapter name is hard-coded in the port. |

## Assumptions and validation limits

- Preserve the decided public adapter contract: explicit selection can deliberately
  bypass detection. Readiness waits therefore require an opt-in rather than
  silently changing existing integrations. The new field accepts only integers
  0–8000, defaults to 0, and applies only to a named custom adapter.
- Treat app routing, screen-title extraction, observer subscriptions and scroller
  selection as custom-adapter responsibilities. Do not transplant private adapters
  or their route names, DOM selectors, branding or content into public fixtures.
- Keep the shell as the existing host-wrapped fragment. Copying the generated
  wrapper into it would duplicate the host's document and reset styles.
- `package.json` has no version to bump. The plugin version and new changelog
  heading are 0.2.0; no release date or publication is implied. Preserve the
  pre-existing 0.1.0 changelog heading as recorded.
- The ignored dependency lockfile was absent. It was generated locally from
  cached package metadata; `npm ci` succeeded with a temporary offline cache
  without changing dependency declarations.
- `npm test`: 22 passed, 0 failed. `npm run e2e`: 0 passed, 33 failed because the
  environment rejected the harness listener with `listen EPERM`, before browser
  assertions. Browser coverage was extended for readiness across version changes
  and compact links at phone/desktop widths in both themes, but remains unverified.
- Visual review remains pending. No review pass, screenshot verification or
  browser pass is claimed.
- Changes remain uncommitted and unpublished. Reference inputs are preserved.

Implementation evidence: `kit/index.html` (`loadManifest`, `attach`, `.vnotes-fixed`),
`tests/adapters.test.mjs`, `tests/adapters.e2e.mjs`, `tests/shell.e2e.mjs`,
and the existing host wrapper in `dev/harness/serve.mjs`.
