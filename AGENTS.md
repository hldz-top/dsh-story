# DSH Story development harness

This repository owns the standalone novel-writing plugin. Read [the specification](docs/specs/story-writing-plugin/spec.md), [domain terms](docs/specs/story-writing-plugin/CONTEXT.md) and [development guidance](docs/development/harness.md) before implementation. Inspect the current files and scripts before making environment or capability claims.

## Scope and ownership

- Keep plugin code, prompts, tests, documentation and release configuration in this repository. Story is a read-only source of domain behavior; DSH is the host integration reference. Do not copy either application wholesale.
- Use DSH Cordis extensions and public capabilities. Do not embed a separate AgentLoop, provider runtime, database service, Story backend or Python engine.
- A required DSH host change is a separate, explicitly scoped task in the DSH repository. A feature of that host is not implemented merely by documenting it here.
- Preserve unrelated work. Do not create or switch worktrees/branches, commit, push, tag, publish releases, install dependencies or transfer files externally without authorization for the relevant action.
- Repository creation does not authorize publishing its contents. Keep GitHub visibility private until the user explicitly changes it. Never put credentials in source, logs, model context or installation URLs.

## Writing invariants

- Distinguish generated candidates, reviewed candidates and applied versions. Apply only the exact reviewed version whose upstream inputs remain valid.
- Required-event omissions, chapter-length violations, settings/persona contradictions and cross-chapter conflicts block completion. Advisory wording, rhythm and style suggestions do not.
- A program-owned counter measures the assembled chapter after every repair. The acceptance run requires 3000–5000 words under the specified Chinese counting rule; no hardcoded scene ceiling replaces this rule.
- Derive final continuity from prior applied facts and actual reviewed prose. A chapter outline is a plan, not an event that has happened.
- Publish chapter and reviewed continuity references together. Persist referenced content first; never assume cross-record transactions or cross-process writer safety without evidence.
- Preserve historical versions when upstream content changes. Mark affected descendants and show why; downstream repair requires an explicit update request.
- Failures remain failures. Do not hide missing inputs, failed research, review defects, persistence errors or interrupted model requests behind empty defaults or success flags.

## Implementation

- Use TypeScript strict mode and ESM, explicit package exports and complete declared dependencies. Published code must not depend on sibling checkout paths or source-only aliases.
- Define public command/query behavior and acceptance cases before implementation. Use TDD through those interfaces and the real DSH tool/runtime path rather than private graph node calls.
- Keep model/provider selection under DSH configuration; never hardcode or silently switch it. Validate finite research, repair and execution limits before a run.
- Register contributions through Cordis effects and remove them on disposal. Keep model-visible input reconstructable from DSH Session logs.
- Allow independent reads/research to overlap. Protect same-novel writes with service-owned revision checks and existing storage serialization; one Agent's exclusive tool flag is not a cross-Agent lock.
- Stop means no new work, cancellation propagation and awaited quiescence. Late results cannot commit after stop. Explicit resume uses durable progress and does not silently resend outcome-unknown model calls.
- Authoritative content lives in the writing service's storage. Versioned Markdown previews are rebuildable projections with scoped file access, not an alternate writable source of truth.
- Validate tool/model JSON, persisted records and wire inputs at their owning boundaries. Keep the synchronous same-process TypeScript path typed; avoid speculative fallback layers.

## Verification and handoff

- Include relevant public behavior tests, real JSON/SQLite readback, failure cases and model-visible Session snapshots in each task. Use isolated homes/workspaces and deterministic barriers for concurrency tests.
- Run declared typecheck, lint, tests and build checks relevant to the change. Do not invent passing results or call a fixture-only run real-model quality evidence.
- For GUI changes, verify the real DSH conversation/card/preview flow, browser console, network and host logs. Provide final human acceptance material; follow the DSH repository's GIF rule when submitting a GUI-changing PR there.
- Verify built installation from outside the source checkout, then reload, disable and re-enable the plugin. Verify private artifact authentication and exact version readback before advertising an installation link.
- Confirm paid model run scope and budget before execution. Do not automatically replay an uncertain paid call.
- Keep local state under .codex/task-state, .codex/tickets and .codex/spikes; exclude these through .git/info/exclude and never stage them. One active checkpoint per session records decisions, tasks, failures, commands and next action.
- Final reports name completed work, actual checks, skipped validation, residual processes, Git status and remaining acceptance. A skeleton repository is not a working plugin.
