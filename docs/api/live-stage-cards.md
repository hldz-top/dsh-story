---
description: "Live version links in native writing Tool cards, backed by the host's Session projection."
---
# Live writing-stage cards

The Client registers `StoryRun` for `story_write`, `story_update`, `story_revise` and `story_resume` in DSH's existing `tool.call.toolview` slot. The slot supplies the actual Tool `callId`, its running or settled record, the Session file opener and the Session-scoped `useProjection` hook. The Client requires `uiSession`, `slots` and `locale`; it introduces no workbench, model call, polling loop or automatic file opening.

## Live documents

The card subscribes to the host-computed `story-stage-deliveries` projection while the owning Tool is running. Its browser-safe [shared parser](../../src/stage-delivery.ts) owns the wire fields. The card admits the complete value and selects only the entry whose `callId` equals the actual owner. For new automatic writing, the runner publishes only complete `settings`, `book-outline`, `chapter-outline` and `body` documents. Eligible repair versions retain separate ordered rows; publication does not establish review or application. A fresh three-chapter run without repairs contributes eight documents. Internal research, dimensions, reviews, continuity and rejected raw responses remain stored for explicit reads.

The Client renders valid committed receipts rather than applying its own artifact-kind filter. Historical or explicitly published deliveries can therefore include internal artifact kinds or rejected raw output; those links remain readable. Host descriptions identify the exact source and version. A raw rejected output carries an attempt identity and failed-validation label; it is not an admitted artifact.

Each button passes the recorded path unchanged to the owning Session's `openFile` callback. Displaying a link does not imply that its document was opened. Missing projection data displays a waiting state; an empty call entry displays no delivered documents. Malformed data provides no file actions. The Client neither invents paths nor substitutes current versions for historical ones.

## Run outcomes

The settled Tool result's JSON determines whether a writing request completed, failed, stopped or was interrupted. Transport success alone is insufficient: a valid returned run with `status: failed` remains a failure. Unsupported result data and contradictory completion/error fields cannot display completed status. Already delivered document links remain available for failed, stopped, interrupted and malformed final results.

## Verification

The [run-card tests](../../tests/client-run.spec.ts) exercise live accumulated versions, call ownership, exact click paths, rejected output labels, failure preservation and English controls through the public component props. The [run-result tests](../../tests/client-run-result.spec.ts) cover every supported status and malformed JSON. Existing preview-card behavior remains covered separately.

The earlier component checks remain evidence for generic receipt rendering, not validation of the newly narrowed runner policy. Final profile acceptance must observe the four eligible document kinds before the parent Tool settles, open full eligible and repaired versions, and confirm no new automatic internal-result or rejected-output links appear. Then reload the Session and verify exact historical document bytes. Existing historical receipts remain readable. A fresh successful three-chapter run without repairs has eight automatic documents; browser and native policy validation must be recorded separately.
