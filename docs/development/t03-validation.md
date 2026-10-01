---
description: "Partial settings-stage migration, parser and prompt checks, pending dependency installation, and uncompleted acceptance."
---
# Settings and writing-stage validation

Historical record: the results and pending work below describe the source at that execution point. Read [current migration validation](migration-validation.md) for subsequent implementation and named checks; the earlier evidence is retained unchanged.

Recorded on 2026-09-11. T03 and T04 remain in progress. These results do not establish an automatic brief-to-prose writing loop, a successful production-model run, or browser acceptance.

## Implemented and checked

- Six model-output parsers cover settings, review, book outline, chapter outline, body and continuity. They check exact input versions, required review categories, source quotations and chapter/scene coverage. Non-style issues must be blocking; style issues must be advisory. A fulfilled obligation requires evidence from the actual reviewed body.
- Six stage prompts carry the current Story V2 writing responsibilities into DSH's artifact-reader and native structured-output flow. The [prompt migration study](../research/stage-prompts-research.md) records source fingerprints and evidence limits. Prompt tests do not execute a model.
- [Body assembly and counting](../api/body-text.md) preserve scene text and use Story's actual mixed-script counter. The 2,999/3,000/5,000/5,001 boundaries are covered. Length violations remain explicit blockers; no truncation or scene ceiling substitutes for the chapter-total check.
- [Settings service operations](../api/settings.md) store candidates, attach independent reviews and adopt an exact reviewed version under an expected-head check. JSON and SQLite tests cover restart readback, blocking issues, obsolete reviews, stale inputs at adoption, late review publication, and damaged review/adoption status.
- Settings and review documents render full Markdown with version/source provenance and issue details. Rendering and filesystem projection tests are automated evidence, not real browser acceptance.

## Current aggregate results

The following selected aggregate ran after the settings review fixes and parser severity fix:

```sh
node node_modules/vitest/vitest.mjs run tests/service.spec.ts tests/research.spec.ts tests/tools.spec.ts tests/config.spec.ts tests/projection.spec.ts tests/client.spec.ts tests/research-tools.spec.ts tests/settings-plan.spec.ts tests/artifact-markdown.spec.ts tests/stage-output.spec.ts tests/stage-prompts.spec.ts tests/body-text.spec.ts tests/settings-service.spec.ts --configLoader runner --cache=false
```

Result: **170 passed, 6 failed, 0 skipped; 12 files passed and 1 failed.** The six failures are retained in `settings-service.spec.ts`:

- Identical candidate retries after a brief change reject instead of returning the original stale candidate (JSON and SQLite).
- Mutated settings index dimension, input references or research-plan identity is not yet reconciled with immutable candidate content (three cases).
- Candidate publication does not yet verify the current brief's actual stored content (one case).

A concrete repair script is prepared at `/private/tmp/dsh-story-settings-hardening.py`. Its write was not executed: automatic permission approval timed out twice. Explicit approval for this script, or a writable workspace entry for the independent project, has been requested. The remaining failures are not waived or hidden.

`npm run typecheck` exits 2 at the still-unimplemented research collector's four unused parameters. It stops at the Host program, so this command did not complete Client, test-program or public Client declaration checks. Native web and subagent fixtures also require the [pending dependency additions](t02-stage-dependencies.md).

`npm run lint` exits 0 with four unused-parameter warnings in the collector stub. `git diff --check` exits 0; the repository remains uncommitted with untracked project files. No build or package archive was regenerated, no dependency installed, and no model called in this continuation.

## Work still required

- Install the approved fixed dependency additions once authorization arrives, then complete and test native Session-log evidence collection and native subagent execution.
- Apply and verify the prepared settings-source/idempotency repair.
- Integrate stage execution, assembled settings coverage, cross-dimension review and bounded repair.
- Complete book/chapter generation and review, actual continuity application, automatic continuation, cancellation/recovery, upstream impact and explicit downstream updates.
- After feature implementation is complete, execute the [deferred browser and preview checklist](post-development-validation.md), full critical-path E2E, scoped real-model acceptance and private CLI installation acceptance. Their existing authorization boundaries remain in force.

No persistent test server or model job remains running. No commit, push, tag, release or remote publication was performed.
