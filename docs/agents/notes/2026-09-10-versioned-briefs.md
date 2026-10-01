# Agent Note: Versioned briefs and authoritative artifacts

Status: implemented

## Problem

A novel must retain its creative requirements beyond one conversation and after edits. Two Sessions can work on the same novel. Historical tool results must continue to identify the exact text they described, while retries, cancellation and preview-file changes must not silently replace that text. The [product specification](../../specs/story-writing-plugin/spec.md) requires independence from the Story backend and preservation of history.

## Decision

The writing service owns novel metadata, immutable creative-brief artifacts and Session selections in a DSH storage domain. A save persists content before publishing a reference and checks the expected revision inside the domain's serialized update. The novel record carries the request receipt with the published history, so a successful retry resolves to its original revision after restart. Exact reads verify artifact metadata and recomputed content measurements against the published reference; schema-valid corruption fails without rewriting storage.

Novel identities belong to the service; Session selection belongs to the Session and workspace. Creation does not select a novel. Tools derive the workspace from the actual DSH Session and carry identities returned by earlier logged results, keeping ownership outside model-supplied paths.

The Markdown preview is a rebuildable projection of an exact artifact. A missing file can be created from storage; an existing file must match the artifact. The card records the version path and uses the existing Session file opener. A preview edit does not create a writing revision.

The service uses the host's JSON or SQLite provider and domain lifecycle. It does not own another AgentLoop or provider runtime. Independent reads can overlap; per-Agent tool scheduling complements the service's revision check rather than replacing it.

## Alternatives considered

**A retained Story backend or dedicated database service.** This adds a second runtime and deployment dependency to a plugin required to run independently. DSH already supplies the storage and execution capabilities needed for the current project and brief workflow.

**Session logs or editable preview files as the novel authority.** Session logs describe interactions, and preview files serve document presentation. Neither provides the service-owned version comparison and cross-Session novel identity required by the writing workflow. They remain consumers of the authoritative artifacts.

**Overwriting the latest brief or relying on a tool's exclusive flag.** Overwriting loses historical text and changes what old references mean. An exclusive flag schedules one Agent's tool work; the expected-revision check protects the novel when different Sessions write.

## Consequences

The API preserves exact versions and returns the original result of an identical request. A stale revision or conflicting retry fails and requires the caller to reconsider its input. These behaviors prevent a successful old retry from overwriting a newer brief.

Content-first persistence avoids published references to content that has not finished saving, without assuming cross-record transactions. Failed or cancelled publication can leave an orphan artifact; public reads require membership in published history. There is no garbage collection or demonstrated multi-process writer coordination in T01.

Cancellation checks occur before mutation and between content persistence and reference publication. The domain's close operation drains its accepted work and prevents subsequent writes. The service does not promise rollback of an already accepted storage write.

## Verification

[Public service tests](../../../tests/service.spec.ts) use real JSON and SQLite providers and reopen fresh Contexts against the same private test medium. They cover concurrent successors, durable request replay, workspace ownership, exact historical reads and configured bounds. Schema-valid changes to persisted JSON text, artifact metadata and content counts must fail on reopened reads without repairing the file. Cancellation and close use the public domain-change event as a deterministic observation point after artifact persistence.

[The profile fixture](../../../tests/profile/README.md) exercises normal tool execution and document presentation with fixed text. [The API reference](../../api/writing-service.md) owns caller semantics; [the development guide](../../development/harness.md) owns current validation evidence. These checks do not establish generated-chapter quality or installation from a private distribution address.
