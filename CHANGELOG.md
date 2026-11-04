# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - Unreleased

### Added

- Separate owner keys for hosted feedback, with independent author IDs, display names and rate limits, plus a repeatable PostgreSQL fresh-install and upgrade check.
- Optional Supabase feedback on static sites, with browser identities, editable display names, private owner links and visible-tab polling.
- Owner Do next approvals and owner marks on comments, plus a native Artifact comment composer for viewers without shared-database write access.
- A dependency-free static site builder with no-index, no-referrer and cache headers, and a Supabase hosting guide.
- Feedback opens on demand from a Leave feedback pill or a narrow-screen bar, with a current-screen open-comment badge, remembered visibility, `?panel=1` and once-per-version change notes.
- Generic hash prototypes can supply a screens rail through `window.kitScreens` and select web or phone positioning with `window.kitSide`.
- Optional adapter-driven screens rail at the window’s left edge, with side switching, reset and a `wideQuery` manifest setting.
- Optional `adapterWaitMs` manifest setting for named custom adapters that initialize asynchronously, with a bounded readiness wait on each version load.
- A contribution rule to return general shell and skill improvements with tests and a changelog entry while keeping app-specific code in project adapters.

### Changed

- Web feedback overlays the unchanged prototype and moves aside for pins; phone feedback undocks the screens rail, narrow change notes fit one line, and Screens opens a mobile sheet.
- Feedback starts closed, its header fits the title, version and info/close controls in one row, and pins appear only while feedback is open without changing stored coordinates.
- Fixed-comment links in version notes now use one line with an ellipsis, retaining their full accessible names and navigation.
- The screens rail is now a floating card with rounded corners and a shadow, with the side tabs on top. It stays docked open beside phone screens on wide windows, and a "Hide screens" button folds it to a tab with a chevron, which is remembered. On web screens it folds to the tab and opens on hover.

## [0.1.0] - Unreleased

### Added

- A single-file feedback shell for clickable HTML prototypes published as Artifacts.
- Screen-level comments, positional pins, threaded replies, and resolve/reopen controls.
- A version picker with change notes and links to fixed comments.
- Desktop and phone layouts, including a mobile feedback sheet.
- A generic hash-route adapter and optional custom adapter registration.
- A Node.js bundler for self-contained prototype version files.
- A feedback-to-next-version skill for Claude Code and Codex, plus a Claude Code plugin marketplace.
- The fictional Sprout example, a local mock runtime, unit tests, and Playwright checks.
- Public documentation, contribution and security policies, issue forms, and CI.
