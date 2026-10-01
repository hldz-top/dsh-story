# Dependencies for research and writing stages

## Runtime declaration update — 2026-09-11

The original read-only proposal below is historical. Its approved packages are now installed in this independent repository. The production collector imports `formatFetchOutput` from `@deepseek-ai/dsh-tool-web` to distinguish the native fetch display prefix from substantive recorded content. This package is therefore declared as a runtime peer at the already installed `0.1.5-rc.1`, retaining its matching development declaration for local checks. The host supplies the actual web capability and providers.

This update changes package classification only. It performs no installation, upgrade, download or environment change. The installed manifest and existing lockfile importer both identify `0.1.5-rc.1`. pnpm's root importer already records the development dependency; adding an identical peer declaration does not require a second importer entry or a new resolution. The lockfile remains byte-for-byte unchanged. Private-release installation and runtime activation still need their separate acceptance evidence.

## Original investigation — 2026-09-10

2026-09-10, project `/Users/hldz2/project/ai/dsh-story`. The project manifest, actual `.pnpm` installation directory, and exact-version JSON from the npm registry were inspected. No packages were installed, upgraded, or downloaded as release archives. The manifest and lockfile were not changed, and no live search or model calls were made. The proposed dependency changes still await approval.

## Proposed changes

| Package | Pinned version | Current direct declaration / root link | Current transitive installation | Purpose and proposed declaration |
| --- | --- | --- | --- | --- |
| `@deepseek-ai/dsh-session-persistence` | `0.1.5-rc.1` | None | Yes, 1 instance | Production reads of actual Session logs: add `peerDependencies` + `devDependencies` |
| `@deepseek-ai/dsh-tool-web` | `0.1.5-rc.1` | None | None | Offline integration fixture for the shipped web tools: add only `devDependencies` |
| `@deepseek-ai/dsh-web` | `0.1.5-rc.1` | None | None | Public `WebRuntime` and provider types for the fixture: add only `devDependencies` |
| `@deepseek-ai/dsh-subagent` | `0.1.5-rc.1` | Existing dev declaration and root link | Installed | Production writing-stage delegation: add only `peerDependencies` and retain the existing dev declaration |
| `@deepseek-ai/dsh-subagent-spawn-in-process` | `0.1.5-rc.1` | None | None | Fixture using an actual subagent run: add `devDependencies` |
| `@deepseek-ai/dsh-subagent-in-process-driver` | `0.1.5-rc.1` | None | None | Public driver required by spawn: add `devDependencies` |

The complete proposal covers 6 packages and 7 new manifest entries: 5 dev entries (persistence, tool-web, web, spawn, and driver) and 2 peer entries (persistence and subagent). Of the 6 packages, 1 is already installed directly, 1 is installed only transitively, and 4 are absent. The production plugin consumes recorded research and the host's subagent service; the production host owns web providers and subagent execution providers. A transitive installation does not replace the declaration required for a direct plugin import.

## Sources, versions, and transitive dependencies

Metadata for all six exact versions was successfully read from the public npm registry. Each identifies `deepseek-ai/deepseek-harness` as its repository and `imccyu` and `tianyicui-deepseek` as maintainers in the published metadata. Package directories match their package names; see the exact-version primary sources. None of the six declares **package-level engines**. This omission does not establish support for every Node version; this project's engine requirement remains `^22.19.0 || >=24`. Read-only inspection reported local Node `v24.18.0`, npm `11.16.0`, and pnpm `11.7.0`.

| Package | Dependencies declared on npm | Peers declared on npm |
| --- | --- | --- |
| session-persistence | dsh-util-values `^0.1.5-rc.1` | Cordis `^4.0.2`; dsh-brand/session/timeout each `^0.1.5-rc.1` |
| tool-web | schemastery `^3.18.2`; dsh-util-values `^0.1.5-rc.1`; turndown `^7.2.4`; @joplin/turndown-plugin-gfm `^1.0.67` | Cordis `^4.0.2`; dsh-llm/web/tools/system-prompt each `^0.1.5-rc.1` |
| web | schemastery `^3.18.2` | Cordis `^4.0.2`; dsh-llm `^0.1.5-rc.1` |
| subagent (installed) | zod `^4.4.3`; dsh-brand/util-values/chunked-list each `^0.1.5-rc.1` | All required peers are already installed; its version metadata lists all 20 peers, including 9 marked optional |
| subagent-spawn-in-process | schemastery `^3.18.2` | Cordis `^4.0.2`; dsh-subagent/subagent-in-process-driver each `^0.1.5-rc.1` |
| subagent-in-process-driver | dsh-brand `^0.1.5-rc.1` | Cordis `^4.0.2`; dsh-llm/agent/tools/session/subagent/system-prompt each `^0.1.5-rc.1` |

The omitted DSH package-name prefix in the table is `@deepseek-ai/`. All other dependencies of the proposed spawn and driver packages are already installed directly. The subagent dependencies chunked-list, sandbox, util-time, invariants, session-query, and session-persistence are installed only transitively. Its only missing peer, `session-projection-cache`, is marked optional in the installed exact-version manifest and does not need to be added in this round. The persistence package's timeout peer is also already installed transitively.

