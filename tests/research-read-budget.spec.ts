import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { parseRequestId } from '../src/contracts.ts'
import { testResearchLimits, useStorage } from './support/storage.ts'

describe.each(['json', 'sqlite'] as const)('%s research read admission', backend => {
  it('refuses web reservation for a plan resolved entirely from author choices', async () => {
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 64 })
    const actor = { workspace: h.root, sessionId: SessionId('author-input-only') }
    const novel = await h.service.createNovel(actor, { requestId: parseRequestId('novel'), title: 'The Last Light', brief: 'A near-future closed-island mystery.' })
    const plan = await h.service.startResearch(actor, { novelId: novel.id, briefArtifactId: novel.brief.id, requestId: parseRequestId('plan'),
      questions: [{ id: 'genre', kind: 'creative', question: 'Which genre?', reason: 'The author explicitly selected a near-future mystery.' }] }, 10)
    await expect(h.service.reserveResearchCall(actor, { callId: ToolCallId('unnecessary-taxonomy-search'), name: 'web_search' }))
      .rejects.toMatchObject({ code: 'research-incomplete' })
    expect(h.service.getResearch(actor, { novelId: novel.id, planId: plan.planId }).reservedCalls).toEqual([])
    await h.restart()
    expect(h.service.getResearch(actor, { novelId: novel.id, planId: plan.planId }).reservedCalls).toEqual([])
  })
})

for (const backend of ['json', 'sqlite'] as const) {
  it(`${backend} preserves source-read reservations across restart and serializes competing reads`, async () => {
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 4 }, { ...testResearchLimits, maxEvidenceChars: 64 })
    const actor = { workspace: h.root, sessionId: SessionId('bounded-reader') }
    const novel = await h.service.createNovel(actor, { requestId: parseRequestId('novel'), title: 'Signal', brief: 'A signal needs verification.' })
    const plan = await h.service.startResearch(actor, { novelId: novel.id, briefArtifactId: novel.brief.id, requestId: parseRequestId('plan'),
      questions: [{ id: 'signal', kind: 'external', question: 'Meaning?', reason: 'Real navigation fact.' }] }, 10)
    await h.service.reserveResearchCall(actor, { callId: ToolCallId('fetch-signal'), name: 'web_fetch' })
    const request = { novelId: novel.id, planId: plan.planId, callId: ToolCallId('fetch-signal'), sourceIndex: 0, offset: 0, limit: 4 }
    await expect(h.service.reserveResearchRead({ ...actor, sessionId: SessionId('another-reader') }, request, ToolCallId('wrong-owner'))).rejects.toMatchObject({ code: 'session-mismatch' })
    await expect(h.service.reserveResearchRead(actor, { ...request, limit: 5 }, ToolCallId('too-wide'))).rejects.toMatchObject({ code: 'invalid-range' })
    await expect(h.service.reserveResearchRead({ ...actor, signal: AbortSignal.abort(new Error('stopped')) }, request, ToolCallId('cancelled'))).rejects.toThrow('stopped')
    for (let index = 0; index < 15; index++) await h.service.reserveResearchRead(actor, { ...request, offset: index * 4 }, ToolCallId(`page-${index}`))
    await h.restart()
    expect(await h.service.reserveResearchRead(actor, request, ToolCallId('page-0'))).toBe(4)
    await expect(h.service.reserveResearchRead(actor, { ...request, offset: 1 }, ToolCallId('page-0'))).rejects.toMatchObject({ code: 'request-conflict' })
    const last = await Promise.allSettled([h.service.reserveResearchRead(actor, { ...request, offset: 60 }, ToolCallId('last-a')),
      h.service.reserveResearchRead(actor, { ...request, offset: 64 }, ToolCallId('last-b'))])
    expect(last.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(last.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'research-budget' } })
    await h.restart()
    await expect(h.service.reserveResearchRead(actor, { ...request, limit: 1 }, ToolCallId('over-cap'))).rejects.toMatchObject({ code: 'research-budget' })
  })
}
