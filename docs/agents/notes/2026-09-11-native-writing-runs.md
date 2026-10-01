# Agent Note: Native writing runs and reviewed publication

Status: orchestration, persistence and generic native publication have retained test evidence. The narrowed four-kind automatic presentation policy requires fresh validation; the earlier aggregate and Web observations do not cover it.

## Problem

An automatic writing request spans research, dependent settings, outlines, prose, reviews and continuity. A native child can finish before its parent publishes a candidate, and a host can stop before recording the outcome. Replaying that work blindly may duplicate provider requests or apply content against changed inputs. Upstream revisions must preserve history without implicitly authorizing downstream rewriting.

## Decision

The [writing runner](../../api/writing-runner.md) uses DSH's existing in-process subagent capability. It persists each attempt before native startup and awaits the child's durable association before admitting its first model stream. Raw structured output becomes durable before domain parsing and publication. Session logs retain the model-visible prompt and tool evidence; metadata queries do not repeatedly embed long documents.

The writing service owns immutable domain artifacts and reviewed application. The separate [run store](../../api/writing-runs.md) uses the same host storage facility for per-novel run histories and exact raw-output records. Content is saved before references, and record admission verifies identity, digests, counts and lineage. One queued novel update publishes reviewed body and continuity references together. No cross-record transaction or shared multi-process writer guarantee is assumed.

A successful native attempt establishes saved output, not literary approval. Resumed blocking feedback requires the corresponding domain-admitted review; a saved raw response alone cannot authorize repair progression. Canonical parsers, program-owned chapter counting, evidence-bearing reviews and exact current input/head checks govern application. Each repair receives a distinct attempt and preserves its predecessors. Repair loops, native requests and retained attempt counts have explicit finite limits.

`write` handles the normal dependency path; `revise` replaces one exact current upstream version and stops; `update` explicitly authorizes affected downstream work. Immutable artifact IDs, digests and `revisionOf` establish lineage. Stale descendants remain readable until an update produces and applies new reviewed versions.

## Recovery and consequences

Stop prevents new work, propagates cancellation and awaits native child disposal. Earlier applied chapters remain applied. Persisted running runs reopen as interrupted without launching children. An attempt with no durable result is unknown, including a crash before child association; this makes no statement about execution or cost. Explicit resume may reuse saved output, while replacing unknown work requires author permission and consumes the retained attempt budget.

The original parent Session is retained on each attempt so another Session in the same workspace can validate recovered child research. Exact prompt/input/schema identity prevents a retry from silently changing what the saved attempt requested. Execution limits and all seven writing/research service limits remain captured; resume rejects a service-limit or chapter-bound mismatch before changing durable progress or retry authorization. Version-1 novel-run records migrate to version 2 with an explicit missing service snapshot; they remain readable but cannot resume. Model selection stays with the current DSH parent route.

A single awaited plugin disposer cancels and drains the runner before closing run and artifact storage. Separate Cordis effects do not imply sequential asynchronous teardown.

Stage publication writes the complete immutable projection before executing native `present`, verifies its known delivery event and awaits Session durability before dependent work continues. A pure Session projection supplies live per-call Client file actions. Automatic runner publication selects only complete `settings`, `book-outline`, `chapter-outline` and `body` documents, including eligible repair versions. Research, dimensions, reviews, continuity and rejected raw responses remain stored for audits and explicit reads. Generic publisher APIs and historical delivery receipts remain readable; a full preview does not establish application. Tool policy, cancellation and projection failures remain visible; file previews never become authoritative writing input.

Separate run and artifact records require validation and orphan-output reconciliation. Reconciliation accepts only the output belonging to the exact attempt; it cannot substitute a different completed child or infer success from idle status. The plugin therefore retains more history than a latest-text-only implementation, while avoiding a second execution framework or database service.

## Alternatives considered

**A second Story or plugin-owned AgentLoop.** DSH already owns native tools, logging, model routing and cancellation. A second loop would duplicate those responsibilities and make observed request limits and lineage harder to establish.

**Success flags or model approval alone.** Structured capture cannot enforce current source identities, chapter length or applied continuity. Those checks remain owned by typed domain admission and queued publication.

**Automatic downstream rewrite after any edit.** An upstream edit records new intent but does not authorize replacing all descendant writing. Explicit update scope preserves the author's ability to inspect impact and retained history first.

## Verification and remaining scope

[Native runner tests](../../../tests/writing-runner.spec.ts), [lifecycle tests](../../../tests/writing-runner-lifecycle.spec.ts) and the [revision matrix](../../../tests/writing-revisions.spec.ts) exercise actual DSH child execution with deterministic model output. [Run-store tests](../../../tests/run-store.spec.ts) use real JSON/SQLite reopening and durable corruption cases. See [dated validation](../../development/migration-validation.md) for exact executed scopes.

The [delivery tests](../../../tests/stage-deliveries.spec.ts) and [Client card tests](../../../tests/client-run.spec.ts) exercise native delivery, persisted-event projection and full-file actions independently. [Recovery regressions](../../../tests/writing-delivery-recovery.spec.ts) retain the public recovery cases; their earlier results used the broad presentation policy. The four-kind runner changes and affected fixtures require new executed evidence. These results do not establish real-model writing quality, killed-process recovery, private installation or the complete browser flow.
