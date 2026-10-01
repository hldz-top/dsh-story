# T01 dependency installation checklist

This checklist records the exact versions pinned in package.json. At the time it was prepared, only the checklist and compiler configuration were ready; installation had not started. The user had authorized implementation within the specification by asking to continue. Dependency installation still required separate approval under the personal development workflow.

DSH packages are pinned to `0.1.5-rc.1`, Cordis to `4.0.2`, Schemastery to `3.18.2`, and Zod to `4.4.3`. Development tools are pinned to TypeScript `6.0.3`, Vitest `4.1.8`, Oxlint `1.76.0`, tsdown `0.22.2`, and Node types `22.20.0`. The Client uses React `18.3.1` and React types `18.3.31`. [package.json](../../package.json) owns the complete direct dependency list; the DSH latest tag does not identify the version used by this project.

The packages come from the public npm registry. DSH and Cordis expose the host's pre-stable APIs, so versions must remain pinned and compatibility must be checked through an independent installation and type and behavior tests. Installation will resolve transitive dependencies into the lockfile. Test libraries are used only locally and in CI; they are not part of the plugin's runtime behavior.

The command proposed for separate approval was `pnpm install --ignore-scripts`, run from this project's directory. It downloads public dependencies and creates this project's node_modules, pnpm-lock.yaml, and package-manager cache entries. Dependency installation scripts remain disabled. The command does not install into the user's everyday DSH profile or change Story or host dependencies. If a build requires a dependency script, report the specific package and reason before enabling it.

The alternative is to continue read-only design work. Source aliases into adjacent repositories do not establish acceptance for independent plugin development or distribution.
