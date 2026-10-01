---
description: "Current browser acceptance remains pending after the real-model run failed during research; earlier fixture evidence is historical."
---
# Post-development UI validation

Status on 2026-09-11: current-policy browser acceptance is **not complete**. Final local checks passed after the four-kind presentation change, but the [single real-model run](real-model-validation.md) failed during its first research stage and produced no reader documents. The final failed-page DOM read did not complete because automatic approval review timed out; neither that page nor the eight-document path is claimed as browser-verified. T14 owns the remaining UI acceptance. The separately authorized [rerun](real-model-rerun1-validation.md) also failed before reader output; its final failed-page DOM was verified. Eight-document preview and restart acceptance remain unperformed.

## Evidence boundaries

The earlier offline Web flow covered 92 preview files under the broader presentation policy. Preserve that evidence and its historical receipts; it does not verify the current four-kind policy. The [T02 record](t02-validation.md) also records earlier automated tool-runtime preview reopening, which does not establish browser acceptance. [Migration validation](migration-validation.md) owns the final local check and package results.

The previous offline host (execution handle `71301`, port `56677`) stopped with exit 0. During the [approved research repair](research-repair-validation.md), the idle live host (execution handle `74578`, PID `12555`, port `49414`) was stopped with exit 0 before rebuilding, with both parent and child turns already ended. No generation replay or resume is authorized.

## Complete writing documents

- [ ] In a successful newly authorized run, observe automatic continuation and only complete `settings`, `book-outline`, `chapter-outline` and `body` previews. A fresh three-chapter run without repairs has eight documents; eligible repair versions may add entries.
- [ ] Open each exact saved version through its owning card, read to EOF, close it and reopen it. Compare the rendered Markdown's actual UTF-8 bytes and digest with the file-read response, rather than the underlying JSON artifact's byte count.
- [ ] Confirm no new automatic research, dimension, review, continuity or rejected-output links appear. Internal records remain available through explicit reads.
- [ ] Exercise upstream revise → impact → explicit downstream update → restart. Reopen historical cards and verify the original IDs and full content.
- [ ] Record browser console, network responses, Host/background failures and final human acceptance material. A completion message or running host alone is insufficient.

## Explicit research preview reopening

- [ ] Use actual DSH tools to create a research plan and archive its evidence, including honest failed or insufficient outcomes when applicable.
- [ ] Explicitly open that immutable artifact through `story_preview`, read all rendered Markdown, close and reopen the same card, and verify exact bytes to EOF.
- [ ] After a later version and host restart, reopen the old card without substituting the current artifact.

The [specification](../specs/story-writing-plugin/spec.md#validation-and-delivery) owns acceptance requirements. The failed real-model attempt does not satisfy three-chapter quality or human reading. Proposed local repair, DNS/environment changes, any additional paid writing attempt and private CLI installation remain under their separate authorization requirements.
