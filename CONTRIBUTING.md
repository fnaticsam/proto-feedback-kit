# Contributing

Small, focused improvements are welcome. Discuss larger changes in an issue first, and follow the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities through the [security policy](SECURITY.md), rather than a public issue.

## Setup

Use Node.js 22 or newer. From a local checkout:

```sh
npm install
npm run demo
```

The demo uses the fictional Sprout prototype and an in-memory mock of the Artifact runtime. It does not need access to a live Artifact.

## Checks

Run these before opening a pull request:

```sh
npm test
npx playwright install --with-deps chromium
npm run e2e
```

For shell changes, check desktop and phone widths, light and dark themes, pins after scrolling, version switching, replies, resolve/reopen, and read-only access. Add focused regression coverage when behaviour changes. Regenerate affected README screenshots with `npm run shots:readme`.

## Single-file kit

Keep the shipped shell in `kit/index.html`: its HTML, CSS, and JavaScript belong in that one file. Do not introduce a shell build step, framework, or required external runtime dependency. Prototype versions, `versions.json`, assets, and optional custom `adapters.js` remain separate published files. Preserve the [adapter and storage contracts](SPEC.md) and stable test hooks.

Changes to the review workflow should also update [the skill guide](docs/skill.md) and [skill instructions](skills/proto-feedback/SKILL.md).

When a project improves its copy of the shell or skill, port the general improvement back here in the same piece of work, with tests and a changelog entry; keep app-specific code in that project's adapter.

## Fictional data only

Use fictional names, products, comments, screenshots, and assets in fixtures and examples. Sprout is a fictional plant-care app; the dummy reviewers are Riley Chen (`riley`) and Jordan Park (`jordan`). Never include real customer content, private prototype links or IDs, credentials, personal information, or internal tooling details. Check screenshots and generated HTML as well as source files.

## Pull requests

1. Create a branch from `main` and keep the change focused.
2. Make the change, update relevant documentation, and run the checks locally.
3. Open a pull request explaining the problem, resulting behaviour, and checks run. Include screenshots for visible changes, using fictional data.
4. Address review feedback and keep checks passing before merge.

Use a clear title that describes what changes for users. Add a short entry to [CHANGELOG.md](CHANGELOG.md) for user-facing changes. Avoid committing generated test output or unrelated formatting changes.
