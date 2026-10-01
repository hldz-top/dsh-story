import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { artifactIdSchema, novelIdSchema, requestIdSchema, parseArtifactId, parseNovelId, parseRequestId } from '../src/contracts.ts'
import type { SelectedResearchObservation } from '../src/research-selection.ts'
import type { NovelRecord } from '../src/records.ts'
import { testResearchLimits, useStorage } from './support/storage.ts'

const legacyReference = z.strictObject({ id: artifactIdSchema, kind: z.literal('creative-brief'), revision: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/), chars: z.number().int().nonnegative(), bytes: z.number().int().nonnegative() })
const legacyReceipt = z.strictObject({ requestId: requestIdSchema, hash: z.string().regex(/^[a-f0-9]{64}$/) })
const legacyDomain = defineDomain({ name: 'story_writing', version: 1, layout: 'single', tables: {
  novels: domainTable(z.strictObject({ id: novelIdSchema, workspace: z.string().min(1), title: z.string().min(1), briefHistory: z.array(legacyReference).nonempty(), createRequest: legacyReceipt,
    briefRequests: z.array(legacyReceipt.extend({ revision: z.number().int().positive() })) })),
  artifacts: domainTable(legacyReference.extend({ novelId: novelIdSchema, text: z.string() })),
  selections: domainTable(z.strictObject({ workspace: z.string(), sessionId: z.string(), novelId: novelIdSchema })),
} })

it('rejects every nonfinite or nonpositive research limit before opening a domain', async () => {
  for (const field of ['maxResearchQuestions', 'maxResearchCalls', 'maxResearchSources', 'maxEvidenceChars', 'maxResearchLogEvents'] as const) {
    for (const invalid of [0, 1.5, Number.POSITIVE_INFINITY]) {
      await expect(useStorage('json', { maxArtifactBytes: 100_000, maxReadChars: 64 }, { ...testResearchLimits, [field]: invalid })).rejects.toMatchObject({ code: 'invalid-input' })
    }
  }
})

it('rejects a research index whose questions differ from the immutable plan content', async () => {
  const h = await useStorage('json', { maxArtifactBytes: 100_000, maxReadChars: 64 })
  const actor = { workspace: h.root, sessionId: SessionId('research-author') }
  const novel = await h.service.createNovel(actor, { requestId: parseRequestId('novel'), title: '潮汐城', brief: '守塔人寻找失踪日志。' })
  const plan = await h.service.startResearch(actor, { novelId: novel.id, requestId: parseRequestId('plan'), briefArtifactId: novel.brief.id,
    questions: [{ id: 'motive', kind: 'creative', question: '为何留下？', reason: '由作者决定。' }] }, 10)
  await h.service.close()
  const file = join(h.root, 'data', 'story_writing.json')
  const document: { tables: { novels: Record<string, NovelRecord> } } = JSON.parse(await readFile(file, 'utf8'))
  document.tables.novels[novel.id]!.researchHistory[0]!.questions[0]!.question = '替换的问题。'
  await writeFile(file, JSON.stringify(document))
  await h.restart()
  expect(() => h.service.getResearch(actor, { novelId: novel.id, planId: plan.planId })).toThrowError(expect.objectContaining({ code: 'corrupt-artifact' }))
})

