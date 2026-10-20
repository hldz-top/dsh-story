---
description: "Independent novel writing, reviewed versions and durable writing runs through DSH."
kind: "package-bundle"
---
# DSH Story

## Summary

DSH Story is a standalone TypeScript plugin for researched settings, book and chapter outlines, chapter prose, review and repair, and actual story continuity. It runs through DSH's existing tools, native subagents and JSON or SQLite persistence without a Story backend or Python runtime. The automatic writing and upstream-revision paths have deterministic native-runtime test evidence; final package, browser, real-model and private-installation acceptance remain separate work. See the dated [migration validation record](docs/development/migration-validation.md). The [research admission repair record](docs/development/research-admission-repair-validation.md) documents the current offline checks, literal source selection, historical compatibility and native HTTP decoding repair. Real-model acceptance remains pending.

## Table of Contents

- [Installation](#installation)
- [Writing workflow](#writing-workflow)
- [Reading and previews](#reading-and-previews)
- [Local development](#local-development)
- [Host integration](#host-integration)
- [Limits and distribution](#limits-and-distribution)
- [Further reading](#further-reading)

## Installation

The npm package is `dsh-story-weaver`. Install it into a DSH profile with the DSH CLI (requires Node ≥22.19, DSH 0.2.x and pnpm on `PATH`):

```sh
dsh plugin --profile web add dsh-story-weaver
```

Use `dsh-story-weaver@next` for release candidates. In the DSH web UI you can instead open Plugins → Add plugin and enter `dsh-story-weaver`.

**pnpm version.** Installation is verified with pnpm 11.7.0. With Node 22.19's bundled corepack, the pnpm 12.x that corepack fetches by default (12.14.0 at the time of testing) fails to start (`Cannot find module …/corepack/v1/pnpm/12.14.0/bin/pnpm.cjs`), and `dsh plugin add` fails. Pin the verified version, for example `corepack prepare pnpm@11.7.0 --activate` (or put a `pnpm` shim that runs `corepack pnpm@11.7.0` on `PATH`). If the default `COREPACK_HOME` is not writable, set `COREPACK_HOME` to a writable directory.

**Plugin id and config patches.** The plugin id is `dsh-story-weaver`, the same as the package name; before the npm rename it was `dsh-story`. A config override in a DSH `--patch` file must target the new id, for example `- id: dsh-story-weaver` followed by `config:` (see [docs/examples/research-budget.patch.yml](docs/examples/research-budget.patch.yml)). A patch that still says `- id: dsh-story` matches no entry and is skipped: DSH starts normally and keeps the config the earlier layers gave the plugin, so the override silently does not apply. That includes operator switches such as `allowIncompleteSettings`, which then stays off. A normal run prints nothing about it; only `dsh --dump-config` reports `patch: entry "dsh-story" not found` on stderr. An `insert` patch that mounts the plugin by path and carries its own `config:` is not affected, whatever id it gives the entry.

**A patch's `config:` replaces, it does not merge.** When several layers (the bundle, the profile's `cordis.patch.yml`, then each `--patch` file in order) give the same entry a `config:`, the later block replaces the earlier one as a whole; DSH does not merge it key by key. A `--patch` that sets only `maxResearchSources` therefore resets every other key, including your own `maxRepairAttempts`, `stageTimeoutMs`, `maxRunAttempts` and switches such as `allowIncompleteSettings`, to the plugin defaults, without any warning. Write the full config in the last layer: copy every setting you changed elsewhere into it, as the example does, and check the composed result with `dsh --profile <profile> --patch <file> --dump-config` before starting a run. A run freezes the limits it started with; resuming it is refused with `Restore the captured writing and research limits before resuming…` unless the same research and chapter-word limits are in effect again, so resume with the same patch.

**Profiles other than `web`.** The bundle does not add the `present` tool, and the `headless` profile (like other non-web profiles) does not enable it by default. Without it, `story_write` is refused with `Writing requires the native present tool in this Agent scope` and no run is created. Enable `@deepseek-ai/dsh-tool-present` in that profile before writing; reading and preview tools work without it.

### Uninstalling

Remove it with `dsh plugin --profile web remove dsh-story-weaver` (use the same `--profile` you installed into). This removes the package, its dependencies and the bundle from the profile. Two things intentionally or harmlessly remain:

- Your novels and run history stay in `$DSH_HOME/storages/story_writing.json` and `$DSH_HOME/storages/story_runs.json`. Reinstalling picks them up again; delete these files yourself if you want the data gone.
- Empty scope directories such as `node_modules/@deepseek-ai/` and `node_modules/@standard-schema/` may be left in the profile directory. They are safe to delete.

## Writing workflow

Create a novel with a title and creative brief, then use the explicit novel and brief identities returned by the tools. Session selection is a convenience; creation does not select a novel, and writing requests name their novel explicitly. Projects, brief versions and writing history survive provider reopening.

`story_write` plans the requested settings dependency closure, researches and reviews its dimensions, reviews the assembled settings, and advances through the book outline and requested chapters. Each chapter passes body review and actual continuity review before its body and continuity references apply together. Chapter-length violations, missing required events, settings or character contradictions, and continuity conflicts block progression; style advice alone does not. No per-stage approval is required. In settings reviews (each dimension and the assembled collection), an advisory completeness note is recorded as a nonblocking finding instead of invalidating the review; every other non-style category must still be blocking.

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

The plugin does not set a process exit code. In the headless DSH used for smoke runs, the process exits 0 even when a story tool fails, so scripts must check the tool result rather than the exit status. `story_resume` runs the same check against the run's stored `settingsRoots` before touching it, so a run admitted with incomplete settings (before this gate existed, or under the bypass) is refused with the same `settings-incomplete` error and last line. The refused run is left exactly as it was (still `stopped`, `interrupted` or `failed`, with its attempts) and can resume later under the bypass. A completed run is not checked: it keeps the `run-state` refusal (`Completed runs cannot resume`). A run's `settingsRoots` cannot change, so without the bypass start a new run whose roots cover every required setting. A refused `interrupted` run still counts as the novel's unfinished run and keeps holding it: call `story_stop` on it first, otherwise the new `story_write` is refused with `active-run`. A refused `stopped` or `failed` run does not hold the novel.

The only bypass is operator-side: the plugin config option `allowIncompleteSettings` (default `false`), for smoke and unit tests. It is not a tool argument, so the model cannot set it.

### Importing author settings

`story_settings_import` replaces one adopted settings dimension with author-written text. It exists only while the operator-side plugin config option `allowSettingsImport` is `true` (default `false`); when it is off the tool is not registered and the model never sees it. Enable it only for an import, then turn it off.

An import takes `novelId`, `requestId`, `dimensionCode`, `expectedAppliedId` (the current adopted version) and `output`: the complete settings stage document as JSON text, validated exactly like generated output. The host supplies its `inputRefs`. The new version keeps the replaced version's research plan, records `revisionOf` and `origin: "import"`, and is adopted without its own review. Older versions are never rewritten; a missing `origin` means a generated (`stage`) version.

An import stays `pendingReview` until an assembled-settings collection containing it passes review. Until then it does not count as complete settings for the book outline, and `story_resume` of a run that uses it is refused. Run `story_update` to review it. When that review blocks and the repair would regenerate any imported dimension (pending or already released), the run stops and regenerates nothing instead of replacing author text. A run also stops with `"reason":"stale-import"` before any settings work when an imported dimension is stale (for example after re-importing only its upstream dimension, or after a brief change), instead of regenerating it. Import every dimension in dependency order, upstream first, before the update. After a brief change, the research an import reuses is out of date. Re-importing is then refused (`research-incomplete`), and `story_update` stops with `stale-import` instead of regenerating the imported dimension, so the author's version cannot be kept as it is. The only way forward is `story_revise` on that imported dimension: it runs a model stage, which refreshes the research, and adopts a model-written version (`origin: "stage"`) in place of the author's text. The author's version stays in history but is no longer current. After that revision you can import the author's text again over the new head, adjusted to the new brief if needed. Plan brief changes before importing, or keep the author's source text so it can be re-imported. Imports are refused while a run is running or interrupted. Refusals and stops end with one JSON line, like the required-settings gate:

```text
{"code":"import-refused","reason":"run-active"}
{"code":"import-refused","reason":"pending-review","importItems":[{"dimensionCode":"e1","artifactId":"…","pendingReview":true}]}
{"code":"review-blocked","importItems":[{"dimensionCode":"e1","artifactId":"…","pendingReview":false}]}
{"code":"review-blocked","reason":"stale-import","importItems":[{"dimensionCode":"g2","artifactId":"…","pendingReview":true}]}
```

**Downgrading after an import affects the whole store.** A plugin from before settings import (anything older than PR #18) cannot open a store that contains even one imported version: its strict schema rejects the whole `story_writing` domain, so the plugin does not load at all. Every novel and every story tool is unavailable, not only the imported novel, and `dsh` headless exits with status 1. The older plugin does not rewrite or repair the store; reinstalling a current plugin opens it again. A store imported by this version and then opened by the first settings-import release (PR #18, commit `8675246`) loads, but that release does not know the new import receipt format, so `story_get_settings` reports `Settings metadata or source content cannot be verified` for the novel and its settings cannot be displayed (lists still read). Before the first import, back up the entire DSH `storages` directory (both `story_writing` and `story_runs`), and keep that backup until you no longer need to go back.

Import records are checked for integrity, not authenticity: the stored receipt detects edits that no longer match, but whoever can write the storage can also forge a matching record, and an import record's importing Session is not covered by its receipt. See [Stored records and compatibility](docs/api/settings.md#records).

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

### Offline chapter lint

`node scripts/chapter-lint.mjs` runs `src/chapter-lint.ts` over a stored body (`body.json`, or `--store $DSH_HOME/storages/story_writing.json --body-id …`) or an exported chapter `.md`, optionally with its chapter outline (`--outline` / `--outline-id`). It is report-only and not part of the writing pipeline: it never calls a model, never writes a store and always exits 0 after a report; bad arguments, unreadable or non-UTF-8 files and input it cannot interpret print one `chapter-lint: …` line and exit 2 (`--help` prints usage). Input errors name the file and the position: `chapter-lint: <file>:<line>:<column>: invalid JSON: …` for JSON syntax errors, and `chapter-lint: <file>: <$.field.path>: expected …, got …` for structure and type errors in a body, outline or typo table (every scene needs string `sceneId` and `text`; every typo entry needs a nonempty string `wrong` and a string `right`). With `--store`, the artifact id follows the file name, e.g. `chapter-lint: story_writing.json: artifact artifact_…: $.scenes[0].text: expected a string, got missing`. Checks: standalone 【】 line count against the outline's cap (plus duplicates), Arabic-numeral literals the outline requires, a number in the 【任务已发布】 panel when the outline asks for one, scene/obligation/anchor positions (`--anchor 标签=正则`), a typo table (`--typos table.json`) and advisory technical metaphors (a technology/finance term list, seeded from the ch1 v2 style audit, in the same sentence as a 「比…还/更/都」 comparison, excluding 比如/比较/无比; 像/如同/仿佛-style metaphors are left to the review prompts). Positions are code-point offsets into the scenes joined with blank lines, title excluded, punctuation and whitespace included, divided by the total code points.

## Host integration

The plugin registers `ctx.story`, `ctx.storyRunner` and their tool consumers through Cordis. It requires the host's `storageDomain`, `tools`, `fs`, `subagents`, `sessions` and `sessionPersistence` and `sessionProjections` capabilities. The actual writing Agent must also have the native `present` tool available. The host owns the model route, native spawn provider, web providers and access policies. [Runner configuration](docs/api/writing-runner.md#configuration) controls finite research, execution, repair and text limits. The default chapter range is 3,000–5,000 Story-counted words.

The writing service owns immutable documents and applied references; a separate `story_runs` domain owns attempts and raw output. Both use the existing host storage facility. [The orchestration decision](docs/agents/notes/2026-09-11-native-writing-runs.md) explains durable execution, history and publication.

## Limits and distribution

One host owns each writing facility; simultaneous writer processes sharing storage are not supported by the verified deployment. Native fixtures establish execution and persistence behavior, not literary quality or large-book performance. The required three-chapter real-model run, full browser acceptance and final human review remain pending.

The manifest declares a built DSH composition bundle, distributed as the prebuilt npm package `dsh-story-weaver` (see [Installation](#installation)). The earlier [private installation study](docs/research/private-cli-install-research.md) is kept for reference. Browser, OS-protocol and Desktop installer enhancements are outside scope.

## Further reading

- [Writing runner](docs/api/writing-runner.md): orchestration, configuration, cancellation and repair.
- [Writing service](docs/api/writing-service.md), [manuscript](docs/api/manuscript.md) and [writing runs](docs/api/writing-runs.md): authoritative versions and durable state.
- [Stage deliveries](docs/api/stage-deliveries.md) and [readable Markdown](docs/api/readable-markdown.md): versioned document previews.
- [Domain terms](docs/specs/story-writing-plugin/CONTEXT.md) and [specification](docs/specs/story-writing-plugin/spec.md): requirements and acceptance criteria.
