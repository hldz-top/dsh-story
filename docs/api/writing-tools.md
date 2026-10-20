---
description: "Native logged writing commands, run controls, settings and manuscript metadata, and exact stage-output pages."
---
# Writing tools

## Scope and ownership

[run-tools.ts](../../src/run-tools.ts) registers these tools through Cordis effects. The native DSH tool runtime validates their declared argument and result schemas, records calls/results in the Session log, and supplies ordinary tool cards. Registration disposal removes every contribution. The module delegates execution to [WritingRunner](../../src/writing-runner.ts), progress persistence to [RunStore](writing-runs.md), and artifact ownership to [WritingService](../../src/service.ts).

Every operation derives its actor from the actual calling Session and its filesystem-resolved workspace. Neither arguments nor a parent Session can substitute another workspace. Sessions sharing the same workspace can inspect the same novel and run history. Tool inputs do not contain filesystem paths, provider credentials or model selectors. Host configuration owns execution limits and model selection.

## Writing and upstream changes

The command schemas require every field below; there is no implicit chapter range or selection of all dimensions.

| Field | Meaning |
| --- | --- |
| `novelId` | Exact novel in the calling workspace. |
| `briefArtifactId` | Exact current creative brief used to admit the request. |
| `requestId` | Per-novel idempotency key. Repeating an identical request returns its run; changing its fields rejects. |
| `settingsRoots` | Nonempty unique enabled dimension codes. Dependency closure is resolved by the planner; external editor dimensions reject. |
| `chapterCount` | Positive total planned book chapters. |
| `fromChapter`, `throughChapter` | Explicit inclusive scope satisfying `1 <= fromChapter <= throughChapter <= chapterCount`. |

`story_write` runs the requested writing range through research, settings, outline, chapter outline, prose, review, bounded repair and publication. `story_update` explicitly authorizes updating that range after upstream changes while retaining previous versions. Both commands wait for terminal progress or failure and capture configured execution limits at admission. While another run is running or interrupted they are refused with `active-run`; the sentence names that run and the last line is `{"code":"active-run","runId":"run_…"}`, so it can be passed to `story_stop` or `story_resume`. The exact implemented orchestration is owned by [the runner](../../src/writing-runner.ts); these tools do not apply generated text independently.

`story_revise` requires the same fields plus `baseArtifactId` and `instructions`. The base identifies the exact upstream artifact to revise; instructions must be nonblank, well-formed Unicode within the run's UTF-8 byte budget. The runner validates the supported upstream target. The recorded run has `mode: revise` and immutable `revision: {baseArtifactId, instructions}`. Revising upstream content preserves history and marks affected descendants; it does not authorize downstream rewriting. Use a separate `story_update` request for that work.

## Run control and progress

| Tool | Required arguments | Result and behavior |
| --- | --- | --- |
| `story_get_run` | `runId` | Exact stored run and all stage-attempt metadata. |
| `story_list_runs` | `novelId` | Creation-ordered run history after verifying novel ownership. An existing novel without runs returns an empty array. |
| `story_stop` | `runId` | Cancels the owned run and awaits native quiescence before returning its persisted state. Already terminal runs retain their result. |
| `story_resume` | `runId`, `retryUnknown` | Resumes saved progress with captured limits. The boolean is required: `false` refuses uncertain native outcomes; explicit `true` authorizes replacing such attempts. Completed runs cannot resume. A run whose stored `settingsRoots` lack a required setting is refused with `settings-incomplete` and left unchanged, unless the operator bypass `allowIncompleteSettings` is set. A run whose closure holds an import awaiting review is refused with `import-refused` (`pending-review`, items in `importItems`); when both apply, `settings-incomplete` is reported and its last line also carries `runId` and `importItems` with the same items. A different unfinished run holding the novel is refused with `active-run`, whose last line `{"code":"active-run","runId":…}` names the holder. |

Run results include the complete immutable request, `id`, `status`, initiating/resuming Session IDs, captured storage and execution limits, exact `serviceLimits`, nullable failure reason, and attempts. Attempt metadata includes `id`, original `parentSessionId`, stable stage `key`, exact `inputRefs`, status, nullable child Session ID, retry authorization, failure reason and nullable output reference. [Writing runs](writing-runs.md) owns the exact field types and recovery rules. `serviceLimits` exposes the seven captured writing/research bounds documented there, or explicit `null` for migrated version-1 runs. Legacy runs remain readable and stoppable but cannot resume or replay as a new native invocation; missing original limits are never inferred from current configuration. Stored stage prompts, response schemas and raw generated strings are excluded from progress results. A succeeded attempt only means its raw output was saved; acceptance remains a separate parsing/review/publication decision.

