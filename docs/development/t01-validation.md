---
description: "T01 test, built-profile and exact-version preview evidence, with remaining acceptance work."
---
# T01 validation record

## Summary

This record covers T01 on 2026-09-10. The local checks, real tool flow and historical preview observations below passed. T01 is awaiting final UI human acceptance. Final UI readback after Host restart has passed. [The development guide](harness.md) owns command responsibilities and isolation requirements.

## Table of Contents

- [Validation status](#status)
- [Local checks and packaging](#local)
- [Built profile and browser flow](#web)
- [Session and storage evidence](#persistence)
- [Execution conditions and remaining work](#remaining)
- [Dev Note](#dev-note)

<a id="status"></a>
## Validation status

Each result applies only to its named observation. Deterministic fixtures do not establish production-model writing quality; packing does not establish installation.

| Check | Result | Evidence scope |
| --- | --- | --- |
| Local typecheck, lint, tests and build | Passed, exit 0 | 71 Vitest and 12 Node cases; none skipped. |
| Built Host and Client loading | Passed | Independent `lib/index.js`; Client boot module `dsh-story`. |
| Create → preview → save → preview | Passed | Real workspace and Session; four successful writing-tool results. |
| Historical preview after update | Passed | Old card opens revision 1; Host file RPC reaches its actual EOF. |
| Session and stored artifacts | Passed | 44 contiguous events; metadata, references and physical Markdown match. |
| Browser console before restart | Passed for the observed flow | 0 warnings and 0 errors; excludes intentional restart and reconnect logs. |
| New Host process and UI readback | Passed | Both saved cards reopened and reached their distinct EOF markers on port `51212`; new-page console has 0 errors and 0 warnings. |
| Final archive inspection | Passed, exit 0 | Final local archive has 22 entries, including built Host, Client, declarations and patch. |
| Final UI human acceptance | Pending | Automated restart validation passed; user acceptance remains outstanding. |

<a id="local"></a>
## Local checks and packaging

This combination completed with exit 0 in the independent project:

```sh
npm run typecheck && npm run lint && npm test && npm run build
```

Vitest passed 33 service, 21 configuration, 6 projection, 6 Client and 5 tool cases, for 71 total. Node passed 12 build and profile-fixture cases. There were no skips. The complete paged-read inline snapshot passed.

The integrity gap found during review is covered by five real-JSON corruption regressions: changed text, changed artifact revision, rewritten text with self-consistent artifact metadata, changed character counts and changed byte counts. [The service tests](../../tests/service.spec.ts) verify explicit failures and unchanged damaged files.

Archive inspection uses the following command, replacing the placeholder with an existing temporary directory:

```text
npm pack --ignore-scripts --pack-destination <temporary-directory> --json
```

The final local archive contains 22 entries and is 19,221 bytes. It contains the built Host, Client, declarations and bundle patch without source, tests or working data. Its SHA-1 is `f6f09204e997bd165632c4fb613d16c73cec080d`; the pack manifest is saved as `package-evidence.json` in the temporary run directory. No archive has been published or installed from a private address.

<a id="web"></a>
## Built profile and browser flow

The supported built `dsh --profile web` launcher runs under plain Node and loads the independent project's `lib/index.js` without TSX. The browser boot graph contains module ID `dsh-story`. The local Client artifact is 6,809 bytes and its only external runtime require is `react/jsx-runtime`. Fetching the restarted Host's boot script returns HTTP 200 and 6,891 bytes, including the Host wrapper; its content registers `dsh-story` through `window.__ModuleLoader__.load`.

The isolated fixture uses a real workspace and Session with the existing conversation, tool cards and document preview. The actual sequence is `story_create_novel` → `story_preview` → `story_save_brief` → `story_preview`. [The fixture guide](../../tests/profile/README.md) owns the fixed commands and composition.

Both saved versions contain 5,207 lines. After saving revision 2, reopening the old card still opens revision 1. The observed `workspaceFiles/read` RPC returns 5,000 lines from offset 1 with `eof: false`, then 207 lines from offset 5,001 with `eof: true`. These are Host line offsets, not writing-service Unicode code-point offsets.

The historical read contains `T01_INITIAL_END_7F3A` and not `T01_UPDATED_END_9C6B`; the observed failure-marker count is 0. Console counts were 0 warnings and 0 errors for this flow before restart. No zero-error claim covers the whole browser session across intentional disconnection and reconnection.

After restart, the new page reopened the persisted Session and both historical cards. Opening revision 2 and revision 1 separately, then loading more, reached each version's unique end marker. Revision 1 did not contain the revision 2 marker; the failed-DOM count was 0. The new page separately reported 0 console errors and 0 warnings.

A captured historical EOF response after restart had HTTP 200, `result.ok: true`, offset 5,001, 207 lines, `eof: true` and the initial-version marker. The restart screenshot shows the old-version card, two document tabs and the initial end marker.

<a id="persistence"></a>
## Session and storage evidence

The test Session is `session-2b640d7e-d30e-4e84-858d-525875fd20e6`. The installed public Session persistence API opened it read-only without a write lease. The validated log has 44 contiguous events, sequence 0–43, with four tool calls and four successful results. Both preview metadata objects exactly equal their JSON tool results.

Storage has one novel, two artifacts and current revision 2. Recomputed hashes, Unicode counts and byte counts match the stored metadata and published references. Both physical Markdown files equal their corresponding stored text.

| Revision | Unicode code points | UTF-8 bytes | Reference and Markdown |
| --- | --- | --- | --- |
| 1 | 57,291 | 109,409 | Exact match. |
| 2 | 57,293 | 109,415 | Exact match. |

The read-only JSON evidence was collected at `2026-09-10T11:12:15.371Z`. It retains event positions, artifact identities, SHA-256 values and preview paths. These temporary local files are outside the repository and release contents:

```text
/private/tmp/dsh-story-t01-web-01/session-evidence.json
/private/tmp/dsh-story-t01-web-01/host.log
/private/tmp/dsh-story-t01-web-01/after-load-more.png
/private/tmp/dsh-story-t01-web-01/updated-preview.png
/private/tmp/dsh-story-t01-web-01/restarted-old-version.png
```

<a id="remaining"></a>
## Execution conditions and remaining work

Old Host PID `89226` exited normally with code 0. New PID `44171` started on port `51212` under execution session `50051` with the latest build. The saved Session and previews passed the UI readback above. Only this test server remains running for human acceptance; no other test process remains. The Host log contains startup information and no errors.

Sandboxed Host startup encountered `EMFILE`; an unchanged launch with the required Host escalation succeeded. Automatic permission review, including the first navigation to the restarted URL, timed out and then succeeded on retry. These were timeouts, not safety rejections.

Linux and Node 22 CI have not run. No production model has been called. T02 and later automatic writing stages are unimplemented, including settings, outlines, bodies, review and repair, and cross-chapter continuity.

T15 private-address installation and remote publication have not been performed. The private repository has no source commit or release; this validation made no commit or push. Built-profile loading and archive inspection do not establish a distributable fixed-version installation address.

<a id="dev-note"></a>
## Dev Note

None.
