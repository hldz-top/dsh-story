---
description: "Implemented research admission repair, offline verification evidence and remaining real-model acceptance."
---
# Research admission repair validation

## Result

The approved [repair plan](research-admission-repair-plan.md) is implemented in the standalone plugin and the explicitly approved DSH HTTP provider. This record covers source changes, offline tests and build verification. It does not replace the [failed real-run audit](real-model-rerun1-validation.md): no new real-model writing run or live website probe was executed, and that run still has no settings, outlines or prose.

## Implemented behavior

A local native planning stage reads the exact brief and dependencies, records the output decision and missing external facts, and freezes the research questions. Input-only stages expose local tools; a child execution guard checks the exact research request before effects, and the writing service independently refuses web reservations for plans without external questions. Planning attempts use the existing run limits and persistence. Old saved research attempts retain their recorded inputs and prompts.

Native results produce content-free source indexes. Bounded Unicode pages read existing Session data, with per-page limits and durable cumulative reservations in JSON or SQLite. Completion accepts exact source ranges, copies literal recorded text, and writes version-3 evidence. No early response preallocates the final excerpt allowance. HTTP errors, empty sources and replacement-character warnings remain visible and cannot establish adequate findings. Actual failed calls and required missing evidence continue to block stage admission. The sole writer is `completeSelectedResearch`; historical v1/v2 parsing, classification and Markdown are read-only compatibility paths.

DSH `web-fetch-http` uses the approved fixed `html-encoding-sniffer@6.0.0` dependency for bounded HTML BOM/header/meta detection and native TextDecoder for strict decoding. Malformed byte sequences fail with a preserved cause. Byte truncation withholds incomplete trailing characters, and character truncation preserves Unicode pairs. HTTP error responses remain resource data; existing address, proxy, redirect, byte and time protections remain in place. Historical raw headers and bytes were unavailable, so this repair does not establish the exact charset cause of the previous website responses.

## Final plugin checks

Executed on Node 24.18.0 against the final source and test files, after removing the superseded writer and collector:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed Host, Client, tests and installed public Client declaration checks. |
| `npm run lint` | Passed. |
| `npm run test` | 571 Vitest tests in 34 files and 39 Node tests passed; no skipped Node tests. |
| `npm run build` | Passed Host/Client emission; Client bundle 16.14 kB, gzip 4.55 kB. |

Machine-readable exits and logs are retained locally in `/private/tmp/dsh-story-admission-repair/checks.json` and its adjacent `typecheck.log`, `lint.log`, `test.log` and `build.log`. These are local evidence paths, not installation addresses.

Regression evidence includes native planning and tool-output snapshots, exact index→page→selection→Markdown readback, a later usable source following a large unusable response, HTTP 403 rejection, Unicode positions, cap-plus-one failures, source/Session ownership, cancellation, concurrent quota reservations and restart persistence. Seeded v1 and v2 artifacts remain byte-identical and render identically after reopening alongside new v3 evidence on both storage providers. Offline profile tests reject changed source text, positions and digests. These fixtures validate the execution path; they are not literary-quality evidence.

## DSH host checks

The affected HTTP/provider/tool/fixture suites passed 100 tests across four files. The changed `provider.ts` and `policy.ts` have 100% statement, branch, function and line coverage. Two native Session snapshots replayed successfully, including the new decoded-text case and the affected existing web-search case. The GBK fixture produced the literal text `中文`; malformed UTF-8 produced `WEB_PROVIDER_ERROR`.

`pnpm run build`, `pnpm run doc-sync` (34 gates), `pnpm run hygiene` (16 gates), scoped lint and the built ESM provider smoke passed. Host logs are `/private/tmp/dsh-fetch-decoding-build.log`, `/private/tmp/dsh-fetch-decoding-doc-sync.log` and `/private/tmp/dsh-fetch-decoding-hygiene.log`. The offline dependency install changed only the HTTP package dependency declaration and its three-line lockfile importer edge; all other package versions and importers were unchanged.

## Review, package and remaining acceptance

The Spec review found no actionable gap. The Standards review identified the superseded writable v2 path; it was removed, affected callers and tests were migrated to explicit v3 selections, and the follow-up review found no open issue. The final complete plugin aggregate above ran after that cleanup.

The built local archive is `/private/tmp/dsh-story-admission-repair/dsh-story-0.0.0.tgz`. Its machine-readable package audit verifies the declared Host/type/bundle entries and the new planning/selection modules, and excludes dependency trees, local checkpoints and environment files. The archive is not published or installed in the daily DSH profile; private CLI installation remains a separate acceptance item.

No commit, push, tag, release, model/provider switch or global proxy change was performed. The plugin remains an uncommitted private development project; DSH changes remain local, with unrelated work preserved. Verification processes have exited and no persistent validation server was started. Node 22, Linux, real website behavior, the real three-chapter run and browser/restart acceptance of the eight reader documents remain unverified. The next real run requires its own authorization and a reviewed attempt budget that includes the additional planning stages. Native tool-argument correction and provider retries remain unchanged.
