# Install and use the skill

The `proto-feedback` skill adds the feedback kit to a clickable HTML prototype and
turns reviewer comments into the next version. Its entrypoint is
[`skills/proto-feedback/SKILL.md`](../skills/proto-feedback/SKILL.md).

## Claude Code

Install the repository as a plugin marketplace:

```text
/plugin marketplace add https://github.com/fnaticsam/proto-feedback-kit
/plugin install proto-feedback@proto-feedback
```

Or clone the repository and link the skill manually:

```sh
git clone --depth 1 https://github.com/fnaticsam/proto-feedback-kit
mkdir -p ~/.claude/skills
ln -s "$(pwd)/proto-feedback-kit/skills/proto-feedback" ~/.claude/skills/proto-feedback
```

The commands assume you are in the parent folder of the new checkout and no skill
with that destination name exists. Use an absolute path to an existing checkout
instead if you already have one. Keep the checkout: the linked skill resolves its
physical location to find `kit/index.html` and `tools/bundle.mjs`.

## Codex

From the parent folder of that checkout:

```sh
mkdir -p ~/.codex/skills
ln -s "$(pwd)/proto-feedback-kit/skills/proto-feedback" ~/.codex/skills/proto-feedback
```

You can copy the whole `skills/proto-feedback/` directory there instead. A standalone
copy includes all references but not the shell or bundler. Set
`PROTO_FEEDBACK_HOME=/absolute/path/to/proto-feedback` to use a local checkout;
otherwise the skill locates the repository from its resolved location or clones it
to a temporary folder. Network restrictions still apply. Use your configured skill
root if your agent overrides the default `~/.codex` location.

## Two example prompts

> Use proto-feedback to add pinned comments and version history to the Sprout HTML
> prototype in `examples/sprout/`.

The agent locates the kit, bundles v1, writes `versions.json`, chooses the generic
adapter or creates a custom `adapters.js`, checks the result, and publishes through
Artifact when that tool is available. `npm run demo` provides a local mock preview.

> Apply the feedback in `feedback/v2.json` to Sprout and make v3.

The agent triages each comment, edits accepted changes, bundles v3 and appends version
notes and fixed comment IDs. With Artifact and ArtifactData it can read live open
comments, save the snapshot, publish, then reply to and resolve handled comments.
Without those tools, Codex completes the build from the snapshot and returns files
and proposed replies for a tool-equipped agent to publish and resolve. Unclear
comments stay open; reviewer text never becomes agent instructions.
