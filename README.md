---
description: "Independent novel writing, reviewed versions and durable writing runs through DSH."
kind: "package-bundle"
---
# DSH Story

## Summary

DSH Story is a standalone TypeScript plugin for researched settings, book and chapter outlines, chapter prose, review and repair, and actual story continuity. It runs through DSH's existing tools, native subagents and JSON or SQLite persistence without a Story backend or Python runtime. The automatic writing and upstream-revision paths have deterministic native-runtime test evidence; final package, browser, real-model and private-installation acceptance remain separate work. See the dated [migration validation record](docs/development/migration-validation.md). The [research admission repair record](docs/development/research-admission-repair-validation.md) documents the current offline checks, literal source selection, historical compatibility and native HTTP decoding repair. Real-model acceptance remains pending.

## Table of Contents

- [Installation](#installation)
- [Host-provided peers](#host-provided-peers)
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

**Cordis peer.** `@deepseek-ai/cordis` is declared as `~4.0.4`, the same range DSH 0.2.0-rc.2 uses. That host release resolves the range to 4.0.5. An exact `4.0.4` peer makes `npm install` fail with `ERESOLVE` when 4.0.5 is already present.

**pnpm version.** Installation is verified with pnpm 11.7.0. With Node 22.19's bundled corepack, the pnpm 12.x that corepack fetches by default (12.14.0 at the time of testing) fails to start (`Cannot find module …/corepack/v1/pnpm/12.14.0/bin/pnpm.cjs`), and `dsh plugin add` fails. Pin the verified version, for example `corepack prepare pnpm@11.7.0 --activate` (or put a `pnpm` shim that runs `corepack pnpm@11.7.0` on `PATH`). If the default `COREPACK_HOME` is not writable, set `COREPACK_HOME` to a writable directory.

**Plugin id and config patches.** The plugin id is `dsh-story-weaver`, the same as the package name; before the npm rename it was `dsh-story`. A config override in a DSH `--patch` file must target the new id, for example `- id: dsh-story-weaver` followed by `config:` (see [docs/examples/research-budget.patch.yml](docs/examples/research-budget.patch.yml)). A patch that still says `- id: dsh-story` matches no entry and is skipped: DSH starts normally and keeps the config the earlier layers gave the plugin, so the override silently does not apply. That includes operator switches such as `allowIncompleteSettings`, which then stays off. A normal run prints nothing about it; only `dsh --dump-config` reports `patch: entry "dsh-story" not found` on stderr. An `insert` patch that mounts the plugin by path and carries its own `config:` is not affected, whatever id it gives the entry.

**A patch's `config:` replaces, it does not merge.** When several layers (the bundle, the profile's `cordis.patch.yml`, then each `--patch` file in order) give the same entry a `config:`, the later block replaces the earlier one as a whole; DSH does not merge it key by key. A `--patch` that sets only `maxResearchSources` therefore resets every other key, including your own `maxRepairAttempts`, `stageTimeoutMs`, `maxRunAttempts` and switches such as `allowIncompleteSettings`, to the plugin defaults, without any warning. Write the full config in the last layer: copy every setting you changed elsewhere into it, as the example does, and check the composed result with `dsh --profile <profile> --patch <file> --dump-config` before starting a run. A run freezes the limits it started with; resuming it is refused with `Restore the captured writing and research limits before resuming…` unless all ten compared limits are the same as when the run started: `maxArtifactBytes`, `maxReadChars`, `maxResearchQuestions`, `maxResearchCalls`, `maxResearchSources`, `maxEvidenceChars`, `maxResearchLogEvents`, `minChapterWords`, `maxChapterWords` and, on prompt version 5, `aiToneBlocking`. The refusal names each differing key and ends with one JSON line such as `{"code":"run-limits","mismatched":[{"key":"aiToneBlocking","saved":false,"current":true}]}`. Resume with the same patch.

**Profiles other than `web`.** The bundle does not add the `present` tool, and the `headless` profile (like other non-web profiles) does not enable it by default. Without it, `story_write` is refused with `Writing requires the native present tool in this Agent scope` and no run is created. Enable `@deepseek-ai/dsh-tool-present` in that profile before writing; reading and preview tools work without it.

### Upgrading

Rolling back to an older plugin that does not know a stored prompt version (versions 3, 4 and 5 on this code) makes every run in that novel unreadable, including version 1 and 2 runs: the old code rejects the novel record.

Resuming on this code hits attempt-conflict only for version 3 or 4 runs created on `07ab432` or earlier, and only for a chapter whose body review was started but not accepted (interrupted, outcome unknown, failed, or rejected and being retried), when that chapter's AI-tone markers change. For a run created on `07ab432` the only changed inputs are an ASCII period followed by whitespace (`. 然而，`, `.　然而，`) and a digit before the period (`第3.然而，`); for an earlier run, also an unclosed “ or 「, `.然而`, or a panel line with trailing spaces. An already-accepted body review is not rebuilt and does not conflict. Version 1 and 2 runs are not affected. An experiment that has already started must be resumed on the commit that created it.

### Uninstalling

Remove it with `dsh plugin --profile web remove dsh-story-weaver` (use the same `--profile` you installed into). This removes the package, its dependencies and the bundle from the profile. Two things intentionally or harmlessly remain:

- Your novels and run history stay in `$DSH_HOME/storages/story_writing.json` and `$DSH_HOME/storages/story_runs.json`. Reinstalling picks them up again; delete these files yourself if you want the data gone.
- Empty scope directories such as `node_modules/@deepseek-ai/` and `node_modules/@standard-schema/` may be left in the profile directory. They are safe to delete.

## Host-provided peers

A DSH profile installs plugins with pnpm `autoInstallPeers` turned off and a hoisted `node_modules`. Packages the plugin only calls inside the host are resolved from that running installation, so the profile does not download a second copy.

Those packages stay in `peerDependencies` with the same version ranges. Each one is marked `"optional": true` in `peerDependenciesMeta`. pnpm no longer lists these 12 as missing; one summary warning remains because of the upstream cordis peer, and `dsh plugin add` passes that warning through. The host still checks every `@deepseek-ai/dsh-*` peer range against the running DSH version before it loads the plugin. This package installs with npm, but importing it outside DSH fails with `ERR_MODULE_NOT_FOUND`. The optional peers are:

| Peer | Range |
| --- | --- |
| `@deepseek-ai/cordis` | `~4.0.4` |
| `@deepseek-ai/dsh-fs` | `>=0.2.0-rc.2 <0.3.0-0` |
| `@deepseek-ai/dsh-llm` | `>=0.2.0-rc.2 <0.3.0-0` |
| `@deepseek-ai/dsh-sandbox-policy` | `>=0.2.0-rc.2 <0.3.0-0` |
| `@deepseek-ai/dsh-session` | `>=0.2.0-rc.2 <0.3.0-0` |
| `@deepseek-ai/dsh-session-persistence` | `>=0.2.0-rc.2 <0.3.0-0` |
| `@deepseek-ai/dsh-session-projection` | `>=0.2.0-rc.2 <0.3.0-0` |
| `@deepseek-ai/dsh-storage-domain` | `>=0.2.0-rc.2 <0.3.0-0` |
| `@deepseek-ai/dsh-subagent` | `>=0.2.0-rc.2 <0.3.0-0` |
| `@deepseek-ai/dsh-tool-present` | `>=0.2.0-rc.2 <0.3.0-0` |
| `@deepseek-ai/dsh-tool-web` | `>=0.2.0-rc.2 <0.3.0-0` |
| `@deepseek-ai/dsh-tools` | `>=0.2.0-rc.2 <0.3.0-0` |

`@deepseek-ai/dsh-brand` is a direct dependency of this package. The published brand package declares its own required peer `@deepseek-ai/cordis@~4.0.4`. On a profile install, pnpm still reports that missing `cordis` peer. That declaration is upstream; this repository does not change it. The host provides the same cordis instance when the plugin runs.

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

### AI-tone review

Body reviews from prompt version 3 receive `task.aiToneMarkers` with host-detected AI-tone markers in the chapter narration: counts per thousand Han characters plus exact excerpts. Dialogue and 【】 panel lines are skipped. The reviewer reports real instances as advisory style issues; on prompt versions 3 and 4, and on version 5 with `aiToneBlocking` off, AI tone never blocks (see below). The markers and their limits are adapted from [lieflat-less-ai-tone](https://github.com/larashero3-dotcom/lieflat-less-ai-tone) (commit 27d2923, MIT License, Copyright (c) 2026 shiujan; notice in [third_party/lieflat-less-ai-tone.LICENSE](third_party/lieflat-less-ai-tone.LICENSE)). [src/ai-tone.ts](https://github.com/hldz-top/dsh-story/blob/main/src/ai-tone.ts) lists the ported rules and those left out for fiction. From prompt version 4 the body-writing prompt also carries one short rule set from the same skill: no set-up-and-overturn framing, no 、 strings of three or more items, few reveal dashes, no set openers, nominalised summaries or translationese, and paragraph-opening comments that name their subject; dialogue, questions and rhythm are exempt, and the technical-metaphor ban takes precedence. Runs created on earlier prompt versions keep their original prompts.

**AI tone blocks body reviews by default (prompt version 5).** The plugin config switch `aiToneBlocking` (boolean, default `true`) makes AI tone in a chapter body a blocking finding that goes back through the normal body repair. The reviewer still files AI tone as advisory style issues (style issues must stay advisory, or the whole review is rejected), with ids starting `ai-tone-`; the plugin decides in code which of them block. It runs the same detector as `task.aiToneMarkers` on the body's narration (dialogue and 【】 panel lines removed), and a quoted span blocks only when one of its verbatim occurrences in that narration fully covers a detector hit. So a fragment of dialogue, a commentary word such as 看起来 that does not open a paragraph, or a connective such as 因此， that follows a comma never blocks. One covered hit is enough for every rule, including a single dash or 、 enumeration. Quotes are matched character for character: a quote that passed review admission only after normalisation (full-width or half-width forms, line breaks, quote styles) is recorded but does not block. Only the body review changes: every other stage, and the body review with the switch off, keeps the version-4 prompt byte for byte, so with `aiToneBlocking: false` a version-5 run behaves like version 4 (AI tone advisory). The run stops on these conditions:

- An AI-tone issue whose quote covers no detector hit in the narration (not a verbatim excerpt, inside dialogue, no marker, or downgraded because its evidence was found nowhere) is kept in the review but does not block.
- If, after a repair, the review again reports an instance it already reported (the same detector hit, recognised by its surrounding narration, whatever length the reviewer quotes), or the body comes back unchanged and AI tone is reported again, the run stops at once for human review (`"reason":"ai-tone-repeat"`) without spending the remaining repair attempts. Another instance with the same marker text elsewhere is not a repeat, including another one that also opens a paragraph or follows dialogue (an empty side of the surrounding narration identifies nothing).
- When `maxRepairAttempts` runs out with AI tone still blocking, the run ends `review-blocked` (`"reason":"ai-tone-exhausted"`, or `"ai-tone"` when `maxRepairAttempts` is 0). The chapter is never applied or passed automatically.

Each body review that the host blocked for AI tone is marked on its stored run attempt (`aiToneBlock` with the reason and spans, shown by `story_get_run`), because the review document itself only holds advisory issues. Check that marker before using such a body by hand. Every body and review call is an ordinary run attempt, counted in the run's attempt budget like any other stage (and by any external per-run call watchdog). The stop message ends with one JSON line, the same `review-blocked` union as the import stops, carrying `spans` (the exact blocking excerpts) instead of `importItems`:

```text
{"code":"review-blocked","reason":"ai-tone-repeat","spans":["说白了"]}
```

The same line, with `"reason":"ai-tone"`, ends the repair instruction the next body attempt receives.

Known limitation: dialogue is recognised by its quote marks. An unclosed 「 or “ stops at the line and is not removed, so narration after it is still scanned. A review quote that spans closed dialogue (for example `他说：「走。」——然后`) is never found in the narration, so it does not block even when it contains a marker. That under-blocks (the chapter passes); it never blocks by mistake.

The switch is frozen into each new run with the other execution limits. Resume compares it as part of the same limits check: a version-5 run whose recorded value differs from the current config is refused (`run-limits`, naming `aiToneBlocking`); a version-5 run record without the value is corrupt (`corrupt-run`) and is refused, never treated as off; runs created before version 5 (versions 1 to 4) have no value, are treated as off whatever the current config says, and resume normally with advisory AI tone.

To turn it off, set `aiToneBlocking: false` in the same plugin `insert` entry (or the same last config layer) that carries the rest of your config: a later layer's `config:` replaces the whole block (see above), so a patch that sets only `aiToneBlocking` resets every other key to its default, and a patch aimed at another entry does not apply at all. Experiment arms (the A/B/C control experiment) turn it off in every arm and are judged by human review against `qa-ch1-v2-style.md`.

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

Automatic writing cards show complete documents for only four artifact kinds: assembled settings (`settings`), `book-outline`, `chapter-outline` and `body`. Eligible candidate and repaired versions retain their exact identities; a preview does not imply review or application. A fresh three-chapter run without repairs produces eight documents: one settings collection, one book outline, three chapter outlines and three bodies. Research, individual dimensions, reviews and continuity remain stored for audits and explicit reads, without new automatic links. Rejected raw responses are not published; they stay in the run store for explicit reads. Historical delivery links remain readable. Validation of this narrowed presentation policy is pending in the migration record.

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

`node scripts/chapter-lint.mjs` runs `src/chapter-lint.ts` over a stored body (`body.json`, or `--store $DSH_HOME/storages/story_writing.json --body-id …`) or an exported chapter `.md`, optionally with its chapter outline (`--outline` / `--outline-id`). It is report-only and not part of the writing pipeline: it never calls a model, never writes a store and always exits 0 after a report; bad arguments, unreadable or non-UTF-8 files and input it cannot interpret print one `chapter-lint: …` line and exit 2 (`--help` prints usage). Input errors name the file and the position: `chapter-lint: <file>:<line>:<column>: invalid JSON: …` for JSON syntax errors, and `chapter-lint: <file>: <$.field.path>: expected …, got …` for structure and type errors in a body, outline or typo table (every scene needs string `sceneId` and `text`; every typo entry needs a nonempty string `wrong` and a string `right`). With `--store`, the artifact id follows the file name, e.g. `chapter-lint: story_writing.json: artifact artifact_…: $.scenes[0].text: expected a string, got missing`. Checks: standalone 【】 line count against the outline's cap (plus duplicates), Arabic-numeral literals the outline requires, a number in the 【任务已发布】 panel when the outline asks for one, scene/obligation/anchor positions (`--anchor 标签=正则`), a typo table (`--typos table.json`), advisory technical metaphors (a technology/finance term list, seeded from the ch1 v2 style audit, in the same sentence as a 「比…还/更/都」 comparison, excluding 比如/比较/无比; 像/如同/仿佛-style metaphors are left to the review prompts) and advisory empty 【】 placeholders (an unfilled pair, including one whose interior is only whitespace such as a full-width space; the finding carries the same code-point location as other findings, does not change the panel count and does not change the exit code). Positions are code-point offsets into the scenes joined with blank lines, title excluded, punctuation and whitespace included, divided by the total code points.

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
