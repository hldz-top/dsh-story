import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { parseNovelId, parseArtifactId, parseRequestId, type Actor } from '../src/contracts.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { WritingRun, RunOutput, RunServiceLimits } from '../src/run-store.ts'
import { useRunStorage } from './support/run-storage.ts'

const serviceLimits = { maxArtifactBytes: 4096, maxReadChars: 512, maxResearchQuestions: 8, maxResearchCalls: 4, maxResearchSources: 8, maxEvidenceChars: 2048, maxResearchLogEvents: 200 }
const limits = { maxAttempts: 8, maxOutputBytes: 4096 }
const owner: Actor = { workspace: '/author', sessionId: brandString<SessionId>('author-session') }
const childId = brandString<SessionId>('child-session')
const input = {
  serviceLimits,
  novelId: parseNovelId('novel_00000000-0000-4000-8000-000000000001'),
  requestId: parseRequestId('write-first'),
  briefArtifactId: parseArtifactId('artifact_00000000-0000-4000-8000-000000000002'),
  executionLimits: { maxRepairAttempts: 2, maxParallelStages: 2, maxStageRequests: 3, stageTimeoutMs: 1000, maxDelegationDepth: 1, minChapterWords: 3000, maxChapterWords: 5000, stageProvider: 'fixture-spawn' },
  settingsRoots: ['a1'], chapterCount: 3, fromChapter: 1, throughChapter: 3, mode: 'write' as const, revision: null,
}

