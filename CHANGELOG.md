# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - Unreleased

### Added

- Optional `adapterWaitMs` manifest setting for named custom adapters that initialize asynchronously, with a bounded readiness wait on each version load.
- A contribution rule to return general shell and skill improvements with tests and a changelog entry while keeping app-specific code in project adapters.

### Changed

- Fixed-comment links in version notes now use one line with an ellipsis, retaining their full accessible names and navigation.

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
