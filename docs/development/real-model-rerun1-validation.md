---
description: "Authorized real-model rerun after research and proxy repairs: successful native retrieval, archived insufficient evidence and no generated reader documents."
---
# Real-model rerun 1 validation

On 2026-09-11, the user authorized one new three-chapter attempt after the [research repair](research-repair-validation.md) and [single-request proxy validation](network-route-repair.md). The real Web conversation submitted the prepared prompt once. The run ended **failed** in `settings/0/a1/research`; it produced no complete settings, book outline, chapter outline, body or applied chapter. No second writing request, resume, revise, update or model switch followed.

## Execution and isolation

The new home and workspace live under `/private/tmp/dsh-story-rerun1-dOPik1`. Saved model, reasoning, token settings and managed credentials were copied without changing the source configuration. The UI and durable Session header confirmed the existing `DeepSeek-V41-Flash` / `High` selection. The supported built CLI reported version `0.1.5-rc.2`; the Web UI displayed its existing build label `0.1.5-rc.1-aa8262e-dirty`. No matching-build or rebuild claim is made from those labels.

All 60 plugin build files matched the repaired archive with SHA-1 `9fc4b6eab0ffbd6c6c626fcb2bfc01ba9ef3b32d`. The actual profile mounted no fixture or retry interceptor. DSH native correction and retry defaults remained enabled. The profile used a process-local HTTP/HTTPS proxy at `127.0.0.1:7897`, with loopback direct, 12 research calls, 96 source rows and the unchanged 16,000-character evidence limit. Other limits remained 80 stage attempts, 32 requests per stage, zero business repairs, one parallel stage and a 600,000 ms stage deadline. The currency allowance remained unlimited.

The first sandboxed host startup exited with `EMFILE` during file-watcher setup, before any Session or model call. The unchanged launch command succeeded with narrow host permission. A bare unauthenticated browser URL returned 401 and the browser reported `ERR_BLOCKED_BY_CLIENT`; the normal token login opened the page. The workspace was registered through the supported authenticated Workspace API, selected in Web, and the prompt was submitted with one Send click. The final DOM showed the failed writing result and an empty manuscript. Browser console/network capture, reader previews, restart readback and three-chapter human acceptance are not claimed.

| Identity | Value |
| --- | --- |
| Parent Session | `session-a2919a5b-39a7-4838-8e06-389a63b1d737` |
| Research child | `6b52c631-9e34-4566-901c-5a530298c510` |
| Novel | `novel_4da221ed-1de6-4002-ac0c-591c3e29135d` |
| Run | `run_b4e8b121-873c-44a8-9881-ab97765d14fd` |
| Writing request | `live-the-last-light-rerun1-write-46e4d5b9` |
| Terminal error | `A settings layer could not complete: Research stage requires completed adequate evidence` |

## What the real calls established

Four searches returned 32 rows without snippets. Four native fetches completed with HTTP statuses 200, 403, 200 and 200; none had the earlier `WEB_BLOCKED_URL` DNS failure. Native tool results were not marked as execution errors: the HTTP provider returns non-2xx status as resource data, so a 403 result is not usable source content merely because the tool completed.

The repaired collector retained 35 HTTP(S) source rows and one rejected reference, within the configured 96-row cap. `story_research_results` at sequences 62–63 and `story_complete_research` at 67–68 both succeeded. Version-2 evidence was archived, and the child returned its plan through `structured_output` at 77–78. This validates real mixed-reference decoding, retrieval and evidence persistence after the repair. The native child attempt completed, but host admission correctly rejected its `insufficient` research outcome; child execution success is not writing acceptance.

The five findings classified as follows:

| Question | Scope | Result |
| --- | --- | --- |
| q1 | The exact supplied brief | Adequate; external research not needed. |
| q2 | The author's stated genre and realism choices | Adequate; external research not needed. |
| q3 | Published realist-mystery genre conventions | Model marked adequate; classifier accepted the cited nonempty evidence. Semantic source attribution was not independently certified. |
| q4 | Island/closed-circle conventions | Insufficient; search excerpts were empty and the selected Baidu page returned 403 security verification. |
| q5 | Near-future publishing-category boundaries | Insufficient; its cited search results had no recorded excerpts. |