The two subagent package names were confirmed in the host's `apps/cli/package.json:141` and `packages/subagent/subagent-spawn-in-process/package.json:31`. The host source manifest currently uses rc.2; this checklist continues to pin the public rc.1 release. Current source code is not evidence that rc.1 passed runtime tests. A published package's own devDependencies do not become transitive installation requirements for this project.

Three third-party transitive packages are currently absent:

- `turndown@7.2.4`: maintained at `mixmark-io/turndown`, with `domchristie` and `martincizek` listed as maintainers; declares Node `>=18` and npm `>=9`, and depends on `@mixmark-io/domino:^2.2.0`.
- `@joplin/turndown-plugin-gfm@1.0.67`: maintained at `laurent22/joplin-turndown-plugin-gfm`, with `laurent22`, `calebjohn`, and `tessus` listed as maintainers; declares no engines, dependencies, or peers.
- `@mixmark-io/domino@2.2.0`: maintained at `mixmark-io/domino`, with `pavel.horal` listed as maintainer; declares no engines, dependencies, or peers.

These checks cover metadata for the minimum versions. Parent dependencies use `^` ranges, and the dependency resolver has not been run, so **the final number of new installed instances cannot be promised to be exactly 7**. After installation, review the actual lockfile versions, integrity entries, and peer resolution. This inspection does not infer the complete installation result.

## Proposed execution flow and follow-up validation

The fixture should register `WebRuntime`, connect fixed local data through `registerSearchProvider` / `registerFetchProvider`, and then mount the shipped tool-web package so the actual AgentLoop invokes native `web_search` / `web_fetch`. Set the fixture's `searchProvider` / `fetchProvider` explicitly to prevent selection through inherited `DSH_WEB_*_PROVIDER` environment variables. Do not mount network providers or load credentials. The public entries are in the host's `packages/web/web/src/index.ts:74,103,114`; tool-web is at `packages/web/tool-web/src/index.ts:83`.

The writing workflow needs a **bounded index tool for recorded results**. It determines identity from the executing Session, calls `sessions.flush`, reads logs within the research window, and returns call IDs, tool names, queries or URLs, statuses, bounded excerpts, and Host-generated result references. The model uses that index to select evidence without needing to know internal `event.seq` values. Archival checks the references again and extracts text from the logs; it must not trust model-supplied sources. The index output follows the ordinary tool-result path and is recorded in the Session log.

After dependency installation is approved, the minimum validation covers the independent project's typecheck; both shipped web tools writing JSONL through the actual Loop; result discovery and archival through the index; readback after restart; two concurrent searches; distinct failure and insufficiency outcomes; rejection of fabricated references; and cancellation. A fixture must also use the actual spawn-in-process driver to run a subagent with a fixed offline model and verify parent/child Session association, terminal state, stop/resume behavior, and absence of leftover tasks. Later stages reuse the public subagent service instead of copying the host's AgentLoop. Proving that tool-web's `timeoutMs` takes effect would additionally require inspection and composition of the existing timeout-policy. This checklist does not expand dependencies to include it without authorization.

## Primary sources and evidence limits

- [session-persistence exact-version metadata](https://registry.npmjs.org/@deepseek-ai%2Fdsh-session-persistence/0.1.5-rc.1)
- [tool-web exact-version metadata](https://registry.npmjs.org/@deepseek-ai%2Fdsh-tool-web/0.1.5-rc.1)
- [web exact-version metadata](https://registry.npmjs.org/@deepseek-ai%2Fdsh-web/0.1.5-rc.1)
- [turndown exact-version metadata](https://registry.npmjs.org/turndown/7.2.4)
- [GFM exact-version metadata](https://registry.npmjs.org/@joplin%2Fturndown-plugin-gfm/1.0.67)
- [domino exact-version metadata](https://registry.npmjs.org/@mixmark-io%2Fdomino/2.2.0)
- [subagent exact-version metadata](https://registry.npmjs.org/@deepseek-ai%2Fdsh-subagent/0.1.5-rc.1)
- [spawn-in-process exact-version metadata](https://registry.npmjs.org/@deepseek-ai%2Fdsh-subagent-spawn-in-process/0.1.5-rc.1)
- [in-process-driver exact-version metadata](https://registry.npmjs.org/@deepseek-ai%2Fdsh-subagent-in-process-driver/0.1.5-rc.1)
- [Current project manifest](/Users/hldz2/project/ai/dsh-story/package.json)
- [Asynchronous log and tool-result verification report](/private/tmp/dsh-story-t02-web-seams.md)

The initial `npm view` failed with `EPERM` while writing to the default cache. Subsequent checks used only HTTPS GET requests for exact-version JSON, and all nine succeeded. npm cache permissions were not changed, and the repair suggestions in the command output were not executed. The metadata establishes that the versions and declarations exist; it does not establish successful installation, builds, Linux or Node 22 execution, or live network-provider validation.