const stage = { key: 'settings:a1', prompt: 'Write settings using the supplied brief.', inputRefs: [{ artifactId: input.briefArtifactId, sha256: 'a'.repeat(64) }], outputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'], additionalProperties: false } }

it.each([
  { maxAttempts: 0, maxOutputBytes: 1 }, { maxAttempts: 1, maxOutputBytes: 0 },
  { maxAttempts: Infinity, maxOutputBytes: 1 }, { maxAttempts: 1, maxOutputBytes: 1.5 },
])('refuses non-finite or non-integer run-store limits: %j', async invalid => {
  await expect(useRunStorage('json', invalid).then(() => 'opened')).rejects.toMatchObject({ code: 'invalid-input' })
})

it.each(['text-digest', 'reference-digest', 'missing-output', 'duplicate-attempt', 'duplicate-run', 'wrong-novel', 'wrong-output-key', 'unsupported-schema', 'unknown-field', 'classified-success', 'unknown-failure-kind'] as const)('refuses durable run corruption before recovery rewrites: %s', async corruption => {
  const h = await useRunStorage('json', limits)
  const run = await h.store.begin(owner, input)
  const attempt = await h.store.prepareAttempt(owner, run.id, stage)
  await h.store.associateChild(owner, run.id, attempt.id, childId)
  await h.store.saveOutput(owner, run.id, attempt.id, 'Actual stage output')
  await h.store.close()
  const file = join(h.root, 'data', 'story_runs.json')
  const stored: { tables: { novels: Record<string, { novelId: string; runs: WritingRun[] }>; outputs: Record<string, RunOutput> } } = JSON.parse(await readFile(file, 'utf8'))
  const history = stored.tables.novels[input.novelId]
  const savedRun = history?.runs[0]
  const savedAttempt = savedRun?.attempts[0]
  const savedOutput = stored.tables.outputs[attempt.id]
  if (history === undefined || savedRun === undefined || savedAttempt?.output === null || savedAttempt?.output === undefined || savedOutput === undefined) throw new Error('Complete saved fixture is missing')
  if (corruption === 'text-digest') savedOutput.text = 'Altered stage output'
  if (corruption === 'reference-digest') savedAttempt.output.sha256 = 'b'.repeat(64)
  if (corruption === 'missing-output') delete stored.tables.outputs[attempt.id]
  if (corruption === 'duplicate-attempt') Object.assign(savedRun, { attempts: [...savedRun.attempts, structuredClone(savedAttempt)] })
  if (corruption === 'duplicate-run') history.runs.push(structuredClone(savedRun))
  if (corruption === 'wrong-novel') savedRun.novelId = parseNovelId('novel_00000000-0000-4000-8000-000000000003')
  if (corruption === 'wrong-output-key') { delete stored.tables.outputs[attempt.id]; stored.tables.outputs['attempt_00000000-0000-4000-8000-000000000004'] = savedOutput }
  if (corruption === 'unsupported-schema') {
    const rawAttempt: { request: { outputSchema: object } } = JSON.parse(JSON.stringify(savedAttempt))
    rawAttempt.request.outputSchema = { type: 'array', items: { type: 'string' } }
    Object.assign(savedAttempt, rawAttempt)
  }
  if (corruption === 'unknown-field') Object.assign(savedRun, { approved: true })
  if (corruption === 'classified-success') Object.assign(savedAttempt, { failureKind: 'truncated' })
  if (corruption === 'unknown-failure-kind') Object.assign(savedAttempt, { status: 'failed', output: null, error: 'Empty result', failureKind: 'empty' })
  const corrupted = JSON.stringify(stored)
  await writeFile(file, corrupted)
  await expect(h.restart().then(() => 'opened')).rejects.toThrow()
  expect(await readFile(file, 'utf8')).toBe(corrupted)
})

describe.each(['json', 'sqlite'] as const)('%s durable writing runs', backend => {
  it('begins one owned run, coalesces its request and recovers an interrupted run', async () => {
    const h = await useRunStorage(backend, limits)
    const [first, repeated] = await Promise.all([h.store.begin(owner, input), h.store.begin(owner, input)])
    expect(first).toEqual(repeated)
    expect(first).toMatchObject({ ...input, status: 'running', startedBy: owner.sessionId, attempts: [] })
    expect(first.id).toMatch(/^run_[0-9a-f-]{36}$/)
    await expect(h.store.begin(owner, { ...input, requestId: parseRequestId('second') })).rejects.toMatchObject({ code: 'active-run' })
    expect(h.store.get(owner, first.id)).toEqual(first)
    expect(h.store.list(owner, input.novelId)).toEqual([first])
    expect(() => h.store.get({ ...owner, workspace: '/other' }, first.id)).toThrowError(expect.objectContaining({ code: 'workspace-mismatch' }))
    expect(() => h.store.list({ ...owner, workspace: '/other' }, input.novelId)).toThrowError(expect.objectContaining({ code: 'workspace-mismatch' }))
    await h.restart()
    expect(h.store.get(owner, first.id)).toMatchObject({ id: first.id, status: 'interrupted', attempts: [] })
    expect(await h.store.begin(owner, input)).toMatchObject({ id: first.id, status: 'interrupted' })
    await expect(h.store.begin(owner, { ...input, throughChapter: 2 })).rejects.toMatchObject({ code: 'request-conflict' })
  })
  it('saves a prepared attempt before its child and reuses exact immutable output after reopen', async () => {
    const h = await useRunStorage(backend, limits)
    const run = await h.store.begin(owner, input)
    const prepared = await h.store.prepareAttempt(owner, run.id, stage)
    expect(prepared).toMatchObject({ key: stage.key, status: 'prepared', inputRefs: stage.inputRefs, childSessionId: null, output: null })
    expect(prepared.id).toMatch(/^attempt_[0-9a-f-]{36}$/)
    expect(h.store.get(owner, run.id).attempts).toEqual([prepared])
    expect(JSON.stringify(h.store.get(owner, run.id))).not.toContain(stage.prompt)
    expect(await h.store.prepareAttempt(owner, run.id, stage)).toEqual(prepared)
    await expect(h.store.prepareAttempt(owner, run.id, { ...stage, prompt: 'Different prompt' })).rejects.toMatchObject({ code: 'attempt-conflict' })
    await h.store.associateChild(owner, run.id, prepared.id, childId)
    const completed = await h.store.saveOutput(owner, run.id, prepared.id, '你好🌍')
    expect(completed).toMatchObject({ status: 'succeeded', childSessionId: childId, output: { attemptId: prepared.id, bytes: 10, chars: 3 } })
    expect(h.store.readOutput(owner, run.id, prepared.id)).toMatchObject({ text: '你好🌍', bytes: 10, chars: 3 })
    expect(JSON.stringify(h.store.get(owner, run.id))).not.toContain('你好🌍')
    await expect(h.store.saveOutput(owner, run.id, prepared.id, 'changed')).rejects.toMatchObject({ code: 'output-conflict' })
    await h.restart()
    expect(h.store.get(owner, run.id).attempts).toEqual([completed])
    expect(h.store.readOutput(owner, run.id, prepared.id).text).toBe('你好🌍')
    await h.store.resume(owner, run.id, { retryUnknown: false })
    expect(await h.store.prepareAttempt(owner, run.id, stage)).toEqual(completed)
    expect(await h.store.finish(owner, run.id, 'completed')).toMatchObject({ status: 'completed' })
    await h.restart()
    expect(h.store.get(owner, run.id).status).toBe('completed')
  })

  it('requires explicit unknown retry, retains old attempts and completes only the latest stage versions', async () => {
    const h = await useRunStorage(backend, limits)
    const run = await h.store.begin(owner, input)
    const original = await h.store.prepareAttempt(owner, run.id, stage)
    await h.store.associateChild(owner, run.id, original.id, childId)
    await h.restart()
    expect(h.store.get(owner, run.id)).toMatchObject({ status: 'interrupted', attempts: [{ id: original.id, status: 'unknown', childSessionId: childId, retryAuthorized: false }] })
    await expect(h.store.resume(owner, run.id, { retryUnknown: false })).rejects.toMatchObject({ code: 'unknown-outcome' })
    await expect(h.store.prepareAttempt(owner, run.id, stage)).rejects.toMatchObject({ code: 'run-state' })
    await h.store.resume(owner, run.id, { retryUnknown: true })
    const replacement = await h.store.prepareAttempt(owner, run.id, stage)
    expect(replacement).toMatchObject({ status: 'prepared', childSessionId: null, output: null })
    expect(replacement.id).not.toBe(original.id)
    expect(h.store.get(owner, run.id).attempts[0]).toMatchObject({ id: original.id, status: 'unknown', retryAuthorized: false })
    await h.store.associateChild(owner, run.id, replacement.id, brandString<SessionId>('replacement-child'))
    await h.store.saveOutput(owner, run.id, replacement.id, 'recovered result')
    await h.store.finish(owner, run.id, 'stopped', 'Author stopped after saving')
    await h.restart()
    await h.store.resume(owner, run.id, { retryUnknown: false })
    expect(await h.store.prepareAttempt(owner, run.id, stage)).toMatchObject({ id: replacement.id, status: 'succeeded' })
    expect(await h.store.finish(owner, run.id, 'completed')).toMatchObject({ status: 'completed' })
  })

  it('records known failures and counts replacement attempts against the finite run budget', async () => {
    const h = await useRunStorage(backend, { ...limits, maxAttempts: 2 })
    const run = await h.store.begin(owner, input)
    const first = await h.store.prepareAttempt(owner, run.id, stage)
    expect(await h.store.failAttempt(owner, run.id, first.id, { outcome: 'failed', message: 'Provider rejected before streaming' })).toMatchObject({ status: 'failed', error: 'Provider rejected before streaming' })
    const second = await h.store.prepareAttempt(owner, run.id, stage)
    expect(second.id).not.toBe(first.id)
    await h.store.failAttempt(owner, run.id, second.id, { outcome: 'unknown', message: 'Connection ended without an outcome' })
    await expect(h.store.prepareAttempt(owner, run.id, stage)).rejects.toMatchObject({ code: 'unknown-outcome' })
    await h.store.resume(owner, run.id, { retryUnknown: true })
    await expect(h.store.prepareAttempt(owner, run.id, stage)).rejects.toMatchObject({ code: 'attempt-budget' })
    expect(await h.store.finish(owner, run.id, 'failed', 'Attempt budget exhausted')).toMatchObject({ status: 'failed', error: 'Attempt budget exhausted' })
    expect(h.store.get(owner, run.id).attempts).toHaveLength(2)
  })

  it('records provider refusals and length cut-offs as explicitly classified failed attempts that survive restart', async () => {
    const h = await useRunStorage(backend, limits)
    const run = await h.store.begin(owner, input)
    const refused = await h.store.prepareAttempt(owner, run.id, stage)
    await h.store.associateChild(owner, run.id, refused.id, childId)
    expect(await h.store.failAttempt(owner, run.id, refused.id, { outcome: 'failed', message: 'Writing stage was refused by the model provider (refusal)', kind: 'refused' }))
      .toMatchObject({ status: 'failed', output: null, failureKind: 'refused' })
    const truncated = await h.store.prepareAttempt(owner, run.id, stage)
    await h.store.associateChild(owner, run.id, truncated.id, brandString<SessionId>('child-session-2'))
    await h.store.failAttempt(owner, run.id, truncated.id, { outcome: 'failed', message: 'Writing stage output was truncated', kind: 'truncated' })
    const plain = await h.store.prepareAttempt(owner, run.id, stage)
    await h.store.failAttempt(owner, run.id, plain.id, { outcome: 'failed', message: 'Provider rejected before streaming' })
    await expect(h.store.finish(owner, run.id, 'completed')).rejects.toMatchObject({ code: 'attempt-state' })
    await h.store.finish(owner, run.id, 'failed', 'Writing stage output was truncated')
    await h.restart()
    const readback = h.store.get(owner, run.id)
    expect(readback.attempts.map(attempt => [attempt.status, attempt.failureKind])).toEqual([['failed', 'refused'], ['failed', 'truncated'], ['failed', undefined]])
    expect('failureKind' in readback.attempts[2]!).toBe(false)
    expect(readback.attempts.every(attempt => attempt.output === null)).toBe(true)
  })

  it('refuses to classify an uncertain or unknown attempt outcome as a refusal or truncation', async () => {
    const h = await useRunStorage(backend, limits)
    const run = await h.store.begin(owner, input)
    const attempt = await h.store.prepareAttempt(owner, run.id, stage)
    await expect(h.store.failAttempt(owner, run.id, attempt.id, { outcome: 'unknown', message: 'Lost connection', kind: 'truncated' })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(h.store.failAttempt(owner, run.id, attempt.id, { outcome: 'failed', message: 'Odd', kind: 'empty' as 'refused' })).rejects.toMatchObject({ code: 'invalid-input' })
    expect(h.store.get(owner, run.id).attempts[0]).toMatchObject({ status: 'prepared' })
  })

  it('rejects completing a run whose latest attempt for a key is a known failure rather than a success', async () => {
    const h = await useRunStorage(backend, limits)
    const run = await h.store.begin(owner, input)
    const attempt = await h.store.prepareAttempt(owner, run.id, stage)
    await h.store.failAttempt(owner, run.id, attempt.id, { outcome: 'failed', message: 'Provider rejected before streaming' })
    await expect(h.store.finish(owner, run.id, 'completed')).rejects.toMatchObject({ code: 'attempt-state' })
    expect(h.store.get(owner, run.id).status).toBe('running')
  })

  it('recovers output written before its pointer by exact attempt ID after an aborted save', async () => {
    const h = await useRunStorage(backend, limits)
    const run = await h.store.begin(owner, input)
    const failed = await h.store.prepareAttempt(owner, run.id, stage)
    await h.store.failAttempt(owner, run.id, failed.id, { outcome: 'failed', message: 'Known failed request' })
    const exact = await h.store.prepareAttempt(owner, run.id, stage)
    const other = await h.store.prepareAttempt(owner, run.id, { ...stage, key: 'settings:a2' })
    await h.store.associateChild(owner, run.id, exact.id, childId)
    const controller = new AbortController()
    h.onStored(table => { if (table === 'outputs') controller.abort(new Error('Stop after raw output durability')) })
    await expect(h.store.saveOutput({ ...owner, signal: controller.signal }, run.id, exact.id, 'Durable before pointer')).rejects.toThrow('Stop after raw output durability')
    expect(() => h.store.readOutput(owner, run.id, exact.id)).toThrowError(expect.objectContaining({ code: 'output-not-found' }))
    await h.store.finish(owner, run.id, 'stopped', 'Stopped by author')
    await h.restart()
    expect(h.store.get(owner, run.id)).toMatchObject({ status: 'stopped', attempts: [
      { id: failed.id, status: 'failed', output: null },
      { id: exact.id, status: 'succeeded', output: { attemptId: exact.id } },
      { id: other.id, status: 'unknown', output: null },
    ] })
    expect(h.store.readOutput(owner, run.id, exact.id).text).toBe('Durable before pointer')
    await expect(h.store.resume(owner, run.id, { retryUnknown: false })).rejects.toMatchObject({ code: 'unknown-outcome' })
    await h.store.resume(owner, run.id, { retryUnknown: true })
    expect(await h.store.prepareAttempt(owner, run.id, stage)).toMatchObject({ id: exact.id, status: 'succeeded' })
  })

  it('fixes attempt and UTF-8 output budgets at run creation across configuration changes', async () => {
    const h = await useRunStorage(backend, { maxAttempts: 1, maxOutputBytes: 9 })
    const run = await h.store.begin(owner, input)
    const prepared = await h.store.prepareAttempt(owner, run.id, stage)
    await h.store.associateChild(owner, run.id, prepared.id, childId)
    await expect(h.store.saveOutput(owner, run.id, prepared.id, '你好🌍')).rejects.toMatchObject({ code: 'output-budget' })
    expect(h.store.get(owner, run.id).attempts[0]).toMatchObject({ status: 'running', output: null })
    await h.store.failAttempt(owner, run.id, prepared.id, { outcome: 'failed', message: 'Output byte budget exceeded' })
    await h.store.finish(owner, run.id, 'failed')
    await h.restart({ maxAttempts: 20, maxOutputBytes: 8000 })
    await h.store.resume(owner, run.id, { retryUnknown: false })
    await expect(h.store.prepareAttempt(owner, run.id, stage)).rejects.toMatchObject({ code: 'attempt-budget' })
    expect(h.store.get(owner, run.id)).toMatchObject({ limits: { maxAttempts: 1, maxOutputBytes: 9 } })
  })

  it('serializes competing begins and stage preparations under one novel and its attempt budget', async () => {
    const h = await useRunStorage(backend, { ...limits, maxAttempts: 1 })
    const competing = await Promise.allSettled([
      h.store.begin(owner, input), h.store.begin(owner, { ...input, requestId: parseRequestId('competing') }),
    ])
    expect(competing.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    const run = h.store.list(owner, input.novelId)[0]
    if (run === undefined) throw new Error('Winning run is missing')
    const stages = await Promise.allSettled([
      h.store.prepareAttempt(owner, run.id, stage), h.store.prepareAttempt(owner, run.id, { ...stage, key: 'other-stage' }),
    ])
    expect(stages.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(h.store.get(owner, run.id).attempts).toHaveLength(1)
    await h.restart()
    await expect(h.store.begin(owner, { ...input, requestId: parseRequestId('after-interruption') })).rejects.toMatchObject({ code: 'active-run' })
  })

  it('checks cancellation inside queued updates and lets an unaborted cleanup actor stop the run', async () => {
    const h = await useRunStorage(backend, limits)
    const before = new AbortController()
    before.abort(new Error('Stop before creating work'))
    await expect(h.store.begin({ ...owner, signal: before.signal }, input)).rejects.toThrow('Stop before creating work')
    expect(h.store.list(owner, input.novelId)).toEqual([])
    const run = await h.store.begin(owner, input)
    const controller = new AbortController()
    h.onStored(table => {
      if (table === 'novels' && h.store.get(owner, run.id).attempts.some(attempt => attempt.key === stage.key)) controller.abort(new Error('Stop queued stage'))
    })
    const queued = await Promise.allSettled([
      h.store.prepareAttempt(owner, run.id, stage),
      h.store.prepareAttempt({ ...owner, signal: controller.signal }, run.id, { ...stage, key: 'cancelled-stage' }),
    ])
    expect(queued[0]?.status).toBe('fulfilled')
    expect(queued[1]).toMatchObject({ status: 'rejected', reason: { message: 'Stop queued stage' } })
    expect(h.store.get(owner, run.id).attempts).toHaveLength(1)
    const attempt = h.store.get(owner, run.id).attempts[0]
    if (attempt === undefined) throw new Error('Prepared stage is missing')
    await h.store.associateChild(owner, run.id, attempt.id, childId)
    await expect(h.store.saveOutput({ ...owner, signal: controller.signal }, run.id, attempt.id, 'Late result')).rejects.toThrow('Stop queued stage')
    await h.store.finish(owner, run.id, 'stopped', 'Author cancellation')
    await expect(h.store.saveOutput(owner, run.id, attempt.id, 'Late result')).rejects.toMatchObject({ code: 'run-state' })
    await expect(h.store.prepareAttempt(owner, run.id, { ...stage, key: 'new-after-stop' })).rejects.toMatchObject({ code: 'run-state' })
    expect(h.store.get(owner, run.id)).toMatchObject({ status: 'stopped', attempts: [{ status: 'unknown', output: null }] })
  })

  it('keeps concurrent raw saves immutable and refuses another run borrowing a pending attempt', async () => {
    const h = await useRunStorage(backend, limits)
    const run = await h.store.begin(owner, input)
    const unrelated = await h.store.begin(owner, { ...input, novelId: parseNovelId('novel_00000000-0000-4000-8000-000000000099') })
    const attempt = await h.store.prepareAttempt(owner, run.id, stage)
    await h.store.associateChild(owner, run.id, attempt.id, childId)
    const saves = await Promise.allSettled([
      h.store.saveOutput(owner, run.id, attempt.id, 'abc'),
      h.store.saveOutput(owner, run.id, attempt.id, 'abc'),
      h.store.saveOutput(owner, run.id, attempt.id, 'changed'),
      h.store.saveOutput(owner, unrelated.id, attempt.id, 'abc'),
    ])
    expect(saves.map(result => result.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'rejected'])
    expect(saves[2]).toMatchObject({ reason: { code: 'output-conflict' } })
    expect(saves[3]).toMatchObject({ reason: { code: 'attempt-not-found' } })
    expect(h.store.readOutput(owner, run.id, attempt.id)).toMatchObject({ text: 'abc', bytes: 3, chars: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' })
    expect(() => h.store.readOutput(owner, unrelated.id, attempt.id)).toThrowError(expect.objectContaining({ code: 'attempt-not-found' }))
  })

  it('preserves the first terminal reason and requires resume before a different result can be recorded', async () => {
    const h = await useRunStorage(backend, limits)
    const run = await h.store.begin(owner, input)
    const stopped = await h.store.finish(owner, run.id, 'stopped', 'First stop reason')
    expect(await h.store.finish(owner, run.id, 'stopped', 'First stop reason')).toEqual(stopped)
    await expect(h.store.finish(owner, run.id, 'completed')).rejects.toMatchObject({ code: 'run-state' })
    await expect(h.store.finish(owner, run.id, 'stopped', 'Rewritten reason')).rejects.toMatchObject({ code: 'run-state' })
    const second = await h.store.begin(owner, { ...input, requestId: parseRequestId('new-write') })
    await expect(h.store.resume(owner, run.id, { retryUnknown: false })).rejects.toMatchObject({ code: 'active-run' })
    await h.store.finish(owner, second.id, 'failed', 'Failure')
    await h.store.resume(owner, run.id, { retryUnknown: false })
    expect(await h.store.finish(owner, run.id, 'completed')).toMatchObject({ status: 'completed' })
  })

  it('admits complete request ranges and native schemas before preparing durable work', async () => {
    const h = await useRunStorage(backend, limits)
    for (const invalid of [
      { ...input, fromChapter: 0 }, { ...input, throughChapter: 4 }, { ...input, fromChapter: 3, throughChapter: 2 },
      { ...input, settingsRoots: [] }, { ...input, settingsRoots: ['a1', 'a1'] },
      { ...input, executionLimits: { ...input.executionLimits, maxRepairAttempts: -1 } },
      { ...input, executionLimits: { ...input.executionLimits, maxParallelStages: 0 } },
      { ...input, executionLimits: { ...input.executionLimits, stageTimeoutMs: 2_147_483_648 } },
      { ...input, executionLimits: { ...input.executionLimits, stageProvider: ' ' } },
      { ...input, executionLimits: { ...input.executionLimits, minChapterWords: 6000 } },
    ]) await expect(h.store.begin(owner, invalid)).rejects.toMatchObject({ code: 'invalid-input' })
    expect(h.store.list(owner, input.novelId)).toEqual([])
    const run = await h.store.begin(owner, input)
    await expect(h.store.begin(owner, { ...input, executionLimits: { ...input.executionLimits, maxStageRequests: 5 } })).rejects.toMatchObject({ code: 'request-conflict' })
    await expect(h.store.prepareAttempt(owner, run.id, { ...stage, outputSchema: { type: 'array' } })).rejects.toThrow()
    await expect(h.store.prepareAttempt(owner, run.id, { ...stage, inputRefs: [...stage.inputRefs, ...stage.inputRefs] })).rejects.toThrow()
    expect(h.store.get(owner, run.id).attempts).toEqual([])
    const detached = h.store.get(owner, run.id)
    detached.settingsRoots.push('altered')
    detached.executionLimits.maxStageRequests = 200
    expect(h.store.get(owner, run.id)).toMatchObject({ settingsRoots: ['a1'], executionLimits: input.executionLimits })
  })

  it('does not associate one native child with two independent stage attempts', async () => {
    const h = await useRunStorage(backend, limits)
    const run = await h.store.begin(owner, input)
    const first = await h.store.prepareAttempt(owner, run.id, stage)
    const second = await h.store.prepareAttempt(owner, run.id, { ...stage, key: 'second-stage' })
    await h.store.associateChild(owner, run.id, first.id, childId)
    await expect(h.store.associateChild(owner, run.id, second.id, childId)).rejects.toMatchObject({ code: 'attempt-conflict' })
    expect(h.store.get(owner, run.id).attempts[1]).toMatchObject({ id: second.id, status: 'prepared', childSessionId: null })
  })

  it('refuses an empty failure reason without poisoning recoverable durable state', async () => {
    const h = await useRunStorage(backend, limits)
    const run = await h.store.begin(owner, input)
    const attempt = await h.store.prepareAttempt(owner, run.id, stage)
    await expect(h.store.failAttempt(owner, run.id, attempt.id, { outcome: 'failed', message: '' })).rejects.toMatchObject({ code: 'invalid-input' })
    expect(h.store.get(owner, run.id).attempts[0]?.status).toBe('prepared')
    await h.restart()
    expect(h.store.get(owner, run.id).attempts[0]?.status).toBe('unknown')
  })

  it('preserves the original parent Session and records the new parent only for an authorized replacement', async () => {
    const h = await useRunStorage(backend, limits)
    const run = await h.store.begin(owner, input)
    const first = await h.store.prepareAttempt(owner, run.id, stage)
    const nextActor: Actor = { ...owner, sessionId: brandString<SessionId>('resuming-session') }
    expect(first).toMatchObject({ parentSessionId: owner.sessionId })
    expect(await h.store.prepareAttempt(nextActor, run.id, stage)).toMatchObject({ id: first.id, parentSessionId: owner.sessionId })
    await h.restart()
    await h.store.resume(nextActor, run.id, { retryUnknown: true })
    const replacement = await h.store.prepareAttempt(nextActor, run.id, stage)
    expect(replacement).toMatchObject({ parentSessionId: nextActor.sessionId })
    expect(h.store.get(nextActor, run.id)).toMatchObject({ startedBy: owner.sessionId, lastResumedBy: nextActor.sessionId, attempts: [
      { id: first.id, parentSessionId: owner.sessionId, status: 'unknown' },
      { id: replacement.id, parentSessionId: nextActor.sessionId, status: 'prepared' },
    ] })
  })

  it('reopens stored prompt versions 3 and 4', async () => {
    const h = await useRunStorage(backend, limits)
    const third = await h.store.begin(owner, { ...input, requestId: parseRequestId('prompt-v3') }, 3)
    await h.store.finish(owner, third.id, 'stopped', 'Stored on prompt version 3.')
    const fourth = await h.store.begin(owner, { ...input, requestId: parseRequestId('prompt-v4') }, 4)
    await h.store.finish(owner, fourth.id, 'stopped', 'Stored on prompt version 4.')
    await h.restart()
    expect(h.store.get(owner, third.id).promptVersion).toBe(3)
    expect(h.store.get(owner, fourth.id).promptVersion).toBe(4)
  })

})

it.each(['json', 'sqlite'] as const)('%s retains exact upstream revision intent across reopen and rejects request drift', async backend => {
  const h = await useRunStorage(backend, limits)
  const revision = { baseArtifactId: input.briefArtifactId, instructions: 'Move the meeting to the harbor.' }
  const request = { ...input, mode: 'revise' as const, revision }
  const run = await h.store.begin(owner, request)
  expect(run).toMatchObject({ mode: 'revise', revision, fromChapter: 1, throughChapter: 3, attempts: [] })
  await h.restart()
  const resumed = await h.store.resume(owner, run.id, { retryUnknown: false })
  expect(await h.store.begin(owner, request)).toEqual(resumed)
  await expect(h.store.begin(owner, { ...request, revision: { ...revision, instructions: 'Move the meeting to the mountains.' } })).rejects.toMatchObject({ code: 'request-conflict' })
  await expect(h.store.begin(owner, { ...request, revision: { ...revision, baseArtifactId: parseArtifactId('artifact_00000000-0000-4000-8000-000000000009') } })).rejects.toMatchObject({ code: 'request-conflict' })
})

it.each([
  { mode: 'revise' as const, revision: null },
  { mode: 'write' as const, revision: { baseArtifactId: input.briefArtifactId, instructions: 'Change genre.' } },
  { mode: 'update' as const, revision: { baseArtifactId: input.briefArtifactId, instructions: 'Change genre.' } },
  { mode: 'revise' as const, revision: { baseArtifactId: input.briefArtifactId, instructions: '  \n' } },
  { mode: 'revise' as const, revision: { baseArtifactId: input.briefArtifactId, instructions: '\uD800' } },
])('rejects inconsistent or unusable revision intent: %j', async change => {
  const h = await useRunStorage('json', limits)
  await expect(h.store.begin(owner, { ...input, ...change })).rejects.toMatchObject({ code: 'invalid-input' })
  expect(h.store.list(owner, input.novelId)).toEqual([])
})

it('bounds revision instructions by UTF-8 bytes while retaining the original request on a lower-budget reopen', async () => {
  const h = await useRunStorage('json', { ...limits, maxOutputBytes: 6 })
  const request = { ...input, mode: 'revise' as const, revision: { baseArtifactId: input.briefArtifactId, instructions: '汉字' } }
  const run = await h.store.begin(owner, request)
  await h.store.finish(owner, run.id, 'stopped')
  await expect(h.store.begin(owner, { ...request, requestId: parseRequestId('too-large'), revision: { ...request.revision, instructions: '汉字a' } })).rejects.toMatchObject({ code: 'revision-budget' })
  await h.restart({ ...limits, maxOutputBytes: 1 })
  expect(await h.store.begin(owner, request)).toMatchObject({ id: run.id, revision: request.revision, limits: { maxOutputBytes: 6 } })
})

it.each(['json', 'sqlite'] as const)('%s reads an existing output under its captured limit after configuration decreases', async backend => {
  const h = await useRunStorage(backend, limits)
  const run = await h.store.begin(owner, input)
  const attempt = await h.store.prepareAttempt(owner, run.id, stage)
  await h.store.associateChild(owner, run.id, attempt.id, childId)
  await h.store.saveOutput(owner, run.id, attempt.id, 'Retained full output')
  await h.store.finish(owner, run.id, 'completed')
  const expected = h.store.readOutput(owner, run.id, attempt.id)
  await h.restart({ ...limits, maxOutputBytes: 1 })
  expect(h.store.readOutput(owner, run.id, attempt.id)).toEqual(expected)
  const next = await h.store.begin(owner, { ...input, requestId: parseRequestId('next') })
  const nextAttempt = await h.store.prepareAttempt(owner, next.id, stage)
  await h.store.associateChild(owner, next.id, nextAttempt.id, brandString<SessionId>('next-child'))
  await expect(h.store.saveOutput(owner, next.id, nextAttempt.id, 'ab')).rejects.toMatchObject({ code: 'output-budget' })
  await h.store.saveOutput(owner, next.id, nextAttempt.id, 'a')
  expect(h.store.readOutput(owner, next.id, nextAttempt.id).text).toBe('a')
})

it.each(['mode', 'bytes', 'missing'] as const)('rejects corrupt persisted revision intent before recovery writes: %s', async change => {
  const h = await useRunStorage('json', { ...limits, maxOutputBytes: 6 })
  await h.store.begin(owner, { ...input, mode: 'revise', revision: { baseArtifactId: input.briefArtifactId, instructions: '汉字' } })
  await h.store.close()
  const file = join(h.root, 'data', 'story_runs.json')
  const document: { tables: { novels: Record<string, { runs: WritingRun[] }> } } = JSON.parse(await readFile(file, 'utf8'))
  const run = document.tables.novels[input.novelId]?.runs[0]
  if (run?.revision === null || run?.revision === undefined) throw new Error('Missing persisted revision fixture')
  if (change === 'mode') run.mode = 'write'
  if (change === 'bytes') run.revision.instructions += 'a'
  if (change === 'missing') Object.assign(run, { revision: undefined })
  const damaged = JSON.stringify(document)
  await writeFile(file, damaged)
  await expect(h.restart()).rejects.toThrow()
  expect(await readFile(file, 'utf8')).toBe(damaged)
})


it.each(['json', 'sqlite'] as const)('%s captures exact service limits and refuses idempotency drift after reopen', async backend => {
  const h = await useRunStorage(backend, limits)
  const requested = { ...serviceLimits }
  const run = await h.store.begin(owner, { ...input, serviceLimits: requested })
  requested.maxResearchCalls = 12
  expect(run.serviceLimits).toEqual(serviceLimits)
  await h.store.finish(owner, run.id, 'stopped', 'Author pause')
  await h.restart()
  expect(h.store.get(owner, run.id).serviceLimits).toEqual(serviceLimits)
  expect(await h.store.begin(owner, { ...input, serviceLimits })).toMatchObject({ id: run.id, serviceLimits })
  await expect(h.store.begin(owner, { ...input, serviceLimits: requested })).rejects.toMatchObject({ code: 'request-conflict' })
})


it('migrates version-one histories without inventing service limits and keeps legacy outputs readable', async () => {
  const h = await useRunStorage('json', limits)
  const run = await h.store.begin(owner, input)
  const first = await h.store.prepareAttempt(owner, run.id, stage)
  await h.store.associateChild(owner, run.id, first.id, childId)
  await h.store.saveOutput(owner, run.id, first.id, 'Retained legacy stage output')
  await h.store.prepareAttempt(owner, run.id, { ...stage, key: 'unfinished-stage' })
  await h.store.finish(owner, run.id, 'stopped', 'Author paused.')
  const output = h.store.readOutput(owner, run.id, first.id)
  await h.store.close()
  const file = join(h.root, 'data', 'story_runs.json')
  const document: { tables: { novels: Record<string, { version: number; runs: (Omit<WritingRun, 'serviceLimits'> & { serviceLimits?: RunServiceLimits | null })[] }> } } = JSON.parse(await readFile(file, 'utf8'))
  const history = document.tables.novels[input.novelId]
  if (history === undefined) throw new Error('Saved run history is missing')
  history.version = 1
  for (const old of history.runs) delete old.serviceLimits
  await writeFile(file, JSON.stringify(document))
  await h.restart()
  const legacy = h.store.get(owner, run.id)
  expect(legacy).toMatchObject({ serviceLimits: null, status: 'stopped', error: 'Author paused.' })
  expect(h.store.readOutput(owner, run.id, first.id)).toEqual(output)
  const migrated: typeof document = JSON.parse(await readFile(file, 'utf8'))
  expect(migrated.tables.novels[input.novelId]).toMatchObject({ version: 2, runs: [{ serviceLimits: null }] })
  await expect(h.store.resume(owner, run.id, { retryUnknown: true })).rejects.toMatchObject({ code: 'run-limits' })
  await expect(h.store.prepareAttempt(owner, run.id, stage)).rejects.toMatchObject({ code: 'run-limits' })
  await expect(h.store.begin(owner, input)).rejects.toMatchObject({ code: 'run-limits' })
  expect(h.store.get(owner, run.id)).toEqual(legacy)
  const next = await h.store.begin(owner, { ...input, requestId: parseRequestId('new-explicit-request') })
  expect(next.serviceLimits).toEqual(serviceLimits)
  await h.restart()
  expect(h.store.get(owner, run.id)).toEqual(legacy)
  expect(h.store.readOutput(owner, run.id, first.id)).toEqual(output)
})


it.each([
  { ...serviceLimits, maxResearchCalls: 0 },
  { ...serviceLimits, maxReadChars: 0.5 },
  { ...serviceLimits, maxResearchLogEvents: Infinity },
  { ...serviceLimits, unrelatedSetting: true },
])('rejects invalid service-limit input before creating history: %j', async invalid => {
  const h = await useRunStorage('json', limits)
  await expect(h.store.begin(owner, { ...input, serviceLimits: invalid })).rejects.toMatchObject({ code: 'invalid-input' })
  expect(h.store.list(owner, input.novelId)).toEqual([])
})

it.each(['legacy-digest', 'current-missing', 'current-extra'] as const)('rejects damaged service-limit history before migration or recovery writes: %s', async corruption => {
  const h = await useRunStorage('json', limits)
  const run = await h.store.begin(owner, input)
  const attempt = await h.store.prepareAttempt(owner, run.id, stage)
  await h.store.associateChild(owner, run.id, attempt.id, childId)
  await h.store.saveOutput(owner, run.id, attempt.id, 'Original recorded output')
  await h.store.close()
  const file = join(h.root, 'data', 'story_runs.json')
  const document: { tables: { novels: Record<string, { version: number; runs: (Omit<WritingRun, 'serviceLimits'> & { serviceLimits?: RunServiceLimits | null })[] }>; outputs: Record<string, RunOutput> } } = JSON.parse(await readFile(file, 'utf8'))
  const history = document.tables.novels[input.novelId]
  const saved = history?.runs[0]
  if (history === undefined || saved === undefined) throw new Error('Saved fixture is missing')
  if (corruption === 'legacy-digest') {
    history.version = 1
    delete saved.serviceLimits
    const output = document.tables.outputs[attempt.id]
    if (output === undefined) throw new Error('Saved fixture output is missing')
    output.text = 'Changed without updating its digest'
  }
  if (corruption === 'current-missing') delete saved.serviceLimits
  if (corruption === 'current-extra') Object.assign(saved.serviceLimits!, { unrecordedDefault: true })
  const corrupted = JSON.stringify(document)
  await writeFile(file, corrupted)
  await expect(h.restart()).rejects.toThrow()
  expect(await readFile(file, 'utf8')).toBe(corrupted)
})

it('keeps an unfinished legacy run occupying its slot until the author explicitly stops it', async () => {
  const h = await useRunStorage('json', limits)
  const run = await h.store.begin(owner, input)
  await h.store.prepareAttempt(owner, run.id, stage)
  await h.store.close()
  const file = join(h.root, 'data', 'story_runs.json')
  const document: { tables: { novels: Record<string, { version: number; runs: (Omit<WritingRun, 'serviceLimits'> & { serviceLimits?: RunServiceLimits | null })[] }> } } = JSON.parse(await readFile(file, 'utf8'))
  const history = document.tables.novels[input.novelId]
  if (history === undefined) throw new Error('Saved fixture is missing')
  history.version = 1
  for (const old of history.runs) delete old.serviceLimits
  await writeFile(file, JSON.stringify(document))
  await h.restart()
  const legacy = h.store.get(owner, run.id)
  expect(legacy).toMatchObject({ status: 'interrupted', serviceLimits: null, attempts: [{ status: 'unknown', retryAuthorized: false }] })
  await expect(h.store.resume(owner, run.id, { retryUnknown: true })).rejects.toMatchObject({ code: 'run-limits' })
  expect(h.store.get(owner, run.id)).toEqual(legacy)
  const next = { ...input, requestId: parseRequestId('explicit-replacement') }
  await expect(h.store.begin(owner, next)).rejects.toMatchObject({ code: 'active-run' })
  await h.store.finish(owner, run.id, 'stopped', 'Retire the run with unavailable original limits.')
  expect(await h.store.begin(owner, next)).toMatchObject({ serviceLimits, status: 'running' })
})


it('migrates a retained SQLite version-one record without changing the host storage generation', async () => {
  const h = await useRunStorage('sqlite', limits)
  const run = await h.store.begin(owner, input)
  const attempt = await h.store.prepareAttempt(owner, run.id, stage)
  await h.store.associateChild(owner, run.id, attempt.id, childId)
  await h.store.saveOutput(owner, run.id, attempt.id, 'SQLite legacy output')
  await h.store.finish(owner, run.id, 'completed')
  const output = h.store.readOutput(owner, run.id, attempt.id)
  await h.store.close()
  const db = new DatabaseSync(join(h.root, 'data.sqlite'))
  try {
    const row = db.prepare('SELECT value FROM u_story_runs_novels WHERE key = ?').get(input.novelId)
    if (typeof row?.value !== 'string') throw new Error('SQLite run fixture is missing')
    const record: { version: number; runs: { serviceLimits?: RunServiceLimits | null }[] } = JSON.parse(row.value)
    record.version = 1
    for (const old of record.runs) delete old.serviceLimits
    db.prepare('UPDATE u_story_runs_novels SET value = ? WHERE key = ?').run(JSON.stringify(record), input.novelId)
  } finally { db.close() }
  await h.restart()
  expect(h.store.get(owner, run.id)).toMatchObject({ status: 'completed', serviceLimits: null })
  expect(h.store.readOutput(owner, run.id, attempt.id)).toEqual(output)
  const readback = new DatabaseSync(join(h.root, 'data.sqlite'), { readOnly: true })
  try {
    const row = readback.prepare('SELECT value FROM u_story_runs_novels WHERE key = ?').get(input.novelId)
    if (typeof row?.value !== 'string') throw new Error('Migrated SQLite record is missing')
    expect(JSON.parse(row.value)).toMatchObject({ version: 2, runs: [{ serviceLimits: null }] })
    expect(readback.prepare('SELECT version FROM units WHERE name = ?').get('story_runs')).toMatchObject({ version: 1 })
    expect(readback.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 })
  } finally { readback.close() }
})
