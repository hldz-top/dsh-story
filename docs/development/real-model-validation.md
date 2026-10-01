---
description: "Failed single real-model writing attempt, captured research evidence, proposed repairs and remaining authorization."
---
# Real-model validation

On 2026-09-11, the one authorized real-model attempt **failed during its first research stage**. No fixture was used. It generated no settings dimensions, complete settings collection, book outline, chapter outline, body, applied chapter or automatic reader document. The three-chapter acceptance remains incomplete. The run was not restarted, resubmitted or resumed.

The [preflight](real-model-acceptance-preflight.md) records the original Chinese mystery sample, three chapters of 3,000–5,000 counted words, current saved model route, unlimited currency allowance and finite limits: 80 stage attempts, 32 requests per stage, zero business repairs and one parallel stage. DSH's default tool argument correction and request retry behavior remained enabled. Zero whole-run replay does not mean that native tool correction was disabled.

## Run and evidence

The supported isolated profile used built DSH `0.1.5-rc.1-aa8262e-dirty` and the standalone built plugin. [Final local checks](migration-validation.md#final-local-checks) passed after all four-kind presentation changes; those tests do not establish real-model quality.

| Identity | Recorded value |
| --- | --- |
| Parent Session | `session-66a2dbe1-9fda-46e6-b015-94d89bd25835` |
| Novel | `novel_c870ab2e-c72d-40d5-b4ba-a87761f01386` |
| Writing run | `run_2a4f17e5-8f0c-4b68-960e-f19b63256451` |
| Final state | `failed` |
| Terminal error | `A settings layer could not complete: Research stage requires completed adequate evidence` |

The first child created a plan containing two internal/creative questions and three external questions. Ten native web calls were reserved within the twelve-call allowance. Four searches succeeded and returned 32 source rows; six fetches failed. Two `story_research_results` calls and two `story_complete_research` calls all returned `Native web log fields cannot be verified`. The child then emitted the actual plan ID through successful native `structured_output`, but the plan still had no evidence artifact or outcome. Host admission correctly refused to continue into settings.

The local [sanitized audit](/private/tmp/dsh-story-live-mv2lKM/logs/live-audit.md) and [repair design](/private/tmp/dsh-story-live-mv2lKM/logs/repair-design-review.md) retain event sequences and diagnostic detail. These are local evidence paths, not distributed package assets. Original compressed Session logs, writing records and saved stage output remain unchanged. Source URL query strings, provider-internal reference strings, credentials and authorization headers are not reproduced here.

## Causes and secondary limit

1. **Plugin source admission rejected a whole receipt.** The third successful search, call sequence 26 / result sequence 36, included relative references at source indexes 4 and 7. The native provider passed these strings through; it supplied no authoritative base URL. The [collector](../../src/research-log.ts) requires every search source URL to be HTTP(S), so those two rows prevented all observations from being returned or archived.
2. **Native fetch could not use the local network route.** All six fetches failed with `WEB_BLOCKED_URL` because their hostnames resolved to non-public addresses. A separate read-only DNS check found addresses in `198.18.1.34–198.18.1.39`. The responsible DNS/proxy software was not established. The public-address guard acted before HTTP; there is no evidence that the upstream sites rejected requests or returned content.

All 32 search rows lacked snippets, and none of the fetches produced source text. Relaxing URL validation alone would therefore not establish useful evidence. The frozen `maxResearchSources: 24` is a second plugin-side limit: 32 rows exceed it, and even the 30 absolute references would exceed it. This overflow was not the first observed rejection.

A read-only replay supplied the captured native events to the actual `collectResearchLog` function through an in-memory log-reading adapter. `node --experimental-transform-types --input-type=module` reproduced `research-incomplete` at exactly `sources.4.url` and `sources.7.url`, asserted handle closure and exited 0 in 0.25 seconds. It made no network/model request or storage write. This reproduces the parser failure; it does not validate a repair.

## Approved repair follow-up

The approved local repair separates native receipt decoding from usable-source admission; [repair validation](research-repair-validation.md) records the implementation and checks. Preserve valid HTTP(S) sources and original indexes; retain unresolved references explicitly as rejected audit data with a stable reason, without guessing an origin or creating links. Preserve actual native call statuses and call/result identity. Count accepted and rejected rows within finite bounds, version the durable evidence explicitly, and keep old immutable evidence readable.

With settled observations available, the existing completion service can archive the actual failed or insufficient research. The [program-owned classification](../../src/research.ts) and [stage admission](../../src/research-stage.ts) must still block settings. Titles, model paraphrases, absent snippets and failed fetches cannot become adequate evidence. A regression should cover mixed references, empty excerpts, failed fetches, exact/cap-plus-one bounds, native tools and JSON/SQLite readback.

For a future authorized profile, a proposed `maxResearchSources: 96` covers twelve native calls at the current eight-result search cap, while preserving excerpt, event and artifact-byte limits. The [next-run patch](../examples/research-budget.patch.yml) is prepared but has not been applied to a profile or the failed run's frozen limits.

DNS/environment repair is separate and requires approval of the exact change. Inspect the operator's routing configuration, then restore public DNS answers for direct access or deliberately configure an existing trusted HTTP(S) proxy through DSH's supported launch environment. Do not disable the address guard, guess a proxy, hardcode destination IPs or bypass the refusal through another service. The isolated launcher forwards no proxy variables; the inspection process also had none set, so an accidentally removed known proxy was not established.

The local plugin repair is implemented; no environment change has been applied. The original single-run authorization is consumed; a new paid attempt requires explicit authorization. Do not resume or resubmit this terminal run.

## Usage, UI and process state

The native logs contain seven completed parent assistant responses, twelve child responses and nine additional search-provider request events. No native retry event was recorded; the repeated research-tool calls are identified above. Agent-Session usage totals are 30,262 uncached input tokens, 211,072 cache-read tokens, zero cache-write tokens and 11,605 output tokens. Search-provider subrequest usage was not present in its request events and is excluded. Monetary cost was not recorded and is not estimated.

Earlier offline UI evidence covered 92 preview files before the four-kind policy and remains historical. The real attempt produced zero of the eight expected reader documents. Its final failed-page DOM read did not complete because automatic approval review timed out; no final-page or current-policy UI pass is claimed. [Browser acceptance](post-development-validation.md) and human reading remain pending.

The earlier offline host (execution handle `71301`, port `56677`) stopped with exit 0. During the subsequent approved repair, the idle live host (execution handle `74578`, PID `12555`, port `49414`) was stopped with exit 0 before rebuilding; parent and child turns had already ended. This documentation update starts no service, performs no generation or network request, and changes no runtime state.

A later, explicitly authorized [real-model rerun](real-model-rerun1-validation.md) used the repaired collector and isolated proxy. Native retrieval and evidence archival succeeded, but two planned questions remained insufficient and blocked settings. No reader document was generated.
