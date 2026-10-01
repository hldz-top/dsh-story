---
description: "Approved exact-version dependencies for native stage delivery and live Story cards."
---
# Stage preview dependencies

## Installed scope

The user approved the exact manifest entries below and `pnpm install --ignore-scripts`. The parent implementation task reported exit 0 and one added installed package on 2026-09-11. The current manifest, lockfile and direct installed package agree on `@deepseek-ai/dsh-tool-present@0.1.5-rc.1`. No additional runtime package was needed for the Client cards. [The presentation study](../research/stage-artifact-presentation.md) preserves the released-API investigation; [migration validation](migration-validation.md) records executed integration scopes and pending acceptance.

| Package | Declared version and role | Purpose |
| --- | --- | --- |
| `@deepseek-ai/dsh-tool-present` | Exact `0.1.5-rc.1` peer and dev dependency; one newly installed package. | Production dispatches the Host's native `present` tool and imports its public event types. Offline fixtures mount the actual released tool. |
| `@deepseek-ai/dsh-session-projection` | Exact `0.1.5-rc.1` peer; the existing dev dependency was retained. | The plugin registers a pure fold of known delivery events through the Host's `sessionProjections` service. |
| `@deepseek-ai/dsh-client-ui-session` | Already installed exact `0.1.5-rc.1` dev dependency; declared in `dsh.client.inject`. | Existing Session props provide the live `useProjection` subscription and authorized file action. |

The production plugin requires `sessionProjections` and checks `present` availability in the actual writing Agent before admitting work. It executes the existing registered tool; it does not mount a duplicate native producer. Public DSH declaration imports remain type-only, and the Client runtime continues to share Host React and JSX modules. `@deepseek-ai/dsh-client-ui-deliverables` was not required or installed. No separate presenter service, model loop, database or writing workbench was added.

## Source and installation record

The [exact registry metadata](https://registry.npmjs.org/@deepseek-ai%2Fdsh-tool-present/0.1.5-rc.1) identifies `deepseek-ai/deepseek-harness`, directory `packages/fs/tool-present`, and the MIT license. Before installation, the exact 8,439-byte [tarball](https://registry.npmjs.org/@deepseek-ai/dsh-tool-present/-/dsh-tool-present-0.1.5-rc.1.tgz) was inspected and its SHA-512 digest matched registry integrity. That inspection executed no extracted JavaScript or lifecycle scripts. The adjacent rc.2 checkout was not used as the release-version authority.

The approved installation command was:

```sh
pnpm install --ignore-scripts
```

The existing release-age policy gained only the exact exception `@deepseek-ai/dsh-tool-present@0.1.5-rc.1`. No package-family wildcard, rc.2 upgrade or lifecycle-script execution was authorized by this change. The released tool's existing dependency and peer requirements were satisfied by the project's pinned installation. This record authorizes no further installation, model calls, publication or Git operation.

## Validation boundaries

Host tests exercise the released tool through native ToolRuntime and Session persistence, with full Markdown projection, exact owning-call correlation and committed delivery events. Client tests exercise running cards, retained version actions, invalid results and projection parsing. Closure tests check published browser loading and reject unsupported runtime imports. Counts and exact commands belong to the [dated validation record](migration-validation.md); these separate checks are not a completed browser flow.

Current profile/browser acceptance must show only complete `settings`, `book-outline`, `chapter-outline` and `body` documents automatically before the parent tool finishes, open their exact recorded files, retain eligible repair versions and reload persisted history. A fresh three-chapter run without repairs produces eight documents. Internal records remain explicitly readable, and historical receipts are retained. The narrowed runner policy requires new aggregate and built-profile evidence; private installation remains a separate gate. No new custom Session event or fabricated model tool call replaces the native producer.
