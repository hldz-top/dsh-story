---
description: "Native DSH web-tool Session-log admission, evidence limits, cancellation and offline validation results."
---
# Research log admission validation

This record predates the [approved reference repair](research-repair-validation.md). Its passing commands remain historical; the follow-up adds explicit rejected references and content-version-2 evidence.

Recorded on 2026-09-11. The [collector](../../src/research-log.ts) reads actual persisted native `web_search` and `web_fetch` results. This completes the collector implementation; it does not establish real-network research quality, the complete writing workflow, or browser acceptance.

## Admission and evidence

The executing tool must belong to the research plan's Session. The collector captures the current log endpoint, checks the configured call and event limits, calls `ctx.sessions.flush(session)`, then opens a read-only `sessionPersistence` handle. It reads the exact captured interval and closes the handle on success, failure, or cancellation. Cancellation is checked before and after asynchronous reads and after handle closure. A failed durability checkpoint cannot fall back to in-memory events.

Every reserved call needs one native call/result pair. Admission checks call ID, reserved tool name, result source identity, matching turn and step, sequence order, and the result's cited call event. Missing results, reused native IDs and mismatched reservations reject. Later Session surface replacements do not replace the original executed result used as evidence.

Search sources come only from structured metadata on the native result. Provider-generated answers and source titles never become quoted source text. An omitted snippet remains an explicitly empty excerpt. Fetch sources retain the final metadata URL and a bounded excerpt of the rendered native result text, including its HTTP context when retained. The collector derives the display header and truncation footer through the installed public `formatFetchOutput` function. It preserves an excerpt only when the retained body range contains non-whitespace source content. Empty text, empty rendered HTML, display-only truncation and excerpt budgets that stop inside the preamble produce an empty excerpt; omitted display text does not consume the shared excerpt budget. These records retain their full logged-string digest and character count, with truncation indicating omitted recorded text. The requested URL remains in the observation input. Non-2xx responses preserve DSH's native successful-execution status; downstream evidence adequacy is a separate decision.

Usable source URLs must satisfy the HTTP(S) evidence schema; the subsequent repair separately preserves other string references as rejected audit data. Source-count overflow rejects rather than dropping URLs. A shared Unicode code-point budget clips excerpts across all calls; each source retains its complete recorded-string SHA-256, full code-point count, zero-based offset and explicit truncation flag. The digest covers what DSH recorded, not webpage content already omitted by a provider or tool. The event limit bounds logical log admission; a persistence backend may read or decode a larger physical artifact internally.

## Executed checks

Dependencies resolve from this independent repository's installed public DSH packages at `0.1.5-rc.1`, without sibling source aliases. The [fixture](../../tests/support/research-log-fixture.ts) mounts the real AgentLoop, ToolRuntime, native web tools and JSONL persistence. Only the model responses and web providers are local deterministic replacements. A service-shaped plan isolates the collector; this fixture does not establish the complete plan/reservation/publication workflow.

The first real native-search test failed against the previous collector stub, then passed after implementation. Separate native provider-failure, fetch and shared-budget tests failed before their corresponding implementation changes. Six native metadata-only fetch cases subsequently failed against the full-display excerpt implementation, then passed after the formatter-based body-range check.

```sh
node node_modules/vitest/vitest.mjs run tests/research-log.spec.ts tests/research-stage.spec.ts tests/research-tools.spec.ts --configLoader runner --cache=false
```

Result: **47 passed, zero skipped, across three files**. The collector suite contributes 24 cases covering:

- Search source metadata and recorded provider failures.
- Body-bearing fetch text, redirected URLs, HTTP 200 and HTTP 404.
- Empty/whitespace bodies, empty rendered HTML, truncation-only output and preamble-only excerpt limits.
- Actual native empty-body observations remain insufficient even when a finding claims they are adequate.
- Shared Unicode clipping and unchanged complete-content hashes.
- Empty source excerpts, invalid source URLs and source/call/log budget refusal.
- Wrong Session, log interval and reserved tool name.
- A real native call still executing during a concurrent inspection.
- Cancellation through the actual inspecting tool's fused signal and a failed Session durability listener.
- Reused native call IDs and an actual Session surface rewrite after a native result.

The existing three research-tool tests and twenty research-stage helper tests also pass in that run; they are distinct from the collector's native web fixture.

Scoped oxlint passed for the collector, its tests and fixture. A TypeScript compiler program seeded with those three files under the project's `tsconfig.tests.json` options reported **zero diagnostics**. Its initial fixture-return portability error was corrected by declaring the public return type using the installed DSH `Agent` type. These scoped checks do not certify unrelated files or a final package build.

## Remaining acceptance

No production model, external network provider, paid call, browser flow, publication or installation into a user's DSH profile was executed here. Fixture Contexts and temporary directories are disposed after each test; no persistent service was started. Complete research orchestration, writing execution and the deferred browser checks remain part of the parent migration task.