Reads and stop are marked concurrency-safe; the runner and storage service own same-novel execution and write serialization. An Agent's tool concurrency flag does not provide cross-Session locking. Failures become ordinary failed native tool results; these tools do not substitute empty success objects.

## Settings and manuscript metadata

`story_get_settings(novelId)` returns `{novelId, applied, history}`. Every settings entry exposes `dimensionCode`, nullable `revisionOf`, exact `artifact`, `inputRefs`, `childSessionId`, `status`, `stale` and nullable `review`. Status distinguishes candidates, reviewed/blocked versions and applied versions. Full settings content remains in the referenced artifact. Each entry also has derived `origin` (`stage`, or `import` for author text; records written before imports report `stage`) and `pendingReview` (an import no passing assembled-settings review has covered yet).

`story_settings_import(novelId, requestId, dimensionCode, expectedAppliedId, output)` is registered only when the plugin config `allowSettingsImport` is `true`. See [Importing author settings](../../README.md#importing-author-settings) for its rules and machine-readable refusals.

`story_get_manuscript(novelId)` returns `{novelId, history, heads, appliedChapters}`. Candidate entries expose `target`, nullable `revisionOf`, exact `artifact`, `inputRefs`, nullable `childSessionId`, `status`, nullable `review`, `stale`, `changedInputs`, nullable `wordCount` and nullable `length`. The target identifies a settings collection and its selected codes, a book outline and chapter count, a numbered chapter outline/body, or numbered continuity with its exact body ID. Length reports `within-range`, `too-short` or `too-long` with the associated blocking flag.

Applied chapter entries expose chapter number, exact body/body-review and continuity/continuity-review references, captured `wordBounds`, actual `wordCount`, staleness and changed inputs. `obligations` contains only `{id, status}` summaries. Explanations, quotations and full prose remain in immutable artifacts accessible through `story_read_artifact` and `story_preview`. Metadata does not silently publish candidates or choose a newer artifact version.

Artifact references contain `id`, `kind`, `revision`, full UTF-8 `sha256`, Unicode code-point `chars` and UTF-8 `bytes`. Input references contain only exact `artifactId` and `sha256`. [Stage output validation](stage-output.md) and the service types own the detailed domain invariants.

## Selecting settings dimensions

`story_settings_catalog` accepts optional `settingsRoots`. With no roots it returns all enabled, non-external catalog choices and `plan: null`; it selects nothing. With explicit roots it returns the same choices and `{selectedCodes, layers}` for the dependency closure. Empty, duplicate, unknown, disabled or external roots reject.

Each choice contains `code`, the original Story `name`, `dependsOn`, `enabled`, original `kind`, historical `requiredFor`, transitive `pullsIn`, and `closureSize`. Wizard requirements never add roots implicitly; the `novel_writing` markers define the codes the [required settings gate](../../README.md#required-settings) checks before `story_write`, `story_update` and `story_revise` start work. `selectedCodes` and each topological layer are code-sorted; dimensions in one layer have no dependencies on one another. [The settings planner](../../src/settings-plan.ts) owns closure and ordering.

## Exact raw-output pages

`story_read_run_output` requires `runId`, `attemptId`, nonnegative integer `offset`, and positive integer `limit`. The limit cannot exceed `WritingService.limits.maxReadChars`. Offsets and page sizes count Unicode code points, preserving emoji and other supplementary characters. An offset at EOF is valid; an offset past EOF rejects.

The result contains `runId`, `attemptId`, full-string UTF-8 `sha256`, full-string UTF-8 `bytes`, `totalChars`, requested `offset` and `limit`, exact page `text`, `nextOffset`, and `eof`. Concatenate pages using `nextOffset` until `eof` to recover the full original string. EOF reads return an empty string with unchanged offset. The store validates the complete durable output and its reference before pagination. Raw model output is untrusted content and may contain malformed JSON or writing defects; reading it does not make it an accepted artifact.

## Validation boundary

[The tool tests](../../tests/run-tools.spec.ts) use installed DSH ToolRuntime/AgentLoop capabilities, isolated JSON storage, the actual writing service and runner, and a deterministic local adapter. They test logged metadata, exact Unicode output pages, input refusal, stopped-request replay, required retry permission and workspace isolation through public interfaces. Persisted stage outputs are seeded through the real RunStore for reader tests; these tests do not claim to generate complete chapters or establish real-model quality.

```sh
node node_modules/vitest/vitest.mjs run tests/run-tools.spec.ts --configLoader runner --cache=false
node node_modules/oxlint/bin/oxlint src/run-tools.ts tests/run-tools.spec.ts
```

Complete writing orchestration, process recovery, browser interaction and paid-model quality require their separate integration evidence.
