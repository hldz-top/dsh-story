---
description: "Current validation of T02 research, its no-lookup tool flow, T03 catalog planning, and pending dependencies."
---
# T02 development validation

Historical record: the results and pending work below describe the source at that execution point. Read [current migration validation](migration-validation.md) for subsequent implementation and named checks; the earlier evidence is retained unchanged.

## Current conclusion

The research domain service, actual conversation flow without external lookup, research Markdown reopening, and settings catalog planning pass local tests. T02 is incomplete: real search-log admission remains an explicitly failing development stub, and the [complete dependency inventory](t02-stage-dependencies.md) awaits installation authorization. Settings generation, chapter prose, and the complete writing loop are not delivered.

## Executed validation

2026-09-10, using this independent project's existing Node 24.18.0 and pinned dependencies. The following Vitest command passed 116 tests across 9 files with no skips:

```sh
node node_modules/vitest/vitest.mjs run tests/service.spec.ts tests/research.spec.ts tests/tools.spec.ts tests/config.spec.ts tests/projection.spec.ts tests/client.spec.ts tests/research-tools.spec.ts tests/settings-plan.spec.ts tests/artifact-markdown.spec.ts --configLoader runner --cache=false
```

`node --test tests/build-client.test.mjs tests/profile/fixture.test.mjs`: 12 passed, no skips. Completed source and test changes passed scoped oxlint. Research tool tests use the real AgentLoop, ToolRuntime, approval service, and filesystem; the approval regression's `web_fetch` is an offline dispatch witness, not proof of the real web package, a network provider, or model quality.

JSON and SQLite cover opening and reopening T01 records, research history, concurrent call budgets, Session ownership, stale briefs, cancellation, and close. The tool flow saves an explicit no-lookup decision, completes it, and opens and reopens its exact Markdown. Budget-denial copy has a model-visible snapshot. The settings catalog contains 61 actual dimensions; planning tests cover dependency closure, independent layers, disabled/external dimensions, unknown references, and cycles. This is only the catalog part of T03.

## Review corrections

Spec and Standards reviews found and corrected three issues: reservation now runs in `tools/execute` after approval so approved calls cannot evade counting; completion canonicalizes findings before hashing so equivalent field orders replay. Ordinary Sessions without a writing workspace also retain web access. All three fixes were preceded by failing public behavior tests.

## Failing and unexecuted checks

Host and test typechecks do not pass yet: the research-log development stub has unused parameters, and its fixture lacks pending direct dependencies including `dsh-web` and `dsh-tool-web`. The complete `npm test`, final build, and repack were not run; the passing bounded set is not a full-project pass. No dependency manifest or lockfile changed. Real-model execution, network research, T02 browser acceptance, CI/Linux/Node 22, publication, and address installation remain unverified.

The earlier [T01 evidence](t01-validation.md) belongs to its previous build and does not certify this source. Read-only process inspection found that the previous dedicated Web server PID 44171 no longer exists. This turn started no persistent server. All changes remain local, unstaged, uncommitted, and unpushed.

## Next action

After authorization, run the inventoried `pnpm install --ignore-scripts` once, inspect the actual lockfile, complete red/green validation using real DSH web tools and JSONL admission, then rerun the independent plugin checks and continue settings generation. The remaining real UI and preview-reopening acceptance is deferred until implementation is complete; it is tracked in the [post-development checklist](post-development-validation.md). Dependency authorization does not authorize real models, Git actions, or publication.

## Continued migration

[Settings and writing-stage validation](t03-validation.md) records the subsequent 2026-09-11 implementation, selected aggregate failures, and remaining dependency and execution limits. Its results supersede any inference that the earlier build represents the current source.
