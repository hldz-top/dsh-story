# T01 Client declaration dependency supplement

This supplement was prepared after the first approved dependency installation had completed. It proposed the 42 additional development dependencies below. At that point, the supplemental installation had not run and the lockfile had not been changed.

When DSH's public tool-card types are used directly, their published declarations recursively reference UI and API types that the originating packages do not fully declare. The compiler resolves fields such as block and loadImage to any, so the earlier exit code 0 does not establish independent type safety. This list was derived by following the published declarations and checking each package against the npm registry. All 42 specified versions returned HTTP 200.

These packages belong in devDependencies for independent compilation and testing. The Client build permits only host runtime references to React and JSX; type imports are erased. Adding these packages does not start additional backend services. The pre-stable DSH types must remain pinned. After installation, check declaration resolution again and verify that critical fields do not resolve to any.

The command proposed for separate approval remained `pnpm install --ignore-scripts` in this project. It creates or updates project dependencies, the lockfile, and cache entries while keeping dependency installation scripts disabled. The alternative is to pause Client type validation and continue Host tasks. Host source aliases or any overrides must not conceal this missing dependency coverage.

| Development dependency | Pinned version |
| --- | --- |
| `@deepseek-ai/cosmokit` | `1.8.3` |
| `@deepseek-ai/dsh-agent-presets` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-api-gateway` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-api-remotes` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-api-session-controller` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-api-settings-controller` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-api-workspace-controller` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-api-workspace-files` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-attachment` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-client-connection` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-client-file-upload` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-client-store` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-client-ui-chat` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-client-ui-conversation` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-client-ui-primitives` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-client-ui-session` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-client-ui-settings` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-command-feedback` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-commands` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-cordis-host-runner` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-credentials` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-file-reference` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-goal` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-host-directory-picker` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-host-plugin-inventory` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-jobs` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-llm-retry` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-message-feedback` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-scope` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-session-reference` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-settings` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-subagent` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-tool-todo` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-typert-protocol` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-user-approval` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-user-questions` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-util-values` | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-workspace` | `0.1.5-rc.1` |
| `@standard-schema/spec` | `1.1.0` |
| `@types/mdast` | `4.0.4` |
| `@types/unist` | `3.0.3` |
| `lexical` | `0.49.0` |
