---
description: "Released DSH APIs for durable stage-file delivery and live Story tool cards without Host changes."
---
# Stage artifact presentation

## Summary

Current status, 2026-09-11: the exact native package was subsequently approved and installed, and Host delivery plus Client cards are implemented with focused fixture evidence. The investigation below retains its original pre-installation observations; [the dependency record](../development/stage-preview-dependencies.md) and [migration validation](../development/migration-validation.md) own current installation and acceptance status.

The viable route is programmatic execution of the Host's native `present` tool after each immutable artifact and complete Markdown projection are ready, followed by a pure Host projection of its built-in `deliverables/presented` events. The existing Story tool card can consume that projection through `useProjection` and retain the owning Session's `openFile` action. No new AgentLoop, fabricated model tool call, custom workbench, or Host edit is required. The native tool package is not installed in this project; [the dependency proposal](../development/stage-preview-dependencies.md) is pending approval.

## Verified released interfaces

| Interface | Observed behavior in `0.1.5-rc.1` |
| --- | --- |
| `ToolRunContext` from `@deepseek-ai/dsh-tools` | Exposes `deferContext` and `concludeTurn`; no progress emitter or mutable result metadata. Deferred context reaches the loop only after the final tool result. |
| `ToolDefinition.presentResult` / output presentation metadata | Derives the completed tool card from the settled result. It cannot append intermediate results to a running call. |
| `ctx.tools.execute` | Runs the actual registered tool through policy, guards, cancellation, dispatch, finalization, and result observers. A nested invocation accepts a distinct `callId`, the original `rootCallId`, and its parent's opaque `token`. |
| Native `present` | Exports `apply`, `Config`, and `name`; there is no separate presenter service. Requires `tools`, `fs`, and `sessionProjections`. Validates files and the open turn, then emits `deliverables/presented` only from its successful `tools/result` observer. |
| `@deepseek-ai/dsh-tool-present/types` | Exports `PresentedFile { path; description? }` and declares the built-in event `{ turn; callId; files }`, including nested calls. |
| `ctx.sessionProjections.register` | Registers a synchronous pure fold with state/view schemas and versioned cached state. The Host publishes complete changed views and reconstructs them from the Session log on cold reads. Registration has a disposer. |
| `useProjection` on Session standard props | Reads a whole Host-computed value or a selected subvalue and receives live projection frames and cold baselines. It can update a component independently of that component's frozen running tool block. |
| `tool.call.toolview` | Keys registration by the real wire tool name and supplies `callId`, the running/settled block, and Session-authorized `openFile`. It can host the existing Story document-card presentation for write/continue/update/revise calls. |

