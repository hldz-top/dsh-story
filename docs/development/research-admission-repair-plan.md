---
description: "Repair for unnecessary mandatory research, receipt-order evidence starvation and unusable native fetch content."
---
# Research admission and evidence repair plan

Status: implemented and offline-verified; see the [final validation record](research-admission-repair-validation.md). Real-model acceptance remains pending. The [rerun audit](real-model-rerun1-validation.md) owns the observed failure and exact measurements. The user separately approved the DSH host change and the fixed offline dependency addition. No new paid writing run or live website probe is included in this repair.

## 1. Decide research necessity before retrieval

Supply each writing stage with its exact output target, authoritative brief and accepted dependencies. Record whether the output needs external evidence before enabling retrieval. Author-declared genre, tone and fictional choices resolve from those inputs; optional genre taxonomy or marketing comparisons do not become prerequisites for an already specified value. Actual facts needed by the output, such as a real navigation procedure used to resolve an accident, remain external requirements.

Reuse the existing internal/creative findings and `not-needed` outcome. For an input-only decision, expose only the local artifact and research-record tools and refuse web-call reservation in that stage. Do not rely solely on another sentence in the prompt. External questions must identify the unresolved output decision and explain why supplied inputs cannot resolve it. Relevance is still a semantic planning responsibility; schema validation alone cannot prove it. This changes new planning, never the questions or findings of a completed failed plan.

Owners: `writing-runner.ts`, `research-stage.ts`, `research-tools.ts` and their recorded stage-input declarations. Every real required evidence gap continues to block admission.

## 2. Select bounded evidence from verified native logs

Replace automatic receipt-order consumption with source indexes, bounded reading and explicit excerpt selection. `story_research_results` identifies each native call/source, HTTP outcome, available character count and retention state. The `story_read_research_source` operation reads a requested offset and length from the already recorded native result; it makes no web or model request. Reads use exact plan ownership, call identity, source index and Unicode offsets, with configured paging and total read limits.

Completion references the exact selected source ranges for each external finding. The host validates those ranges against native logs and persists their literal text, provenance and truncation state. Keep the existing total evidence cap as a hard bound; source previews and read allowances must also be explicitly bounded. A long first response must not consume all final evidence before later sources can be inspected. A changed source selection format needs a new durable content version and strict version-1/version-2 readers that preserve old bytes and previews.

Owners: `research-log.ts`, `research-tools.ts`, `research.ts`, `contracts.ts`, `service.ts` and evidence rendering. Saved native tool text may itself be truncated; paging cannot recover bytes that DSH never recorded and must report that limit.

## 3. Separate retrieved responses from usable evidence

Preserve non-2xx HTTP results and their actual status for audit, but do not allow a security-verification or error page to satisfy a required factual finding. Distinguish empty content, no selected excerpt, transport failure and decoder failure. Neither a title nor merely nonempty text establishes factual support. Suspicious replacement characters flag a quality problem; their presence alone cannot prove the original encoding or justify rewriting text. Selected passages must support their named question, in addition to passing mechanical provenance checks.

The existing native provider deliberately returns HTTP status as resource data. Keep that transport behavior; strengthen the writing plugin's evidence eligibility and admission instead of redefining every 403 as a transport exception. Preserve DSH native argument correction and request retry defaults, and add no automatic writing rerun.

## 4. Investigate and repair decoding at the DSH owner

The current HTTP provider selects its decoder from the Content-Type charset and otherwise uses UTF-8. Verify HTML-declared encodings using bounded raw-response fixtures before choosing an implementation. Correct decoding belongs to DSH `web-fetch-http`, not a second fetch implementation inside Story. Retain byte, time, redirect and public-address protections, and expose decoding failure rather than accepting replacement-heavy text as sufficient evidence. The failed run did not retain raw response bytes or Content-Type, so the precise cause for those historical pages remains unproven.

This is an explicitly separate host-source change because the migration has kept DSH source read-only. That scope is approved. DSH uses the explicitly approved, already cached `html-encoding-sniffer@6.0.0` dependency with native TextDecoder. Installation was offline with lifecycle scripts disabled; no provider switch or live website request was made.

## Acceptance and order

Validate the plugin planning and evidence work alongside the separately approved host decoding repair. Use public native interfaces and retained logs for offline regressions: an explicit genre needs no web call; a required factual gap still blocks; a 403 never counts as adequate; an early large/corrupted response cannot erase a later selected passage; paged slices match the recorded Unicode text; cap-plus-one fails; v1/v2 records remain byte-identical. Charset fixtures must cover explicit encodings, malformed bytes and truncation without weakening resource limits.

After affected unit, persistence, native-runtime, type, build and presentation checks pass, a separately authorized real run must produce the complete settings, book outline, three chapter outlines and three reviewed/applied 3000–5000-word bodies. Those eight reader documents and their restart readback remain the completion criterion. Passing offline tests is not a claim that every external site will be reachable or every model plan will be correct.
