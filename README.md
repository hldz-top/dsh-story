---
description: "Independent novel writing, reviewed versions and durable writing runs through DSH."
kind: "package-bundle"
---
# DSH Story

## Summary

DSH Story is a standalone TypeScript plugin for researched settings, book and chapter outlines, chapter prose, review and repair, and actual story continuity. It runs through DSH's existing tools, native subagents and JSON or SQLite persistence without a Story backend or Python runtime. The automatic writing and upstream-revision paths have deterministic native-runtime test evidence; final package, browser, real-model and private-installation acceptance remain separate work. See the dated [migration validation record](docs/development/migration-validation.md). The [research admission repair record](docs/development/research-admission-repair-validation.md) documents the current offline checks, literal source selection, historical compatibility and native HTTP decoding repair. Real-model acceptance remains pending.

## Table of Contents

- [Writing workflow](#writing-workflow)
- [Reading and previews](#reading-and-previews)
- [Local development](#local-development)
- [Host integration](#host-integration)
- [Limits and distribution](#limits-and-distribution)
- [Further reading](#further-reading)

## Writing workflow

Create a novel with a title and creative brief, then use the explicit novel and brief identities returned by the tools. Session selection is a convenience; creation does not select a novel, and writing requests name their novel explicitly. Projects, brief versions and writing history survive provider reopening.

`story_write` plans the requested settings dependency closure, researches and reviews its dimensions, reviews the assembled settings, and advances through the book outline and requested chapters. Each chapter passes body review and actual continuity review before its body and continuity references apply together. Chapter-length violations, missing required events, settings or character contradictions, and continuity conflicts block progression; style advice alone does not. No per-stage approval is required.

`story_revise` changes one exact current settings dimension, book outline or chapter outline. It preserves earlier versions and stops after adopting that upstream change. `story_get_settings` and `story_get_manuscript` expose stale outputs and changed inputs. `story_update` explicitly authorizes rebuilding the requested affected range; merely changing upstream content does not start downstream writing.

`story_stop` cancels owned work and waits for child cleanup. `story_resume` reuses durable stage results and requires an explicit `retryUnknown` choice before any unresolved native attempt can be replaced. It refuses changed writing/research limits before changing stored progress; legacy runs without a limit snapshot remain readable but cannot resume. The [writing tools](docs/api/writing-tools.md) document all command arguments and returned fields.

### Required settings

`story_write`, `story_update` and `story_revise` refuse a new request before any settings, book outline or chapter work when the dependency closure of `settingsRoots` lacks a setting whose catalog `requiredFor` includes `novel_writing`. Those codes are `a1` (类型 / 题材), `a2` (流派 / 子类型), `a3` (受众), `a4` (风格基调), `a5` (时空设定), `e1` (主角设定), `g1` (金手指) and `g2` (主线). `settingsRoots: ["a4", "a5", "g2"]` covers all eight through dependencies.

A blocked request stores no run. An empty `settingsRoots` is treated the same way and lists all eight codes. The check looks only at which settings the roots select, not at the text of settings already applied; the settings stage itself rejects blank output. The failure has two machine-readable parts:

- The host records `error: { "name": "SettingsIncompleteError", "code": "settings-incomplete" }` on the tool result (`tool/result` event), outside the model-facing text.
- The tool result has `isError: true` and the text `Error: <sentence>` followed by one JSON line, for example:

  ```text
  Error: Required novel settings are missing: g2 (主线). Complete the settings first: choose settingsRoots whose dependencies cover it; ["a4", "a5", "g2"] covers every required setting.
  {"code":"settings-incomplete","missing":["g2"]}
  ```

  Scripts that see only the result text (such as headless `--json` output) should parse the last line; `missing` lists the codes in catalog order. The host's structured error carries only the name and code, so the missing list travels in the text.

The plugin does not set a process exit code. In the headless DSH used for smoke runs, the process exits 0 even when a story tool fails, so scripts must check the tool result rather than the exit status. `story_resume` continues an existing run and is not re-checked.

The only bypass is operator-side: the plugin config option `allowIncompleteSettings` (default `false`), for smoke and unit tests. It is not a tool argument, so the model cannot set it.

## Reading and previews

Tool results provide typed metadata and exact version references. Models read complete text through bounded `story_read_artifact` pages, following `nextOffset` until `eof`; retained raw stage output has a separate bounded reader. References contain identity, digest and size metadata rather than full document text.

`story_preview` projects an exact stored artifact into a versioned Markdown file. Its existing card opens the recorded path through DSH's Session file opener. Research, settings, outlines, prose, reviews and continuity have full document renderers; preview-file edits do not alter authoritative versions.

Automatic writing cards show complete documents for only four artifact kinds: assembled settings (`settings`), `book-outline`, `chapter-outline` and `body`. Eligible candidate and repaired versions retain their exact identities; a preview does not imply review or application. A fresh three-chapter run without repairs produces eight documents: one settings collection, one book outline, three chapter outlines and three bodies. Research, individual dimensions, reviews, continuity and rejected raw responses remain stored for audits and explicit reads, without new automatic links. Historical delivery links remain readable. Validation of this narrowed presentation policy is pending in the migration record.

## Local development

Use the approved installed dependencies and Node engine declared in [package.json](package.json). Run from this repository:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

The [development guide](docs/development/harness.md) explains scope, isolated fixtures and package checks. The [offline profile fixture](tests/profile/README.md) supplies deterministic responses for supported DSH profile tests; it does not measure model writing quality.

## Host integration

The plugin registers `ctx.story`, `ctx.storyRunner` and their tool consumers through Cordis. It requires the host's `storageDomain`, `tools`, `fs`, `subagents`, `sessions` and `sessionPersistence` and `sessionProjections` capabilities. The actual writing Agent must also have the native `present` tool available. The host owns the model route, native spawn provider, web providers and access policies. [Runner configuration](docs/api/writing-runner.md#configuration) controls finite research, execution, repair and text limits. The default chapter range is 3,000–5,000 Story-counted words.

The writing service owns immutable documents and applied references; a separate `story_runs` domain owns attempts and raw output. Both use the existing host storage facility. [The orchestration decision](docs/agents/notes/2026-09-11-native-writing-runs.md) explains durable execution, history and publication.

## Limits and distribution

One host owns each writing facility; simultaneous writer processes sharing storage are not supported by the verified deployment. Native fixtures establish execution and persistence behavior, not literary quality or large-book performance. The required three-chapter real-model run, full browser acceptance and final human review remain pending.

The manifest declares a built DSH composition bundle. No verified fixed-version private installation address is supplied yet. Distribution is designed around the existing DSH CLI and a prebuilt private release; [the installation study](docs/research/private-cli-install-research.md) separates that design from actual release and authentication evidence. Browser, OS-protocol and Desktop installer enhancements are outside scope.

## Further reading

- [Writing runner](docs/api/writing-runner.md): orchestration, configuration, cancellation and repair.
- [Writing service](docs/api/writing-service.md), [manuscript](docs/api/manuscript.md) and [writing runs](docs/api/writing-runs.md): authoritative versions and durable state.
- [Stage deliveries](docs/api/stage-deliveries.md) and [readable Markdown](docs/api/readable-markdown.md): versioned document previews.
- [Domain terms](docs/specs/story-writing-plugin/CONTEXT.md) and [specification](docs/specs/story-writing-plugin/spec.md): requirements and acceptance criteria.
