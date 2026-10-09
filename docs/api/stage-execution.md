---
description: "Native DSH child execution for a bounded writing-stage attempt."
---
# Stage execution

The executor uses the installed DSH 0.1.5-rc.1 native spawn, ToolRuntime, AgentLoop and JSONL Session persistence. Keyless integration tests verify stage execution; complete writing and browser validation remain separate acceptance work.

## Ownership

`executeStage(ctx, exec, request, config)` consumes the host's existing subagent runtime. The writing run owns the durable attempt before calling this function. The executor starts a fresh child through `ctx.subagents.start`, associates its Session with that attempt, awaits its structured result, and disposes it before returning. It does not create an AgentLoop or call a model adapter directly.

The configured provider must be the deployment's verified in-process spawn provider. DSH checks the requested output-schema, tool-filter and depth-limit capabilities before provider start. The executor also rejects a published run without `localAgent` and awaits its disposal. Public capabilities do not identify local or remote transports, so this returned-handle check cannot prevent an arbitrary remote provider from having already performed work. Deployment validation must establish the provider type before live use.

## Inputs and result

| Field | Meaning and downstream path |
| --- | --- |
| `ctx` | The host context exposing the shared subagent, Agent, Session, and LLM event capabilities. |
| `exec` | The actual parent ToolRuntime execution. Its Agent supplies lineage and the inherited model route; its signal owns cancellation. Agentless calls are rejected. |
| `request.attemptId` | The unique identity of a previously persisted attempt. Recorded as the child's one-shot descriptor label. The run owner must not reuse a live attempt ID. |
| `request.prompt` | A self-contained stage task with exact input versions and bounded evidence. Delivered as a logged child user message. |
| `request.outputSchema` | An object-root JSON Schema accepted by DSH's existing schema validator. The native child `structured_output` tool enforces it. |
| `request.onStarted(childSessionId)` | The owning run's durable association callback. It must persist the child identity before the executor admits its first model stream. Failure prevents generation and triggers awaited disposal. |
| `request.authorizeTool(execution)` | Optional asynchronous native tool admission for this exact child. The callback runs after durable association and before native side effects; rejection becomes a native tool error. Permission must derive from the recorded stage request. Its listener is removed after child disposal. |
| `config.stageProvider` | The registered in-process spawn provider name; this is not a model or LLM provider selection. |
| `config.maxDelegationDepth` | A non-negative safe integer passed as the absolute child delegation-depth cap. It does not count model requests. |
| `config.allowedTools` | The explicit inherited-tool allow list. Stage deployment grants only bounded artifact-reading tools; it must exclude tools that dispatch descendants or further model work. Native child structured capture remains available. Unknown names fail through the host's existing tool restriction validation. The host restriction filters only inherited tools, not registrations in the child's own scope (for example a per-Agent `subagent` delegation tool installed when the child is created), so the executor enforces the same set itself: before every child model request it checks the child's visible tools and fails with `stage-tool-scope` without sending the request when any tool outside the allow list and `structured_output` is visible (ToolRuntime's reserved `run_code` transport is exempt), and before every child tool execution it rejects any tool outside that set, including `run_code` sub-dispatches. |
| `config.maxStageRequests` | A positive safe integer bounding child model dispatch attempts, including retries. |
| `config.stageTimeoutMs` | An integer from 1 through 2147483647 covering startup, association, generation and disposal. Expiry propagates cancellation and still awaits owned work, including an association callback already in progress; it does not forcibly abandon persistence or cleanup. |
| `result.childSessionId` | The exact child Session containing the logged prompt, requests, tool calls and structured capture. |
| `result.structured` | The value captured by the native structured-output tool after a completed child turn. Stage-specific domain parsing remains the caller's responsibility. |

The executor passes no `agentOptions` override. DSH inherits the latest parent route according to its subagent implementation. The executor does not silently select another model, substitute a provider, accept plain assistant text as structured output, or replace a missing value with an empty object.

## Writing-stage schema publication

`nativeStageOutputSchema(kind)` derives each native schema from the matching entry in [`StageOutputSchemas`](../../src/stage-output.ts). The `kind` selects settings, review, book outline, chapter outline, body or continuity. Its returned object goes directly to `request.outputSchema`; the logged native tool definition exposes the same instructions to the child.

The installed DSH schema dialect enforces object properties, required fields, additional-property rules, arrays and items, scalar types, enums, constants and supported `oneOf` branches. The adapter preserves those fields and existing annotations, then calls DSH's `assertObjectJsonSchema`. It omits the root JSON Schema dialect label and Zod's non-enumerable `~standard` compiler metadata. Zod's emitted `minLength`, `minItems`, `pattern`, `exclusiveMinimum` and `maximum` constraints become explicit field descriptions because this DSH dialect does not enforce them. Every other unsupported keyword rejects publication with its schema path; the adapter does not discard unknown constructs or replace them with unconstrained values.

