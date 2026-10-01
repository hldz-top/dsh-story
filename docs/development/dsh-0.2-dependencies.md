---
description: "Approved upgrade of all DSH dependencies to the published 0.2.0-rc.2 release, the resulting code migration and the rejected alternatives."
---
# DSH 0.2 dependency upgrade

## Decision

On 2026-09-30 the user approved upgrading every DSH dependency of this plugin to the published `0.2.0-rc.2` release. DSH 0.2 checks plugin compatibility before loading a plugin (DSH `packages/boot/app-boot/src/plugin-compatibility.ts`). Every `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` peer must satisfy the running DSH version under `semver.satisfies(..., { includePrerelease: true })`. The previous exact `0.1.5-rc.1` peers therefore caused an isolated `0.2.0-rc.2` host to disable the plugin before any Story tool existed. `@deepseek-ai/cordis` is not part of that check.

The upgrade keeps the repository's exact-version convention:

| Manifest field | Change |
| --- | --- |
| `peerDependencies` | 11 DSH peers `0.1.5-rc.1` → `0.2.0-rc.2`; `@deepseek-ai/cordis` `4.0.2` → `4.0.4`. |
| `dependencies` | `@deepseek-ai/dsh-brand` → `0.2.0-rc.2`; `@deepseek-ai/schemastery` `3.18.2` → `3.18.4`, the version DSH 0.2 vendors. |
| `devDependencies` | 62 DSH packages → `0.2.0-rc.2`; `@deepseek-ai/cordis` → `4.0.4`; `@deepseek-ai/cosmokit` `1.8.3` → `1.8.5`. |
| Removed | `@deepseek-ai/dsh-agent-presets`: no source or test imported it, and DSH 0.2 replaced it with the agent-preset packages. |
| Added | `@deepseek-ai/cordis-plugin-include` `1.0.9` as an exact dev dependency (see the installation record). |

Each later DSH update requires another deliberate version change and verification. The Host's compatibility check enforces this rather than letting an unverified combination load.

## Code migration

DSH 0.2 records a tool result as a first-class `ToolResultMessage` with role `tool`. It carries `toolCallId`, `isError` and `content` on the message; the former `tool-result` content block no longer exists. The native research collector ([`research-log.ts`](../../src/research-log.ts)) and the start-receipt check ([`research-stage.ts`](../../src/research-stage.ts)) now read the logged message itself. The previous code looked for the call ID on the first content block of each result. Following that code path on a 0.2 Host, it would have found no result for any reserved native `web_search`/`web_fetch` call and rejected research as incomplete. This was derived from the code and the 0.2 types, not observed in a run.

Test support was migrated to the same shapes without weakening assertions:

- Deterministic model adapters locate `role: 'tool'` request messages, including the [offline profile fixture](../../tests/profile/fixture.mjs).
- Client card tests supply the 0.2 `phase` and `useDisclosure` owner props.
- The reused-call-ID research test issues its two calls one after the other. The 0.2 Session format rejects an assistant message that advertises a still-open call ID twice, so the test reaches the collector's own duplicate check through two closed call/result pairs.

## Installation record

- **Registry:** the configured registry is npmmirror. It served every required `0.2.0-rc.2` package except `@deepseek-ai/dsh-agent-loop-testkit` and `@deepseek-ai/dsh-storage-sqlite`, which the official registry had published on 2026-09-29. With the user's approval, npmmirror's public sync endpoint was requested for exactly those two public packages. The registry configuration was not changed.
- **Release-age policy:** the release was less than one day old at installation time. Following the existing exact-exclusion practice, `pnpm-workspace.yaml` lists the 95 resolved `@deepseek-ai/dsh*@0.2.0-rc.2` packages; no wildcard was used.
- **Build scripts:** `pnpm-workspace.yaml` denies the build script of `koffi`, a Windows-only optional FFI dependency that DSH 0.2 loads lazily on Windows, with `allowBuilds: { koffi: false }`. No dependency lifecycle script was approved.
- **Peer resolution:** the lockfile kept a stale auto-installed `@deepseek-ai/cordis-plugin-include@1.0.7`, while cordis `4.0.4` and three DSH packages require `~1.0.9`. A targeted `pnpm update` did not re-resolve it, and deleting the lockfile is not allowed. The exact `1.0.9` dev dependency replaces it.
- **Result:** after that change `pnpm install` exits 0, `pnpm peers check` reports no issue, and `pnpm install --frozen-lockfile` passes.

## Alternatives considered

| Alternative | Why it was rejected |
| --- | --- |
| Widen the peers to `0.1.5-rc.1 \|\| 0.2.0-rc.2` without changing installed packages | The Host check would accept the plugin, but the plugin would still run code built against 0.1.5 types. The type check against 0.2 then exposed that this code reads tool results in the pre-0.2 shape; see [Code migration](#code-migration). The user chose the full upgrade. |
| Grant an exact-version exemption with `dsh plugin allow-version … --accept-risk` | Bypasses the Host's safety check and leaves an incorrect manifest that fails elsewhere. An automated permission check also refused the command during the rehearsal. |
| Keep the two lagging test packages at `0.2.0-rc.1` | Native tests would mix rc.1 and rc.2 copies of DSH services and produce unreliable results. |
| Install the two packages from the official registry | Changes the configured package source, which repository policy prohibits. |
| Delete the lockfile to refresh the stale peer | Prohibited; the exact dev dependency achieves the same resolution explicitly. |

## Validation boundaries

On 2026-09-30, `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` passed. The tests were 571 Vitest tests in 34 files and 39 Node tests, and the build emitted a 16.14 kB `lib/client.js`. These checks were re-run independently after the test migration. They are offline evidence. The built-profile rehearsal on a DSH `0.2.0-rc.2` Host and the live model acceptance are recorded separately. This record authorizes no further installation, model call, publication or Git operation.