describe.each(['json', 'sqlite'] as const)('%s research evidence', backend => {
  it.each(['sources', 'characters'] as const)('counts rejected references against the %s limit before publishing evidence', async bound => {
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 64 }, {
      ...testResearchLimits, ...(bound === 'sources' ? { maxResearchSources: 1 } : { maxEvidenceChars: 16 }),
    })
    const actor = { workspace: h.root, sessionId: SessionId('research-author') }
    const novel = await h.service.createNovel(actor, { requestId: parseRequestId('novel'), title: 'Lighthouse', brief: 'Investigate the harbor.' })
    const plan = await h.service.startResearch(actor, { novelId: novel.id, requestId: parseRequestId('plan'), briefArtifactId: novel.brief.id,
      questions: [{ id: 'signal', kind: 'external', question: 'Signal?', reason: 'Evidence.' }] }, 10)
    const callId = ToolCallId('native-search')
    const reserved = await h.service.reserveResearchCall(actor, { callId, name: 'web_search' })
    const observations: SelectedResearchObservation[] = [{ callId, name: 'web_search', input: { queries: ['navigation signal'] },
      callSeq: 11, resultSeq: 12, status: 'succeeded', error: null, sources: [], rejectedSources: [
        { sourceIndex: 0, reference: '/first', title: null, reason: 'unsupported-reference' },
        { sourceIndex: 1, reference: '/second-longer', title: null, reason: 'unsupported-reference' },
      ] }]
    await expect(h.service.completeSelectedResearch(actor, { novelId: novel.id, planId: plan.planId, requestId: parseRequestId('complete'),
      findings: [{ questionId: 'signal', callIds: [callId], selections: [], adequate: false, conclusion: 'Unverified.' }] }, observations)).rejects.toMatchObject({ code: 'research-budget' })
    await h.restart()
    expect(h.service.getResearch(actor, { novelId: novel.id, planId: plan.planId })).toEqual(reserved)
  })

  it('archives unresolved native references in version-3 evidence and still blocks settings after reopening', async () => {
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 64 })
    const actor = { workspace: h.root, sessionId: SessionId('research-author') }
    const novel = await h.service.createNovel(actor, { requestId: parseRequestId('novel'), title: 'Lighthouse', brief: 'Investigate the harbor.' })
    const plan = await h.service.startResearch(actor, { novelId: novel.id, requestId: parseRequestId('plan'), briefArtifactId: novel.brief.id,
      questions: [{ id: 'signal', kind: 'external', question: 'What does the signal mean?', reason: 'Navigation needs evidence.' }] }, 10)
    const callId = ToolCallId('native-search')
    await h.service.reserveResearchCall(actor, { callId, name: 'web_search' })
    const observations: SelectedResearchObservation[] = [{ callId, name: 'web_search', input: { queries: ['navigation signal'] },
      callSeq: 11, resultSeq: 12, status: 'succeeded', error: null, sources: [],
      rejectedSources: [{ sourceIndex: 0, reference: '/hdd/signal.pdf#page=2', title: 'Signal', reason: 'unsupported-reference' }] }]
    const complete = { novelId: novel.id, planId: plan.planId, requestId: parseRequestId('complete'),
      findings: [{ questionId: 'signal', callIds: [callId], selections: [], adequate: true, conclusion: 'A title alone cannot establish the signal.' }] }
    const completed = await h.service.completeSelectedResearch(actor, complete, observations)
    expect(completed.outcome).toBe('insufficient')
    const saved = h.service.getArtifact(actor, { novelId: novel.id, artifactId: completed.result!.id })
    expect(JSON.parse(saved.text)).toMatchObject({ version: 3, observations, outcome: 'insufficient' })
    await h.restart()
    expect(h.service.getResearch(actor, { novelId: novel.id, planId: plan.planId })).toEqual(completed)
    expect(h.service.getArtifact(actor, { novelId: novel.id, artifactId: saved.id })).toEqual(saved)
    expect(await h.service.completeSelectedResearch(actor, complete, [])).toEqual(completed)
    expect(() => h.service.settingsInputs(actor, novel.id, 'a1', plan.planId)).toThrowError(expect.objectContaining({ code: 'research-incomplete' }))
  })

  it('replays completion when only finding object key order changes and preserves array order semantics', async () => {
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 64 })
    const actor = { workspace: h.root, sessionId: SessionId('research-author') }
    const novel = await h.service.createNovel(actor, { requestId: parseRequestId('novel'), title: '潮汐城', brief: '守塔人寻找失踪日志。' })
    const plan = await h.service.startResearch(actor, { novelId: novel.id, requestId: parseRequestId('plan'), briefArtifactId: novel.brief.id,
      questions: [{ id: 'motive', kind: 'creative', question: '为何留下？', reason: '由作者决定。' },
        { id: 'place', kind: 'internal', question: '守在哪里？', reason: '创作简报已有地点。' }] }, 10)
    const request = { novelId: novel.id, planId: plan.planId, requestId: parseRequestId('complete'), findings: [
      { questionId: 'motive', callIds: [], selections: [], conclusion: '等待归人。', adequate: true },
      { questionId: 'place', callIds: [], selections: [], conclusion: '潮汐城灯塔。', adequate: true },
    ] }
    const completed = await h.service.completeSelectedResearch(actor, request, [])
    await h.restart()
    const reorderedKeys = [
      { adequate: true, conclusion: '等待归人。', callIds: [], selections: [], questionId: 'motive' },
      { conclusion: '潮汐城灯塔。', questionId: 'place', adequate: true, callIds: [], selections: [] },
    ]
    expect(await h.service.completeSelectedResearch(actor, { ...request, findings: reorderedKeys }, [])).toEqual(completed)
    expect(h.service.listResearch(actor, novel.id)).toEqual([completed])
    await expect(h.service.completeSelectedResearch(actor, { ...request, findings: [...reorderedKeys].reverse() }, [])).rejects.toMatchObject({ code: 'request-conflict' })
  })

  it('drains closing research writes and reopens without publishing late evidence', async () => {
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 64 })
    const actor = { workspace: h.root, sessionId: SessionId('research-author') }
    const novel = await h.service.createNovel(actor, { requestId: parseRequestId('novel'), title: '潮汐城', brief: '守塔人寻找失踪日志。' })
    const plan = await h.service.startResearch(actor, { novelId: novel.id, requestId: parseRequestId('plan'), briefArtifactId: novel.brief.id,
      questions: [{ id: 'motive', kind: 'creative', question: '为何留下？', reason: '由作者决定。' }] }, 10)
    let closing: Promise<void> | undefined
    let settled = false
    let settledAtClose = false
    h.onArtifactStored(() => { closing = h.service.close().then(() => { settledAtClose = settled }) })
    const pending = h.service.completeSelectedResearch(actor, { novelId: novel.id, planId: plan.planId, requestId: parseRequestId('complete'), findings: [{ questionId: 'motive', callIds: [], selections: [], conclusion: '等待归人。', adequate: true }] }, [])
    void pending.then(() => { settled = true }, () => { settled = true })
    await expect(pending).rejects.toMatchObject({ code: 'closed' })
    expect(closing).toBeDefined()
    await closing
    expect(settledAtClose).toBe(true)
    await expect(h.service.reserveResearchCall(actor, { callId: ToolCallId('late-web'), name: 'web_search' })).rejects.toMatchObject({ code: 'closed' })
    await h.restart()
    expect(h.service.getResearch(actor, { novelId: novel.id, planId: plan.planId })).toEqual(plan)
  })

  it('rejects completion from another Session and releases the active slot when its brief changes', async () => {
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 64 })
    const actor = { workspace: h.root, sessionId: SessionId('research-author') }
    const novel = await h.service.createNovel(actor, { requestId: parseRequestId('novel'), title: '潮汐城', brief: '守塔人寻找失踪日志。' })
    const request = { novelId: novel.id, requestId: parseRequestId('plan'), briefArtifactId: novel.brief.id,
      questions: [{ id: 'motive', kind: 'creative' as const, question: '为何留下？', reason: '由作者决定。' }] }
    const plan = await h.service.startResearch(actor, request, 10)
    const complete = { novelId: novel.id, planId: plan.planId, requestId: parseRequestId('complete'), findings: [{ questionId: 'motive', callIds: [], selections: [], conclusion: '等待归人。', adequate: true }] }
    await expect(h.service.completeSelectedResearch({ ...actor, sessionId: SessionId('outsider') }, complete, [])).rejects.toMatchObject({ code: 'session-mismatch' })
    const changed = h.service.saveBrief(actor, { novelId: novel.id, requestId: parseRequestId('edit'), expectedRevision: 1, text: '守塔人离开灯塔。' })
    const completing = h.service.completeSelectedResearch(actor, complete, [])
    const settled = await Promise.allSettled([changed, completing])
    expect(settled[0]?.status).toBe('fulfilled')
    expect(settled[1]).toMatchObject({ status: 'rejected', reason: { code: 'revision-conflict' } })
    expect(h.service.getResearch(actor, { novelId: novel.id, planId: plan.planId })).toMatchObject({ stale: true, result: null, outcome: null })
    expect(await h.service.reserveResearchCall(actor, { callId: ToolCallId('ordinary-web'), name: 'web_search' })).toBeNull()
    const latest = h.service.getNovel(actor, novel.id)
    const replacement = await h.service.startResearch(actor, { ...request, briefArtifactId: latest.brief.id, requestId: parseRequestId('replacement') }, 20)
    expect(replacement.stale).toBe(false)
    expect(h.service.listResearch(actor, novel.id).map(item => item.stale)).toEqual([true, false])
  })

  it.each(['plan', 'evidence'] as const)('does not publish cancelled %s content after it is durable', async phase => {
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 64 })
    const actor = { workspace: h.root, sessionId: SessionId('research-author') }
    const novel = await h.service.createNovel(actor, { requestId: parseRequestId('novel'), title: '潮汐城', brief: '守塔人寻找失踪日志。' })
    const request = { novelId: novel.id, requestId: parseRequestId('plan'), briefArtifactId: novel.brief.id,
      questions: [{ id: 'motive', kind: 'creative' as const, question: '为何留下？', reason: '由作者决定。' }] }
    const plan = phase === 'evidence' ? await h.service.startResearch(actor, request, 10) : null
    const abort = new AbortController()
    h.onArtifactStored(() => abort.abort())
    const caller = { ...actor, signal: abort.signal }
    const pending = plan === null ? h.service.startResearch(caller, request, 10)
      : h.service.completeSelectedResearch(caller, { novelId: novel.id, planId: plan.planId, requestId: parseRequestId('complete'), findings: [{ questionId: 'motive', callIds: [], selections: [], conclusion: '等待归人。', adequate: true }] }, [])
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await h.restart()
    expect(h.service.listResearch(actor, novel.id)).toEqual(plan === null ? [] : [plan])
  })

  it('opens exact T01 records and adds research while retaining their brief and selection', async () => {
    const novelId = parseNovelId('novel_00c38d7c-50d8-4a1b-93f0-188daf5a9859')
    const artifactId = parseArtifactId('artifact_00c38d7c-50d8-4a1b-93f0-188daf5a9859')
    const sessionId = SessionId('legacy-author')
    const text = '原版创作简报。'
    const ref = { id: artifactId, kind: 'creative-brief' as const, revision: 1, sha256: createHash('sha256').update(text).digest('hex'), chars: [...text].length, bytes: Buffer.byteLength(text) }
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 64 }, testResearchLimits, async (facility, root) => {
      const legacy = await facility.open(legacyDomain)
      try {
        await legacy.table('artifacts').put(artifactId, { ...ref, novelId, text })
        await legacy.table('novels').put(novelId, { id: novelId, workspace: root, title: '旧版小说', briefHistory: [ref], createRequest: { requestId: parseRequestId('legacy-create'), hash: createHash('sha256').update(JSON.stringify(['旧版小说', text])).digest('hex') }, briefRequests: [] })
        await legacy.table('selections').put(createHash('sha256').update(JSON.stringify([root, sessionId])).digest('hex'), { workspace: root, sessionId, novelId })
      } finally { await legacy.close() }
    })
    const actor = { workspace: h.root, sessionId }
    expect(h.service.getSelection(actor)).toEqual(h.service.getNovel(actor, novelId))
    expect(h.service.listResearch(actor, novelId)).toEqual([])
    expect(h.service.getArtifact(actor, { novelId, artifactId }).text).toBe(text)
    const plan = await h.service.startResearch(actor, { novelId, briefArtifactId: artifactId, requestId: parseRequestId('new-plan'), questions: [{ id: 'motive', kind: 'creative', question: '为何留下？', reason: '由作者决定。' }] }, 10)
    await h.restart()
    expect(h.service.getResearch(actor, { novelId, planId: plan.planId })).toEqual(plan)
    expect(h.service.getArtifact(actor, { novelId, artifactId }).text).toBe(text)
    expect(h.service.getSelection(actor)?.brief).toEqual(ref)
  })

  it('keeps successful, insufficient and failed native evidence as separate historical results', async () => {
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 64 })
    const actor = { workspace: h.root, sessionId: SessionId('research-author') }
    const novel = await h.service.createNovel(actor, { requestId: parseRequestId('novel'), title: '潮汐城', brief: '守塔人寻找失踪日志。' })
    const outcomes = ['succeeded', 'insufficient', 'failed', 'failed', 'insufficient'] as const
    for (const [index, outcome] of outcomes.entries()) {
      const plan = await h.service.startResearch(actor, { novelId: novel.id, requestId: parseRequestId(`plan-${index}`), briefArtifactId: novel.brief.id,
        questions: [{ id: 'tides', kind: 'external', question: '潮汐周期？', reason: '决定行动时间。' },
          { id: 'motive', kind: 'creative', question: '为何留下？', reason: '由作者决定。' }] }, 10)
      const callId = ToolCallId(`native-${index}`)
      const failed = index === 2
      const excerpt = index === 1 ? '' : 'Tides follow a recurring cycle.'
      const observed: SelectedResearchObservation[] = index === 3 ? [] : [{
        callId, name: 'web_search', input: { queries: ['tide cycle'] }, callSeq: 11, resultSeq: 12,
        status: failed ? 'failed' : 'succeeded', error: failed ? 'Source unavailable' : null, rejectedSources: [],
        sources: failed ? [] : [{ sourceIndex: 0, url: 'https://example.test/tides', title: null,
          bodyStart: 0, bodyEnd: [...excerpt].length, totalChars: [...excerpt].length, sha256: createHash('sha256').update(excerpt).digest('hex'), nativeTruncated: false,
          httpStatus: null, eligibility: excerpt === '' ? 'empty' : 'usable', retention: excerpt === '' ? 'unselected' : 'selected', excerpts: excerpt === '' ? [] : [{ offset: 0, limit: [...excerpt].length, text: excerpt }] }],
      }]
      if (observed.length > 0) {
        await h.service.reserveResearchCall(actor, { callId, name: 'web_search' })
        await expect(h.service.completeSelectedResearch(actor, { novelId: novel.id, planId: plan.planId, requestId: parseRequestId(`pending-${index}`), findings: [] }, [])).rejects.toMatchObject({ code: 'research-incomplete' })
      }
      const request = { novelId: novel.id, planId: plan.planId, requestId: parseRequestId(`complete-${index}`),
        findings: [{ questionId: 'tides', callIds: observed.map(call => call.callId), selections: !failed && index !== 1 && index !== 3 ? [{ callId, sourceIndex: 0, offset: 0, limit: [...excerpt].length }] : [], conclusion: '按已记录证据保留结论。', adequate: index !== 4 },
          { questionId: 'motive', callIds: [], selections: [], conclusion: '等待兄长归来。', adequate: true }] }
      const completed = await h.service.completeSelectedResearch(actor, request, observed)
      expect(completed.outcome).toBe(outcome)
      expect(completed.plan.revision).toBe(1)
      expect(completed.result?.revision).toBe(1)
      const content = JSON.parse(h.service.getArtifact(actor, { novelId: novel.id, artifactId: completed.result!.id }).text)
      expect(content).toMatchObject({ observations: observed, outcome, findings: [{ outcome }, { outcome: 'not-needed' }] })
      expect(await h.service.completeSelectedResearch(actor, request, observed)).toEqual(completed)
      await expect(h.service.completeSelectedResearch(actor, { ...request, findings: [] }, observed)).rejects.toMatchObject({ code: 'request-conflict' })
    }
    await h.restart()
    expect(h.service.listResearch(actor, novel.id).map(plan => plan.outcome)).toEqual(outcomes)
    expect(h.service.getNovel(actor, novel.id)).toEqual(novel)
  })

  it('requires an explicit question and gives conclusions their own finite character allowance', async () => {
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 64 }, { ...testResearchLimits, maxEvidenceChars: 256 })
    const actor = { workspace: h.root, sessionId: SessionId('research-author') }
    const novel = await h.service.createNovel(actor, { requestId: parseRequestId('novel'), title: '潮汐城', brief: '守塔人寻找失踪日志。' })
    const request = { novelId: novel.id, requestId: parseRequestId('plan'), briefArtifactId: novel.brief.id }
    await expect(h.service.startResearch(actor, { ...request, questions: [] }, 10)).rejects.toThrow()
    const plan = await h.service.startResearch(actor, { ...request, questions: [{ id: 'fact', kind: 'external', question: '潮汐？', reason: '行动时间。' }] }, 10)
    const callId = ToolCallId('native')
    await h.service.reserveResearchCall(actor, { callId, name: 'web_fetch' })
    const observed: SelectedResearchObservation = {
      callId, name: 'web_fetch', input: { url: 'https://example.test/' }, callSeq: 11, resultSeq: 12, status: 'succeeded', error: null, rejectedSources: [],
      sources: [{ sourceIndex: 0, url: 'https://example.test/', title: null, bodyStart: 0, bodyEnd: 256,
        totalChars: 256, sha256: createHash('sha256').update('a'.repeat(256)).digest('hex'), nativeTruncated: false, httpStatus: 200, eligibility: 'usable', retention: 'selected', excerpts: [{ offset: 0, limit: 256, text: 'a'.repeat(256) }] }],
    }
    const complete = { novelId: novel.id, planId: plan.planId, requestId: parseRequestId('complete'), findings: [{ questionId: 'fact', callIds: [callId], selections: [{ callId, sourceIndex: 0, offset: 0, limit: 256 }], conclusion: '结'.repeat(256), adequate: true }] }
    expect((await h.service.completeSelectedResearch(actor, complete, [observed])).outcome).toBe('succeeded')
  })

  it('reserves concurrent native calls without exceeding the budget and isolates Session plans', async () => {
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 64 }, { ...testResearchLimits, maxResearchCalls: 1 })
    const actor = { workspace: h.root, sessionId: SessionId('research-author') }
    const other = { ...actor, sessionId: SessionId('other-author') }
    const novel = await h.service.createNovel(actor, { requestId: parseRequestId('novel'), title: '潮汐城', brief: '守塔人寻找失踪日志。' })
    const request = { novelId: novel.id, requestId: parseRequestId('plan'), briefArtifactId: novel.brief.id,
      questions: [{ id: 'tides', kind: 'external' as const, question: '潮汐周期？', reason: '潮汐影响行动时间。' }] }
    const [plan, otherPlan] = await Promise.all([h.service.startResearch(actor, request, 10), h.service.startResearch(other, request, 20)])
    await expect(h.service.startResearch(actor, { ...request, requestId: parseRequestId('duplicate-plan') }, 30)).rejects.toMatchObject({ code: 'research-active' })
    const calls = [{ callId: ToolCallId('native-a'), name: 'web_search' as const }, { callId: ToolCallId('native-b'), name: 'web_fetch' as const }]
    const settled = await Promise.allSettled(calls.map(call => h.service.reserveResearchCall(actor, call)))
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter(result => result.status === 'rejected')).toEqual([expect.objectContaining({ reason: expect.objectContaining({ code: 'research-budget' }) })])
    const saved = h.service.getResearch(actor, { novelId: novel.id, planId: plan.planId })
    expect(saved.reservedCalls).toHaveLength(1)
    expect(await h.service.reserveResearchCall(actor, saved.reservedCalls[0]!)).toEqual(saved)
    expect(await h.service.reserveResearchCall(other, { callId: ToolCallId('other-call'), name: 'web_search' })).toMatchObject({ planId: otherPlan.planId, reservedCalls: [{ callId: 'other-call' }] })
    await h.restart()
    expect(h.service.getResearch(actor, { novelId: novel.id, planId: plan.planId })).toEqual(saved)
  })

  it('records why external research is unnecessary and keeps the plan and result across restart', async () => {
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 64 })
    const actor = { workspace: h.root, sessionId: SessionId('research-author') }
    const novel = await h.service.createNovel(actor, { requestId: parseRequestId('novel'), title: '潮汐城', brief: '守塔人寻找失踪日志。' })
    const plan = await h.service.startResearch(actor, {
      novelId: novel.id, requestId: parseRequestId('plan'), briefArtifactId: novel.brief.id,
      questions: [{ id: 'motivation', kind: 'creative', question: '守塔人为什么留下？', reason: '由作者创作动机，不需要外部事实。' }],
    }, 10)
    expect(plan).toMatchObject({ novelId: novel.id, briefArtifactId: novel.brief.id, sessionId: actor.sessionId, startSeq: 10, reservedCalls: [], outcome: null })
    const completed = await h.service.completeSelectedResearch(actor, {
      novelId: novel.id, planId: plan.planId, requestId: parseRequestId('complete'),
      findings: [{ questionId: 'motivation', callIds: [], selections: [], conclusion: '守塔人守候兄长归来。', adequate: true }],
    }, [])
    expect(completed.outcome).toBe('not-needed')
    expect(completed.result?.kind).toBe('research-evidence')
    expect(JSON.parse(h.service.getArtifact(actor, { novelId: novel.id, artifactId: completed.result!.id }).text)).toMatchObject({
      outcome: 'not-needed', findings: [{ questionId: 'motivation', outcome: 'not-needed' }], observations: [],
    })
    await h.restart()
    expect(h.service.getResearch(actor, { novelId: novel.id, planId: plan.planId })).toEqual(completed)
    expect(h.service.listResearch(actor, novel.id)).toEqual([completed])
    expect(h.service.getNovel(actor, novel.id)).toEqual(novel)
  })
})
