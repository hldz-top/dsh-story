---
description: "Final local checks after the four-kind presentation change, historical fixture evidence and the failed real-model acceptance."
---
# Migration validation

The [research-reference repair](research-repair-validation.md) records the subsequent source changes and their current validation. The presentation-change checks and package fingerprint below predate that repair.

Recorded on 2026-09-11. The final local checks below passed after all four-kind presentation code changes. The one authorized real-model run then **failed during its first research stage**, before any settings, outlines, bodies or automatic reader documents existed; see [real-model validation](real-model-validation.md). It was not restarted or resumed. Local tests and historical fixture UI results do not establish successful real-model or current-policy browser acceptance. A fresh successful three-chapter run without repairs requires eight automatic documents, limited to complete `settings`, `book-outline`, `chapter-outline` and `body` versions.

<a id="final-local-checks"></a>

## Presentation-change checks before the research repair

After all four-kind presentation code changes, the integration task executed the following commands from this independent repository on local Node **24.18.0**, against its installed public dependencies:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

| Check | Recorded result |
| --- | --- |
| `npm run typecheck` | Exit 0 for Host, Client, tests and the public Client declaration check. |
| `npm run lint` | Exit 0. |
| `npm test` | Exit 0: **517 Vitest tests across 30 files**, Vitest duration **47.18 seconds**, followed by **36 Node tests**: 9 Client build/declaration cases and 27 offline profile-adapter cases. |
| `npm run build` | Exit 0. |
| Built package inspection | **63 files**, **102,646 archive bytes**, **574,013 unpacked bytes**, SHA-1 `30cdaca3e534c0fb3972585391975f9f455b4584`. Runtime files, declarations and bundle patch are present; source, tests and secrets are excluded. |

The exact `npm test` script runs `vitest run && node --test tests/build-client.test.mjs tests/profile/fixture.test.mjs`. The 27 profile-adapter cases exercise deterministic responses, including explicitly constructed observation records; their success does not establish native collector or browser execution by itself. This final aggregate includes the four-kind presentation changes and is separate from the overlapping focused snapshots below. It does not establish live-model or browser acceptance.

An earlier full-suite attempt exceeded the 15-second test timeout. Under full load, the complete three-chapter case measured **21,061 ms**. The [Vitest configuration](../../vitest.config.ts) now allows **60,000 ms** for each test and hook; behavior assertions were retained. The final `npm test` above passed with this configuration. These timings describe the local concurrent suite and are not production latency estimates.

