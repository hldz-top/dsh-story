---
description: "Approved research-reference repair, final local checks, captured-log replay and the remaining network prerequisite."
---
# Research reference repair validation

On 2026-09-11, the user approved the [documented repair](real-model-validation.md). The plugin changes are implemented. The implementation checks and captured-log replay performed no model call, external fetch, writing restart or resume. A subsequent separately authorized single-request network validation is recorded below. The original failed run and its persisted data remain historical evidence; complete three-chapter real-model and browser acceptance are still pending.

## Implemented behavior

- The native collector preserves usable HTTP(S) sources and explicitly records rejected references with unchanged indexes, reference strings, nullable titles and a stable reason. It does not invent origins or treat rejected snippets as evidence.
- Accepted and rejected rows share the source budget. Rejected reference/title text also counts against the evidence-character limit. Bounds reject before publication; empty excerpts and native failures retain their insufficient/failed classification and block settings.
- New evidence has content version 2. Strict version-1 evidence remains readable without rewriting bytes, hashes or historical Markdown. Public types, native tool JSON and explicit research previews include the new collection.
- Planning and results descriptions expose their actual source and evidence limits. An [unapplied budget patch](../examples/research-budget.patch.yml) supplies 12 calls and 96 rows for a newly authorized profile. Current defaults, frozen failed-run limits and native DSH retry behavior are unchanged.

The implementation touches `contracts.ts`, `research-log.ts`, `research.ts`, `research-tools.ts`, `service.ts` and `artifact-markdown.ts`. It adds no dependency, provider, alternative loop or backend. Source and test changes were checked against a local pre-edit snapshot; no Git history was created.

## Tests and build

Run from the independent plugin checkout with the existing installed dependencies on Node 24.18.0:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Exit 0; Host, Client, tests and public Client declarations. |
| `npm run lint` | Exit 0. |
| `npm test` | Exit 0: 540 Vitest tests across 31 files in 46.97 seconds, followed by 36 Node tests. |
| `npm run build` | Exit 0; Client artifact 16.14 kB, 4.55 kB gzip. |

The first `npm test` invocation could not write Vite's configuration cache because the plugin lies outside the current sandbox workspace. The exact command then passed with narrow host permission. Some patch-tool approval attempts timed out without writing; guarded single-file writes completed the authorized edits. A temporary missing `async` in a new test and an overly narrow preview comparison were corrected before the final aggregate.

New regressions cover the captured relative-reference indexes, native tool results and failed/insufficient archival, exact preview reopening, JSON/SQLite restart and v1/v2 coexistence, unchanged old Markdown, malformed durable metadata, upstream native output rejection, Unicode reference bounds and the 95/96-row boundary. Existing cancellation, ownership, provenance and writing-stage admission cases remain in the passing aggregate. Native output validation rejects malformed provider JSON before the collector; its failed result is retained rather than represented as usable evidence.

The rebuilt archive `/private/tmp/dsh-story-research-repair/dsh-story-0.0.0.tgz` contains 63 files, 104,078 packed bytes and 583,581 unpacked bytes, with SHA-1 `9fc4b6eab0ffbd6c6c626fcb2bfc01ba9ef3b32d`. Inspection confirmed version-2 runtime decoding and the new public rejected-reference declarations, and excluded source, tests, local state and secrets. The old failed-run package was not overwritten. This is a local package, not a published or private-CLI-installed release.

## Captured real-log replay

A read-only script decoded all compressed frames of the completed research Session and passed its original native events through the repaired collector. With the original 24-row limit it now reports `research-budget`; with a 96-row limit supplied only to the replay it decodes all 10 observations: four successful searches and six failed fetches, containing 30 usable URL rows and two rejected references at original indexes 4 and 7. Every usable excerpt is still empty, so the actual recorded findings classify as `failed`.

The [sanitized replay result](/private/tmp/dsh-story-research-repair/captured-log-replay.json) records zero model requests, zero network requests and zero runtime mutations. The original compressed log's byte digest matched before and after; final verification also matched both parent and child log digests from the original audit. The Git-ignored reproduction command is `node --experimental-transform-types .codex/spikes/research-repair/replay.mjs`; it reads the historical log and never dispatches its tool calls. This validates decoding and classification, not new research quality or writing completion.

## Network prerequisite and remaining acceptance

The [network route follow-up](network-route-repair.md) matched the active Mihomo configuration and passed native offline routing and address-protection checks. After the user explicitly allowed the proxy only in an independent verification process, a single native fetch returned HTTP 200 with 49,864 HTML characters and no truncation. The process performed no retry, search or model call, restored its prior proxy policy and exited with code 0. The linked record owns the exact command, limits and sanitized result.

No DNS, Clash or running DSH environment was changed. This establishes a working native fetch route for one public page, not research adequacy or writing completion. The single-request authorization is consumed; a new paid writing run requires separate authorization.

The idle isolated host on port 49414 was stopped with exit 0 before rebuilding plugin files; it was not restarted. Historical data and the earlier package remain. No browser session was driven in this follow-up. The previous failed-page automatic approval timeout remains an unverified UI step. Linux/Node 22 CI, full supported-profile and browser validation of the new route, three-chapter human reading and private fixed-version CLI installation were not run. Nothing was staged, committed, pushed or published.