The released native tool source was downloaded from the [exact npm tarball](https://registry.npmjs.org/@deepseek-ai/dsh-tool-present/-/dsh-tool-present-0.1.5-rc.1.tgz), verified against registry SHA-512 integrity, and inspected without installation or execution. Other entries were checked against this project's installed public declarations and runtime files. Installed rc.1 agent preset files reference the same native package, and the installed Session event catalog includes `deliverables/presented`.

The adjacent DSH `ui-deliverables` implementation puts its file grid in the completed-turn tail. Its `present` row also requires an actual transcript tool block. A nested `ctx.tools.execute` call does not synthesize another model `tool/call`/`tool/result` pair. Therefore the existing completed-turn grid alone does not meet immediate presentation while a long `story_write` call remains running. A small Story toolview extension is required; it can reuse current card visuals and file actions.

## Why a new informational Session event is unsuitable

The installed `Session.append` signature accepts surface-placement options only for message-producing events. Its runtime copies `surfaceOp` and `sourceEventSeqs`; it does not accept or preserve `ignorable`. The exported `KNOWN_SESSION_EVENT_TYPES` is a generated `ReadonlySet`, and its documentation explicitly excludes repository-external event names. The public persistence validator refuses an unknown event unless the stored envelope carries `ignorable: true`. TypeScript declaration merging does not alter that runtime catalog.

A detached-session probe used the installed public `Session.create`, `Session.append`, and `validateStoredEvents` functions, without writing a Session file. Supplying a third JavaScript argument with `ignorable: true` produced an event whose marker remained absent; validating that event raised `SessionFormatUnsupportedError`. The same validator accepted the known `deliverables/presented` fields. This establishes the API incompatibility; it is not a native-present execution or a JSONL restart test.

Do not mutate the catalog, bypass public append, write a custom event directly into persistence, or represent a program action as a model tool call. Direct plugin `user/message` notices would alter model history while an outer tool is unfinished and do not provide the requested file-delivery semantics; deferred notices arrive too late. The native producer supplies the appropriate existing event.

## Publication, correlation, and replay

1. Persist the stage artifact and publish its exact reference through the writing service. Include research plans/evidence, dimensions, assembled settings, all candidates and reviews, bodies, continuity, and every repaired version.
2. Build and validate the complete Markdown projection through the existing projection owner. Preserve the artifact-specific path, reject a modified existing projection, and check cancellation. Native `present` declares current filesystem content; it does not create an immutable copy or verify the writing artifact hash. Immutability and exact rendering therefore remain the Story projection owner's responsibility.
3. Give the native invocation a fresh plugin-owned `ToolCallId`. Keep `rootCallId: exec.rootCallId`, `parent: exec.token`, the same `agent`, and the captured invocation `signal`. Supply exactly the ready path and a human stage/version description in `files`; never hide machine metadata in the description.
4. Check the nested result for failure. `tools/result` observers contain their own exceptions, so success alone does not prove the delivery event was appended. Verify the exact event for this invocation in the Session suffix, including turn, call ID, and files; then await `ctx.sessions.flush(session)` before declaring durable presentation or advancing to another stage.
5. Derive the Client card index only from verified built-in delivery events. The event has no parent ID, so use a plugin-owned, versioned opaque invocation-ID format containing the owning Story tool call ID, run ID, artifact ID, and a fresh nonce. For example, prefix `dsh-story-present/v1/` followed by individually URL-encoded identity segments. The parser must round-trip and reject malformed or unrelated IDs. No caller reuses the parent's ID for the nested invocation.
6. Key UI data by the actual owning Story tool call ID. For a direct call this equals `rootCallId`; under PTC the outer root may be `run_code`, so the Story subcall's `exec.callId` remains the card identity. Native execution still propagates the true outer `rootCallId` for runtime policy and correlation.
7. Deduplicate display and resume by Session/run/artifact identity, not by the fresh invocation nonce. Before repeating delivery after recovery, reconstruct matching committed events from the persisted Session, rebuild or verify the same projection, and reuse the prior delivery when present. If a crash occurred before the delivery event became durable, repeat only projection/presentation, not a completed model stage. A separate run receipt may lag a successfully flushed event, so it cannot be the sole delivery authority.

The proposed Host fold stores ordinary JSON and validates persisted state plus wire output. It returns the same state object for unrelated events. Its changed wire value contains the complete card list keyed by owning call; no new state event is appended. The Client reads only its call's entries and uses its existing `openFile`. File paths, descriptions, source artifact identities, and order remain reconstructable from logged data and the immutable writing store.

A registered package is not proof the named tool is available in this actor's scope. Resolve the native tool for the actual agent before starting a run and fail clearly when unavailable. Every required policy decision remains inside native ToolRuntime execution; no direct call to the tool implementation bypasses guards. Presentation introduces no human approval gate in the writing workflow, while genuine Host permission failures remain visible failures.

## Required integration evidence

The next offline fixture must mount the real released native package after dependency approval and demonstrate delivery before the outer tool finishes, full projection bytes, exact call association, parallel artifact retention, cancellation, explicit delivery failure, missing-event detection, and JSONL flush/reopen. The Client fixture must show a running card receives a new entry through `useProjection` and reopens the same artifact after reload. Browser and production-model acceptance remain separate and unperformed in this research.

## Confidence and remaining uncertainty

Confidence is high for the inspected released API fields, the unknown-event incompatibility probe, the native package's producer implementation, and dependency classification. Confidence is provisional for the complete programmatic-delivery-to-Client flow until the released package is installed in the isolated fixture and the live/cold paths are exercised. The adjacent checkout's rc.2 UI source informs placement, but does not substitute for a released rc.1 browser run.

Useful findings are the existing native producer, durable known event, pure projection service, per-call Client hook, and bounded registration lifecycle. Result metadata streaming, custom required events, fake transcript calls, and the completed-turn grid alone do not satisfy the requested behavior. The dependency and fixture plan above is the next concrete step.
