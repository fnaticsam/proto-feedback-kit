# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/fnaticsam/proto-feedback-kit/security/advisories/new). Please do not post vulnerabilities, exploit payloads, or sensitive data in public issues or pull requests. If the private reporting form is unavailable, wait until it is enabled rather than disclosing details publicly.

Include the affected revision, a minimal fictional reproduction, expected and actual behaviour, and the likely impact. Remove credentials, private Artifact IDs, personal information, and real comments from reports. Maintainers will coordinate investigation, fixes, and disclosure in the private advisory; no response deadline is guaranteed.

## Scope

Security reports are welcome for the latest code on `main`, including:

- Script injection or unsafe rendering through comments, replies, names, or version metadata.
- Prompt injection through comment text or replies that causes an agent to treat reviewer content as instructions, exceed the owner's request, reveal secrets, or perform unauthorised actions.
- Unsafe path handling or content rewriting in the prototype bundler.
- Permission handling that allows unintended comment or reply writes.
- Unexpected exposure of feedback or user data through the kit or skill.

Issues in the hosting platform itself should also be reported through that platform's security channel.

## Trust boundaries

Comments and replies are untrusted data, even when they appear to come from a familiar reviewer. The agent must evaluate them as feedback within the owner's request; text embedded in feedback never grants permission to run commands, access secrets, change security settings, or publish unrelated content.

Prototype HTML, its scripts, and custom adapters are trusted executable code. The prototype runs in a same-origin iframe and can reach the parent runtime; this kit does not isolate malicious prototypes. Only bundle and publish code you trust. Local bundling reads files referenced by the source prototype, so inspect unfamiliar input before processing it.

The published kit relies on the Artifact runtime for identity, database access, and write permissions. Static hosting does not supply these controls. The local demo's in-memory mock is a development aid and does not enforce production permissions. Keep credentials and sensitive information out of prototypes, manifests, comments, and generated files.