`projectNativeStageSchema(schema)` exposes this compiler adaptation for an object schema and returns the validated native object schema. It rejects malformed native fields and cyclic schema references. It is not the output admission validator. The run must still pass every captured value through the original stage parser, which enforces the original constraints, nonblank text, exact input versions, stage identity, required checks and quoted evidence. Chapter-total counting and application remain host-owned. Native structured capture alone cannot approve a candidate.

## Model request accounting

The admission listener uses the public `llm/stream` waterfall because it surrounds actual dispatch attempts, including retries within one AgentLoop step. `agent/request`, output token limits and delegation depth do not establish the same bound.

Native spawn can begin the child before `start()` returns. A temporary `session/event` listener therefore observes the one-shot descriptor matching the attempt label, configured provider and exact parent Session before the first stream. The stream listener then checks that child Session ID, waits for the durable association callback, checks cancellation and increments the attempt count before delegating with `next()`. Concurrent stage attempts must have separate identities, counters and disposal, and ordinary parent or unrelated child requests must remain unaffected.

The count covers the direct child Session. The stage tool allow list must prevent descendants or tools from independently dispatching additional model work. This measures admitted model dispatch attempts, not currency or a provider's final invoice. An adapter or external service may have accounting behavior outside this plugin's observation. Report provider-returned usage from child Session evidence separately; absent usage is unknown.

## Failure and recovery

Non-completed stop reasons, missing structured capture, budget exhaustion, timeout, cancellation and callback failure remain failed attempts. Cancellation is checked before start and again after child disposal so a late result cannot be published as success. The durable writing service rechecks its own run and input-version state before persisting or applying the returned candidate.

After a run is published, every exit path awaits `run.dispose()`. Execution and disposal failures retain their separate causes, using `AggregateError` with the execution failure as `cause` when both fail. Temporary model-stream, tool-admission and Session listeners and the deadline timer are removed after owned child work settles. A start rejection relies on the native provider's responsibility to dispose unpublished resources.

Plugin-owned errors have stable codes: `stage-config` for invalid finite limits or an empty provider name; `stage-provider` for a returned run without its local Agent; `stage-budget` for an exhausted dispatch allowance; `stage-timeout` for deadline expiry; `stage-malformed` when the child turn ends with DSH's `MALFORMED_RESPONSE` error code (a received model response that DSH could not decode, such as invalid `structured_output` JSON) and no structured capture; `stage-missing-result` when the child's turn ends normally (for example with plain assistant text) without calling `structured_output`; `stage-tool-scope` when the child can see or tries to call a tool outside its allow list, such as a subagent dispatch tool; and `stage-incomplete` for any other non-completed result or missing structured capture. The writing runner records a `stage-tool-scope` attempt as a known failure, not an unknown outcome, and does not retry it. Native startup, association and disposal errors retain their original values. The child Session preserves detailed model and tool failure evidence.

The native one-shot API cannot reserve a child ID before startup. The run owner records provisioning first and treats a crash before durable child association as outcome unknown. The executor does not automatically resend that attempt. Durable recovery, stop/resume and late-commit prevention belong to the writing-run service.

## Verification

[`tests/stage-executor.spec.ts`](../../tests/stage-executor.spec.ts) exercises the real parent tool and native child path with a scripted model adapter. Its cases cover structured success and inherited route, persisted prompt and child association, invalid structured-output retries, actual provider retries within one loop step, independent concurrent stage budgets, finite configuration, unsupported capabilities and unknown references, missing local Agent metadata, association failures, pre-start and in-flight cancellation, cancellation during disposal, deadline expiry, missing structured capture, model error and token exhaustion, and execution/disposal failure preservation. Tool-admission cases verify rejection before side effects and removal before another child executes. Tool-scope cases register a delegation tool in the child's own scope and verify that the stage fails before any model request, that a delegation tool appearing mid-stage is never executed, and that allowed artifact tools stay visible. Every published-child scenario asserts that no child Agent remains. Provider wrappers used for metadata or disposal failure cases still delegate execution and teardown to the actual native provider.

Run the focused suite with `node node_modules/vitest/vitest.mjs run tests/stage-executor.spec.ts --configLoader runner --cache=false`. It performs no external model calls. Scoped TypeScript and oxlint validation also cover the executor and its fixtures.

[`tests/native-stage-schema.spec.ts`](../../tests/native-stage-schema.spec.ts) adds 27 cases covering all six schemas through the installed validator and actual native child structured capture, inherited routing, strict structural rejection, preserved constraint descriptions, canonical rejection after capture, unsupported constructs and malformed topology. Run it with `node node_modules/vitest/vitest.mjs run tests/native-stage-schema.spec.ts --configLoader runner --cache=false`.

Real-model quality and the complete browser writing path remain part of [post-development validation](../development/post-development-validation.md).
