---
description: "Attempted three-chapter sample and limits; the single authorized real-model run failed and cannot be replayed without new authorization."
---
# Real-model acceptance preflight

Status on 2026-09-11: the single authorized attempt **failed during research**, before any reader document was generated. The [real-model validation report](real-model-validation.md) records the outcome and proposed repairs. Preserve this preflight as the attempted sample and execution plan; it grants no new request or resume. The [specification](../specs/story-writing-plugin/spec.md#acceptance) requires one creative brief and three consecutive applied chapters of 3,000–5,000 counted words, with automatic research, generation, review and repair. Proactive previews include only complete settings collections, book outlines, chapter outlines and bodies; internal evidence remains available through explicit reads. The user authorized one real three-chapter run using the existing configured model route with no currency ceiling. The selected sample and limits below applied to that attempt. Native DSH argument correction and request retry behavior remain unchanged. A terminal failed, stopped or interrupted writing run must not be resubmitted or resumed; no replacement writing request is authorized.

## Existing configuration

The local read-only preflight found nonempty saved DSH `provider`, `model` and `reasoningEffort` fields. The managed credential file contains a nonempty standard `DEEPSEEK_API_KEY` reference and one credential record. Corresponding process environment variables and the inspected `.env` files were absent. Only field presence and counts were reported; no credential or selected-model value was printed.

This initial presence check established persisted configuration, not authentication, account balance, model capability, pricing or connectivity; subsequent real request results are recorded in the linked validation report. Preserve the existing selected model and provider. Use a separate supported DSH profile with the built plugin and isolated writing storage; keep fixture providers out of the live configuration. Record the actual built host version and package fingerprint. Do not change the user's default profile or request a replacement key merely because environment variables are absent.

## Selected sample

Working title: **The Last Light**. Write original Chinese prose set on a near-future island. Lighthouse technician Lin Cen investigates maintenance records left by her father, who disappeared three years earlier. There are no supernatural abilities. Characters may reason only from witnessed events and information they have actually obtained; keep their motives and knowledge consistent.

| Chapter | Required events |
| --- | --- |
| 1 | Lin Cen discovers an altered maintenance log and decides to remain on the island. |
| 2 | She verifies a material contradiction and confronts a ferry operator who knows part of the past. |
| 3 | She establishes the cause of a human-made accident and its concealment, resolves the central mystery and makes a consequential personal choice. |

Each chapter must contain complete scenes and dialogue within the 3,000–5,000 range under the [program-owned counter](../api/body-text.md#counting). Planned events are not actual continuity. Required-event omissions, length violations and setting, character or cross-chapter contradictions block application; style advice alone does not.

The attempted execution plan was to create one new novel through `story_create_novel`, then submit one `story_write` request with the returned real `novelId` and current `briefArtifactId`, a fresh novel-scoped `requestId`, `settingsRoots: ["a4", "a5", "e1"]`, `chapterCount: 3`, `fromChapter: 1` and `throughChapter: 3`. These roots currently select six dimensions through the real dependency plan: `a1`, `a2`, `a3`, `a4`, `a5` and `e1`. They cover genre, subgenre, audience, tone/style, time/place and protagonist. Do not generate the entire catalog by default.

## Selected execution limits

The isolated live profile selected the limits below, kept the configured native spawn provider and used a 600,000 ms stage deadline. Record all other execution, storage and service limits before admission. The execution configuration and the seven service limits are retained with the run as described in [runner configuration](../api/writing-runner.md#configuration).

| Run | `maxRunAttempts` | `maxStageRequests` | `maxRepairAttempts` | `maxParallelStages` |
| --- | ---: | ---: | ---: | ---: |
| One authorized three-chapter acceptance | 80 | 32 | 0 | 1 |

These limits target three complete chapters with no automatic business repair. Native tool argument correction, structured-output correction and provider request retries retain DSH defaults; no extra interception plugin or retry-policy override is mounted. Exhaustion saves available failure evidence and does not authorize another run. The six-dimension no-repair path contains 49 native stages: three per dimension, one assembled-settings review, three book-outline stages and nine stages per chapter. This is not an estimate of 49 billable requests. Logged input paging, web-tool rounds and provider retries can require multiple requests per stage.

`maxStageRequests` counts observed child model dispatches, including retries. Parent conversation requests are outside that child allowance. Neither these limits nor DSH's per-response `maxTokens` setting enforce a total currency budget. The authorized currency allowance is unlimited; no monetary cap, estimate or hard spending guarantee is imposed or claimed. Preserve the configured model and output-token settings unless a specific change is authorized.

## Planned execution and evidence

1. Record the approved brief, selected execution limits, unlimited currency allowance, single-execution scope, package fingerprint, actual built host version, parent Session and run IDs, and saved limit snapshots. Keep model configuration and credential reporting redacted.
2. Run the automatic path once. Retain real parent/child Session logs, native research receipts and tool results. A fictional task may honestly report that external sources are unnecessary; do not fabricate sources. Production web evidence requires its actual calls and results.
3. Verify only complete `settings`, `book-outline`, `chapter-outline` and `body` documents appear proactively through the owning Story card before dependent work continues. A fresh three-chapter run without repairs has eight documents; eligible repair versions can add entries. Confirm no new automatic research, dimension, review, continuity or rejected-output links appear. Open the exact eligible versions, read to EOF, and compare the rendered Markdown's actual UTF-8 bytes and digests. Retain and explicitly read internal review and research evidence when auditing the run.
4. Verify three consecutive bodies and their reviewed continuity are applied and current. Save program-owned length counts, required-event coverage, exact reviewed references, blocking/advisory outcomes and evidence from actual preceding prose. No unresolved blocker may be represented as completion.
5. Restart and perform read-only history checks: retain identical IDs, text, reviews and applied heads. Save browser console, network, host/background logs and any failure. A stopped or failed run remains incomplete even when some earlier chapters applied.
6. Record actual request and token usage, separating uncached input, cache reads, cache writes and output. Missing durable output does not establish that no request or charge occurred. Submit the complete three chapters and review evidence for human reading and UI acceptance.

The [offline Web acceptance checklist](post-development-validation.md) separately tracks upstream revision, impact and explicit downstream update; earlier 92-file fixture evidence predates the four-kind scope. A further live revise/update request, repeat run, connectivity probe or outcome-unknown retry consumes additional scope and must be counted in its authorized budget. This live acceptance does not authorize `story_resume`, a second `story_write`, a changed request ID, or model/provider switching after terminal failure. Ordinary native argument correction within the authorized task is allowed.

## Remaining evidence

The prior authorization covered the one attempted run with no currency ceiling and has been consumed. Plugin repair, an exact DNS/environment change and any further paid attempt require their own explicit authorization. Do not restart or resume the failed run. The already agreed three-chapter target, automatic continuation and four-kind proactive previews need no repeated per-stage approval. Three-chapter model quality and human acceptance remain unverified because no reader documents were generated. Private-address CLI installation, publication and Git actions are separate work and are not prerequisites for this isolated live sample.
