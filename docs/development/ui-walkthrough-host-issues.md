---
description: "Evidence that the present.open 500s and the filemanager icon 404 seen in the offline UI walkthrough come from DSH 0.2.0-rc.2 on a Linux host without GIO, not from dsh-story."
---
# UI walkthrough: host-side console errors

The 2026-10-10 offline UI walkthrough (DSH 0.2.0-rc.2, Linux box with `DISPLAY=:5`) reported two console errors besides the code-block preview. The preview issue is fixed in this package; see [readable Markdown](../api/readable-markdown.md). Both errors below come from Host packages and appear for any presented file or Session. This package cannot avoid them without dropping the required native `present` delivery.

## `GET /api/present.open?…&index=0` returns 500

- Source of the request: each native delivery card mounts `FileRouteAction` from `@deepseek-ai/dsh-client-ui-open-in-app`. It sends a `GET` to the card's `present.open` route to list the file's associated applications for the "Open" menu. It does not open the file. Opening and preview use separate routes, so previews still work.
- Host handler: `@deepseek-ai/dsh-client-ui-deliverables` `handlePresentOpen` reads the `deliverables/presented` event, stats the declared file, then calls `sessionController.workspacePathApplications`. On Linux, `@deepseek-ai/dsh-native-command` runs `gio info -a standard::content-type <path>`.
- Failure: `gio` (package `libglib2.0-bin`) is not installed on the box, so the spawn fails with `ENOENT`. `workspacePathApplications` wraps every non-Remote error as `RemoteError('gateway/internal')`, and the route's `failureStatus` maps that to 500. The original `ENOENT` code is lost in the wrapping, so the route does not answer with its usual 404.
- The plugin's payloads are valid. The 16 `deliverables/presented` events in the walkthrough Session (seq 24, 29, 34 … 175) each declare one existing absolute `.md` file inside the Session cwd. A direct `nativeFileApplications` call fails identically for an unrelated file, `/workspace/dsh-ui/README.md`: `ENOENT spawn gio ENOENT`.
- Workarounds: install `libglib2.0-bin` on the deployment host so GIO can answer, possibly with an empty list, or run without `DISPLAY` so the Host reports no desktop and skips the query. Host fix: treat a missing `gio` as "no association adapter" (an empty list), as the open-in-app README already describes for unsupported platforms.

## `GET /open-in-app/icon/filemanager` returns 404

- Source of the request: the Session header and file-tree "Open In…" split button (`OpenInAppAction` in `@deepseek-ai/dsh-client-ui-open-in-app`) builds `open-in-app/icon/<appId>` for every application that `/open-in-app/apps` reports. On this box that is `{"apps":["filemanager"]}`. No dsh-story source or built file references `open-in-app` or `filemanager`.
- Failure: in `@deepseek-ai/dsh-host-open-in-app`, the Linux catalog entry is `{ id: 'filemanager', platforms: { linux: spec(desktopCli('xdg-open')) } }`. `spec` carries no `desktopId`, so `extractAppIcon` always returns null on Linux and the icon route answers 404. The module comment states that the browser then shows a generic glyph.
- Host fix: give the Linux file-manager entry a desktop entry or a bundled fallback icon, or let the client use its built-in folder icon for `filemanager`. No plugin change applies.