The model acknowledged that the brief already states the genre and that the unresolved classification questions have limited impact on that choice. Nonetheless, it made them external questions in the plan, and the current acceptance rule requires every planned question to be adequate. The actual prompt permits internal and creative questions without external lookup; it does not mechanically require all three kinds. The planning decision and strict all-question admission together caused this stop.

## Evidence quality and retention

| Native fetch | HTTP | Recorded text characters | Retained characters | U+FFFD characters in retained text |
| --- | ---: | ---: | ---: | ---: |
| China News | 200 | 14,222 | 14,222 | 5,007 |
| Baidu encyclopedia | 403 | 205 | 205 | 0 |
| China Writers | 200 | 2,898 | 1,347 | 843 |
| NetEase | 200 | 33,836 | 0 | 0 |

The retained excerpts total 15,774 characters; the rejected reference and title consume another 226, exactly exhausting the 16,000-character limit. `sourceRecord` allocates the shared budget in receipt order. Consequently the first, heavily corrupted text consumed most capacity, while the later NetEase response retained no excerpt. Its zero retained U+FFFD count does not establish clean original text. This is evidence of allocation pressure, not proof that retaining more text would resolve q4 or q5, which cite different calls.

Mojibake is observable in the native results. The receipts do not preserve response headers or raw bytes, so the exact upstream charset/decoder cause is not established and was not investigated with another request. No address guard was disabled, no 403 was bypassed, and no failed finding was relabeled as adequate.

## Read-only verification and usage

`node /private/tmp/dsh-story-rerun1-dOPik1/logs/audit.mjs` exited 0. It decoded every compressed frame, verified all three artifact byte/character counts and SHA-256 digests, reproduced the actual `insufficient` classification using the built implementation, checked q4/q5, and verified one create, one write, no resume/revise/update and both terminal `turn/end` events. A temporary audit-only call incorrectly included stored `outcome` fields in the model-input validator; correcting that adapter to match production admission resolved the local script error without changing runtime data or validation.

The [sanitized audit](/private/tmp/dsh-story-rerun1-dOPik1/logs/terminal-audit.json) records exact call/result sequences, scope and retained-content counts. There were four completed parent Assistant responses, ten child responses and eight additional native search-provider request events. `request/header` is a configuration event, not a per-model-request counter. No retry event was recorded. Agent-Session usage was 70,115 uncached input tokens, 288,640 cache-read tokens, zero cache-write tokens and 7,243 output tokens. Search-provider subrequest usage and monetary cost were not recorded; no billing estimate is made.

## Proposed next repair, not implemented

The [repair plan](research-admission-repair-plan.md) defines the proposed implementation scope and acceptance checks.

- Require the research plan to justify why each external question is necessary for the assigned output. User-specified genre and fictional choices should resolve from their authoritative inputs; optional market taxonomy should not become a mandatory precondition. This rule applies before executing a new plan, never by rewriting this failed plan.
- Specify bounded source retention that preserves useful coverage across the required questions, exposes exhausted capacity and supports explicit selection or paging. Increasing only the source-row allowance cannot address the separate character limit. Regression cases must cover an early oversized source, a 403 page and a later useful response without inventing excerpts or weakening failure checks.
- Investigate charset handling separately at the native fetch owner with captured raw-response fixtures, if that host work is approved. No DSH source change or additional fetch is authorized by this report.

The isolated host on port 52809 was stopped after the terminal-page check and exited with code 0. Final readback matched both Session log digests from the audit. The authorized rerun is consumed. The first failed run and this run remain immutable evidence. Plugin source was unchanged during this attempt, so the previous 540 Vitest plus 36 Node tests are historical implementation checks, not new rerun results. New repair implementation and another paid attempt require explicit authorization; no files were staged, committed, pushed or published.