Package inspection followed the [documented local packing procedure](harness.md#packaging); no publication or private CLI installation is implied. The fingerprint identifies the inspected archive before this validation-document update; no documentation-only repack was performed. The earlier Web validation used the existing built DSH **`0.1.5-rc.1-aa8262e-dirty`** host. The adjacent source checkout's rc.2 version does not identify that built host or extend the compatibility evidence.

The earlier pre-change aggregate also passed 517 Vitest and 36 Node tests, with a 34.96-second Vitest duration. Its package had 63 files and 102,703 archive bytes, SHA-1 `a9e41886ae1b70927a44f7f046f8c20d689b3460`; those historical measurements are not the final fingerprint above.

## Earlier Web evidence

The integration task reported evidence covering **92 preview files** under the previous broad stage-presentation policy. Preserve those files, receipts and historical readback evidence. They do not establish the new eight-document automatic path or the absence of newly presented internal results. The [browser record](post-development-validation.md) distinguishes those historical observations from current pending acceptance. The real-model run failed before the eight-document path; its final failed-page DOM read did not complete because automatic approval review timed out. No current-policy browser pass is claimed.

## Retained focused suites

These focused commands also predate the narrowed automatic presentation scope and ran from this independent repository against its installed public DSH packages. The native fixtures replace model responses and external web providers with deterministic local implementations; they do not call production models. Every count below belongs only to the listed command, and the scopes overlap.

### Native pipeline and lifecycle

```sh
node node_modules/vitest/vitest.mjs run tests/writing-runner.spec.ts tests/writing-runner-lifecycle.spec.ts --configLoader runner --cache=false
```

Focused result: **8 passed, exit 0, 15.55 seconds**, reported by the runner implementation task after stage-delivery integration. Covers three consecutive reviewed chapters within 3,000–5,000 counted words, retained invalid-output repair, short-body repair, blocking-review exhaustion, completed-request replay, stop/unknown permission/resume, shutdown during an admitted start, and interrupted cross-dimension repair. The model and public native execution path are deterministic; selected lifecycle cases delay a real public operation after it completes to expose the race.

### Earlier run storage, tools and upstream revision snapshot

```sh
node node_modules/vitest/vitest.mjs run tests/run-tools.spec.ts tests/run-store.spec.ts tests/writing-revisions.spec.ts --configLoader runner --cache=false
```

Earlier result, before the final service-limit and stage-delivery integration: **78 passed across 3 files, exit 0, 10.58 seconds**. The 54 run-store cases use real JSON/SQLite persistence, exact raw outputs, immutable request identity, captured limits, recovery authorization and corruption admission. The 21 native tool cases cover typed request/results, workspace ownership, bounded Unicode pages, catalog planning and run controls. The three native revision scenarios independently cover a settings dimension, book outline and chapter outline: revise only the named upstream version, retain stale historical body/continuity, replay without new child requests, then explicitly update to new current versions.

A TypeScript program using the project's test configuration and seeded with `src/run-tools.ts`, `src/run-store.ts`, `src/writing-runner.ts`, `tests/run-tools.spec.ts`, `tests/run-store.spec.ts` and `tests/writing-revisions.spec.ts` reported **zero diagnostics**. Scoped oxlint over those files exited **0**. These checks are narrower than the repository's four final scripts.

### Run storage and public tools after limit integration

```sh
node node_modules/vitest/vitest.mjs run tests/run-store.spec.ts tests/run-tools.spec.ts --configLoader runner --cache=false
```

Result: **88 passed across 2 files, exit 0, 3.17 seconds**, at 11:34 on 2026-09-11. This includes 66 real JSON/SQLite run-store cases and 22 native public-tool cases. It adds exact seven-field service-limit snapshots, version-1 to version-2 novel-run migration, explicit legacy null limits, retained old-output read limits, pre-migration corruption refusal and native legacy metadata/resume refusal. The tool fixture mounts real native Present and the delivery projection.

### Restored limit and unload regressions

```sh
node node_modules/vitest/vitest.mjs run tests/writing-runner-limits-review.spec.ts --configLoader runner --cache=false
```

Result: **3 passed, exit 0, 0.684 seconds**, at 11:33 on 2026-09-11. Changed chapter bounds and changed research limits reject before altering stopped state or retry authorization. Unloading the actual Story plugin during native work waits for stopped state before closing its storage. Scoped lint for this test and `tests/run-tools.spec.ts` exited 0. These three tests were executed separately from the 88 above.

### Native presentation failure and recovery

```sh
node node_modules/vitest/vitest.mjs run tests/writing-delivery-recovery.spec.ts --configLoader runner --cache=false
```

Result: **2 passed, exit 0, 4.46 seconds**, reported by the runner task at 11:49:49 on 2026-09-11 after both cases first reproduced failures. The actual native pre-execution policy denies one presentation in each case. Resume delivers a retained domain-admitted blocking collection review before repair, while a structurally valid but unadmitted raw review instead repeats admission and repairs its next review attempt. Both reuse the first saved raw response without new requests to its completed child. Scoped TypeScript for the two-case test and scoped lint passed before the production repair; the pre-change aggregate above subsequently covered that integrated source.

### Stage cards, wire parsing and Client closure

```sh
node node_modules/vitest/vitest.mjs run tests/client.spec.ts tests/client-run.spec.ts tests/client-run-result.spec.ts tests/stage-delivery.spec.ts --configLoader runner --cache=false
node --test tests/build-client.test.mjs
```

Reported by the Client implementation task at 11:28 on 2026-09-11: **44 passed across 4 Vitest files** and **9 passed in the separate Node command**, both exit 0. The scope covers explicit preview cards, running Story cards, exact owning-call filtering, repaired and rejected-output entries, malformed projection/results, locale behavior, browser closure exports, unsupported runtime imports and public Client types.

The Client task also ran `node node_modules/typescript/bin/tsc -p tsconfig.client.json --noEmit` and `node scripts/check-client-types.mjs`, both exit 0. The compiler checker confirmed the actual projection hook returns `StoryStageDeliveries | undefined`. These are component, parser and closure checks; no browser or profile result is implied.

### Authoritative writing storage

```sh
node node_modules/vitest/vitest.mjs run tests/manuscript.spec.ts tests/settings-service.spec.ts tests/service.spec.ts tests/research.spec.ts --configLoader runner --cache=false
```

Result: **116 passed, exit 0**, reported by the storage implementation task. The scope covers creative briefs, research, settings and manuscript storage, including reviewed application, retained version lineage and real JSON/SQLite readback. This result does not establish the native runner or Client presentation by itself.

### Plugin configuration, base tools and projection

```sh
node node_modules/vitest/vitest.mjs run tests/config.spec.ts tests/tools.spec.ts tests/research-tools.spec.ts tests/projection.spec.ts --configLoader runner --cache=false
```

Result: **73 passed, exit 0**, reported by the integration task. This scope checks mounted configuration, base writing/research tools and filesystem projection. A passing projection test is not proof that a browser opened the complete file.

## Other retained evidence

[Research-log validation](research-log-validation.md) records native web-tool/Session admission and its 47-case collector/helper/tool run. [Stage execution](../api/stage-execution.md#verification) records native child and schema checks. [T01](t01-validation.md), [T02](t02-validation.md) and [T03](t03-validation.md) retain their earlier build, browser and development outcomes, including earlier failing states. Their pending statements describe those historical points; they are not a current inventory of implemented code.

The existing installed `dsh-tool-web@0.1.5-rc.1` was also declared as a runtime peer, retaining its matching development dependency. The [dependency record](t02-stage-dependencies.md) explains this classification-only change. No package download or installation occurred for it, and the existing lockfile importer remained applicable.

The separately approved [stage-preview dependency change](stage-preview-dependencies.md) installed one exact `dsh-tool-present@0.1.5-rc.1` package with `pnpm install --ignore-scripts`, added its peer/dev declarations and declared the already-installed Session projection peer. The Client uses its already-installed Session UI dependency. No additional presenter or Client deliverables package was installed.

## Acceptance still pending

- Repeat the isolated built DSH profile/browser flow under the four-kind policy: create, write, read the eight expected documents to EOF for a fresh three-chapter run without repairs, explicitly inspect internal evidence, revise upstream, inspect impact, explicitly update, restart and reopen historical versions. The [post-development checklist](post-development-validation.md) tracks browser/network/Host evidence and actual rendered bytes. A running host or partial flow does not complete this gate.
- Exercise process-termination recovery at the required durable boundaries. Provider reopening and in-process cancellation tests do not establish an actual killed-process result.
- Resolve the [failed real-model run](real-model-validation.md) through separately approved plugin repair and DNS/environment work. The single authorized attempt is consumed; a new paid attempt needs explicit authorization. Three-chapter quality and human reading remain unverified. The [preflight](real-model-acceptance-preflight.md) preserves the attempted sample and limits, not permission to replay it.
- Validate a fixed-version prebuilt private CLI installation from outside the source checkout, including authentication, exact active version, reload, disable/re-enable and a writing operation. No verified installation address is claimed here.
- Record Linux/Node 22 CI execution and final human UI acceptance when performed.

The previous offline host (execution handle `71301`, port `56677`) stopped with exit 0. At this handoff, the live host (execution handle `74578`, PID `12555`, port `49414`) is retained idle with both model turns ended; no generation restart is authorized. This record starts no process and authorizes no further model use, dependency change, Git action, publication or installation. Later production or fixture changes require the affected checks to run again before their evidence applies to the final source.
