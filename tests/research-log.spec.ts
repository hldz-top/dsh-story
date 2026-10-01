import { expect, it } from 'vitest'
import { collectResearchSources } from '../src/research-log.ts'
import { researchSourceIndex, readResearchSource, selectResearchEvidence } from '../src/research-selection.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { WebSearchResult } from '@deepseek-ai/dsh-web'
import type { ResearchLimits } from '../src/contracts.ts'
import { useResearchLogFixture, type ResearchLogFixtureOptions } from './support/research-log-fixture.ts'

const limits: ResearchLimits = {
  maxResearchQuestions: 8, maxResearchCalls: 8, maxResearchSources: 8, maxEvidenceChars: 2000, maxResearchLogEvents: 200,
}

function nativeResearch(overrides: Partial<ResearchLogFixtureOptions> = {}) {
  return useResearchLogFixture({
    calls: [{ id: 'search-history', name: 'web_search', args: { queries: ['lighthouse history'] } }],
    search: { id: 'fixture-search', available: () => true, search: async () => ({
      sources: [{ url: 'https://example.test/history', title: 'Lighthouse record', snippet: 'abc' }], truncated: false,
    }) },
    fetch: { id: 'fixture-fetch', available: () => true, fetch: async request => ({ url: request.url, statusCode: 200,
      body: { kind: 'text', content: 'The lighthouse remains dark.' }, truncated: false }) },
    inspect: (ctx, exec, plan) => collectResearchSources(ctx, exec, plan, limits),
    ...overrides,
  })
}

it('collects a source from a native web search and the persisted call/result pair', async () => {
  const fixture = await useResearchLogFixture({
    calls: [{ id: 'search-history', name: 'web_search', args: { queries: ['lighthouse history'] } }],
    search: { id: 'fixture-search', available: () => true, search: async () => ({
      sources: [{ url: 'https://example.test/history', title: 'Lighthouse record', snippet: 'abc', publishedAt: '2026-01-01' }], truncated: false,
    }) },
    fetch: { id: 'fixture-fetch', available: () => true, fetch: async request => ({ url: request.url, statusCode: 200, body: { kind: 'text', content: 'unused' }, truncated: false }) },
    inspect: (ctx, exec, plan) => collectResearchSources(ctx, exec, plan, limits),
  })
  expect(fixture.result.isError).toBe(false)
  expect(fixture.observations).toEqual([{
    callId: 'search-history', name: 'web_search', input: { queries: ['lighthouse history'] }, callSeq: expect.any(Number), resultSeq: expect.any(Number),
    status: 'succeeded', error: null, rejectedSources: [],
    sources: [{ sourceIndex: 0, url: 'https://example.test/history', title: 'Lighthouse record', content: 'abc', bodyStart: 0, bodyEnd: 3, totalChars: 3,
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', nativeTruncated: false, httpStatus: null }],
  }])
})

it('retains a failed native search as a failed observation with its recorded error', async () => {
  const fixture = await nativeResearch({ search: { id: 'failed-search', available: () => true,
    search: async () => { throw new Error('Offline source unavailable') } } })
  expect(fixture.result.isError).toBe(false)
  expect(fixture.observations).toEqual([{
    callId: 'search-history', name: 'web_search', input: { queries: ['lighthouse history'] },
    callSeq: expect.any(Number), resultSeq: expect.any(Number), status: 'failed', sources: [], rejectedSources: [],
    error: expect.stringContaining('Offline source unavailable'),
  }])
})

it('retains usable search rows and records unresolved references at their original indexes', async () => {
  const fixture = await nativeResearch({ search: { id: 'mixed-references', available: () => true, search: async () => ({
    sources: [
      { url: 'https://example.test/zero' }, { url: 'https://example.test/one' },
      { url: 'https://example.test/two' }, { url: 'https://example.test/three' },
      { url: '/hdd/first.pdf#page=2', title: 'First unresolved reference' },
      { url: 'https://example.test/five' }, { url: 'https://example.test/six' },
      { url: '/hdd/second.pdf#page=3' },
    ], truncated: false,
  }) } })
  expect(fixture.nativeResults[0]?.isError).toBe(false)
  expect(fixture.result.isError).toBe(false)
  const observation = fixture.observations?.[0]
  expect(observation).toMatchObject({ callId: 'search-history', status: 'succeeded', error: null,
    callSeq: expect.any(Number), resultSeq: expect.any(Number), rejectedSources: [
      { sourceIndex: 4, reference: '/hdd/first.pdf#page=2', title: 'First unresolved reference', reason: 'unsupported-reference' },
      { sourceIndex: 7, reference: '/hdd/second.pdf#page=3', title: null, reason: 'unsupported-reference' },
    ] })
  expect(observation?.sources.map(source => [source.sourceIndex, source.url, source.content])).toEqual([
    [0, 'https://example.test/zero', ''], [1, 'https://example.test/one', ''],
    [2, 'https://example.test/two', ''], [3, 'https://example.test/three', ''],
    [5, 'https://example.test/five', ''], [6, 'https://example.test/six', ''],
  ])
})

it.each([200, 404])('admits the exact native fetch text, final URL and HTTP context (status %s)', async statusCode => {
  const fixture = await nativeResearch({
    calls: [{ id: 'fetch-record', name: 'web_fetch', args: { url: 'https://example.test/original' } }],
    fetch: { id: 'redirected-fetch', available: () => true, fetch: async () => ({ url: 'https://example.test/final', statusCode,
      body: { kind: 'html', content: '<h1>Harbor</h1><p>The lighthouse remains dark.</p>' }, truncated: true }) },
  })
  expect(fixture.result.isError).toBe(false)
  const result = fixture.nativeResults[0]
  if (result === undefined || result.content.length !== 1 || result.content[0]?.type !== 'text') throw new Error('Expected native fetch text')
  expect(result.isError).toBe(false)
  const observation = fixture.observations?.[0]
  expect(observation).toMatchObject({ callId: 'fetch-record', name: 'web_fetch', input: { url: 'https://example.test/original' }, status: 'succeeded', error: null })
  expect(observation?.sources).toEqual([{ sourceIndex: 0, url: 'https://example.test/final', title: null, content: result.content[0].text,
    bodyStart: expect.any(Number), bodyEnd: expect.any(Number), totalChars: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/), nativeTruncated: true, httpStatus: statusCode }])
  expect(observation?.sources[0]?.content).toContain(`Fetched https://example.test/final (HTTP ${statusCode})`)
  expect(observation?.sources[0]?.content).toContain('The lighthouse remains dark.')
})

it.each([
  { kind: 'text' as const, content: '', truncated: false },
  { kind: 'text' as const, content: ' \n\t', truncated: false },
  { kind: 'html' as const, content: '<div></div>', truncated: false },
  { kind: 'text' as const, content: '', truncated: true },
])('does not cite native fetch display metadata as source content: %j', async body => {
  const fixture = await nativeResearch({
    calls: [{ id: 'empty-fetch', name: 'web_fetch', args: { url: 'https://example.test/empty' } }],
    fetch: { id: 'empty-fetch-provider', available: () => true, fetch: async request => ({
      url: request.url, statusCode: 200, body: { kind: body.kind, content: body.content }, truncated: body.truncated,
    }) },
  })
  expect(fixture.result.isError).toBe(false)
  const native = fixture.nativeResults[0]
  expect(native?.isError).toBe(false)
  expect(native?.content).toEqual([{ type: 'text', text: expect.stringContaining('Fetched https://example.test/empty (HTTP 200)') }])
  expect(fixture.observations?.[0]).toMatchObject({ status: 'succeeded', error: null, sources: [{ url: 'https://example.test/empty', content: expect.any(String), totalChars: expect.any(Number) }] })
  expect(fixture.observations?.[0]?.sources[0]?.sha256).not.toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  const observations = fixture.observations
  const actualCall = observations?.[0]
  if (observations === undefined || actualCall === undefined) throw new Error('Actual native observations are missing')
  expect(researchSourceIndex(observations, limits)[0]!.sources[0]!.eligibility).toBe('empty')
})

it('indexes a clipped fetch preamble as empty while keeping a later source available', async () => {
  const fixture = await nativeResearch({
    calls: [
      { id: 'clipped-fetch', name: 'web_fetch', args: { url: 'https://example.test/page' } },
      { id: 'retained-search', name: 'web_search', args: { queries: ['history'] } },
    ], fetchMaxOutputChars: 1,
  })
  expect(fixture.result.isError).toBe(false)
  const observations = fixture.observations
  if (observations === undefined) throw new Error('Expected recorded sources')
  const index = researchSourceIndex(observations, limits)
  expect(index.map(call => call.sources[0]!.eligibility)).toEqual(['empty', 'usable'])
  expect(readResearchSource(observations, { callId: observations[1]!.callId, sourceIndex: 0, offset: 0, limit: 3 }, 3).text).toBe('abc')
})

it('retains native success without evidence when the fetch tool cap contains only display metadata', async () => {
  const fixture = await nativeResearch({
    calls: [{ id: 'capped-fetch', name: 'web_fetch', args: { url: 'https://example.test/page' } }],
    fetchMaxOutputChars: 1,
  })
  expect(fixture.nativeResults[0]?.content).toEqual([{ type: 'text', text: 'F' }])
  expect(fixture.result.isError).toBe(false)
  expect(fixture.observations?.[0]).toMatchObject({ status: 'succeeded', error: null, sources: [{ content: 'F', bodyStart: 0, bodyEnd: 0, totalChars: 1, nativeTruncated: true }] })
})

it('keeps complete Unicode source text and selects only explicit ranges with complete-content hashes', async () => {
  const fixture = await nativeResearch({
    calls: [{ id: 'first-search', name: 'web_search', args: { queries: ['first'] } }, { id: 'second-search', name: 'web_search', args: { queries: ['second'] } }],
    search: { id: 'unicode-search', available: () => true, search: async request => ({ sources: [{ url: `https://example.test/${request.query}`, snippet: request.query === 'first' ? '😀甲乙' : 'abc' }], truncated: false }) },
  })
  expect(fixture.result.isError).toBe(false)
  const observations = fixture.observations
  if (observations === undefined) throw new Error('Expected recorded sources')
  expect(observations.map(call => call.sources[0]!.content)).toEqual(['😀甲乙', 'abc'])
  const first = observations[0]!.callId
  const second = observations[1]!.callId
  const selected = selectResearchEvidence(observations, [{ questionId: 'history', callIds: [first, second], conclusion: 'These explicit ranges support the answer.', adequate: true,
    selections: [{ callId: first, sourceIndex: 0, offset: 0, limit: 3 }, { callId: second, sourceIndex: 0, offset: 0, limit: 1 }] }], limits)
  expect(selected.map(call => call.sources[0]!.excerpts)).toEqual([[{ offset: 0, limit: 3, text: '😀甲乙' }], [{ offset: 0, limit: 1, text: 'a' }]])
  expect(selected[1]!.sources[0]!.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  expect(selected[1]!.sources[0]!.totalChars).toBe(3)
})

it('does not turn a provider answer or source title into quoted evidence', async () => {
  const fixture = await nativeResearch({ search: { id: 'answer-only', available: () => true, search: async () => ({
    content: 'The model answer claims the harbor is real.', sources: [{ url: 'https://example.test/empty', title: 'An asserted fact' }], truncated: false,
  }) } })
  expect(fixture.result.isError).toBe(false)
  expect(fixture.observations?.[0]?.sources).toEqual([{ sourceIndex: 0, url: 'https://example.test/empty', title: 'An asserted fact',
    content: '', bodyStart: 0, bodyEnd: 0, totalChars: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', nativeTruncated: false, httpStatus: null }])
})

it('rejects source overflow instead of silently dropping recorded URLs', async () => {
  const fixture = await nativeResearch({ search: { id: 'two-sources', available: () => true, search: async () => ({
    sources: [{ url: 'https://example.test/first', snippet: 'First' }, { url: 'https://example.test/second', snippet: 'Second' }], truncated: false,
  }) }, inspect: (ctx, exec, plan) => collectResearchSources(ctx, exec, plan, { ...limits, maxResearchSources: 1 }) })
  expect(fixture.result.isError).toBe(true)
  expect(fixture.result.content).toEqual([{ type: 'text', text: expect.stringContaining('source index count exceeds') }])
  expect(fixture.observations).toBeUndefined()
})

it('records a non-HTTP reference without admitting its snippet as evidence', async () => {
  const fixture = await nativeResearch({ search: { id: 'invalid-source', available: () => true, search: async () => ({
    sources: [{ url: 'file:///not-an-external-source', snippet: 'Unverified local material' }], truncated: false,
  }) } })
  expect(fixture.nativeResults[0]?.isError).toBe(false)
  expect(fixture.result.isError).toBe(false)
  expect(fixture.observations?.[0]).toMatchObject({ status: 'succeeded', sources: [], rejectedSources: [
    { sourceIndex: 0, reference: 'file:///not-an-external-source', title: null, reason: 'unsupported-reference' },
  ] })
})

it.each(['log', 'calls'] as const)('rejects a %s budget below the actual native interval', async bound => {
  const fixture = await nativeResearch({
    calls: [{ id: 'one', name: 'web_search', args: { queries: ['one'] } }, { id: 'two', name: 'web_search', args: { queries: ['two'] } }],
    inspect: (ctx, exec, plan) => collectResearchSources(ctx, exec, plan, bound === 'log' ? { ...limits, maxResearchLogEvents: 1 } : { ...limits, maxResearchCalls: 1 }),
  })
  expect(fixture.result.isError).toBe(true)
  expect(fixture.result.content).toEqual([{ type: 'text', text: expect.stringContaining('configured limit') }])
  expect(fixture.observations).toBeUndefined()
})

it.each(['session', 'window', 'name'] as const)('refuses evidence whose reserved %s does not match the actual execution', async mismatch => {
  const fixture = await nativeResearch({ inspect: (ctx, exec, plan) => collectResearchSources(ctx, exec,
    mismatch === 'session' ? { ...plan, sessionId: SessionId('another-session') }
      : mismatch === 'window' ? { ...plan, startSeq: exec.agent!.session.seq }
      : { ...plan, reservedCalls: plan.reservedCalls.map(call => ({ ...call, name: 'web_fetch' })) }, limits) })
  expect(fixture.result.isError).toBe(true)
  expect(fixture.observations).toBeUndefined()
})

it('refuses a native search that is still executing when a concurrent inspection starts', async () => {
  const entered = Promise.withResolvers<void>()
  const pending = Promise.withResolvers<WebSearchResult>()
  const fixture = await nativeResearch({ inspectAlongside: true,
    search: { id: 'pending-search', available: () => true, search: async () => { entered.resolve(); return pending.promise } },
    inspect: async (ctx, exec, plan) => {
      await entered.promise
      try { return await collectResearchSources(ctx, exec, plan, limits) }
      finally { pending.resolve({ sources: [{ url: 'https://example.test/late', snippet: 'Too late for that inspection' }], truncated: false }) }
    },
  })
  expect(fixture.result.isError).toBe(true)
  expect(fixture.result.content).toEqual([{ type: 'text', text: expect.stringContaining('no complete logged result') }])
  expect(fixture.observations).toBeUndefined()
  expect(fixture.nativeResults[0]?.isError).toBe(false)
})

it('propagates cancellation of the actual inspecting tool after the Session flush', async () => {
  const controller = new AbortController()
  const fixture = await nativeResearch({ inspectionSignal: controller.signal,
    inspect: async (ctx, exec, plan) => {
      const remove = ctx.on('session/flush', () => { controller.abort(new Error('Research inspection stopped')) })
      try { return await collectResearchSources(ctx, exec, plan, limits) }
      finally { remove() }
    },
  })
  expect(fixture.result.isError).toBe(true)
  expect(fixture.observations).toBeUndefined()
  expect(controller.signal.aborted).toBe(true)
})

it('retains a Session durability failure instead of admitting buffered in-memory results', async () => {
  const fixture = await nativeResearch({ inspect: async (ctx, exec, plan) => {
    const remove = ctx.on('session/flush', () => { throw new Error('Fixture durability unavailable') })
    try { return await collectResearchSources(ctx, exec, plan, limits) }
    finally { remove() }
  } })
  expect(fixture.result.isError).toBe(true)
  expect(fixture.result.content).toEqual([{ type: 'text', text: expect.stringContaining('Fixture durability unavailable') }])
  expect(fixture.observations).toBeUndefined()
})

it('rejects reused native call IDs instead of combining their separate results', async () => {
  const fixture = await nativeResearch({
    calls: [{ id: 'reused', name: 'web_search', args: { queries: ['first'] } }, { id: 'reused', name: 'web_search', args: { queries: ['second'] } }],
    // Each call must fully settle before the next is issued: the session format now rejects
    // one still-open call id advertised a second time within the same assistant turn.
    sequential: true,
    inspect: (ctx, exec, plan) => collectResearchSources(ctx, exec, { ...plan, reservedCalls: [plan.reservedCalls[0]!] }, limits),
  })
  expect(fixture.result.isError).toBe(true)
  expect(fixture.result.content).toEqual([{ type: 'text', text: expect.stringContaining('duplicated') }])
  expect(fixture.observations).toBeUndefined()
})

it('uses the original native result after a later Session surface rewrite', async () => {
  const fixture = await nativeResearch({ calls: [{ id: 'fetch-original', name: 'web_fetch', args: { url: 'https://example.test/record' } }],
    inspect: async (ctx, exec, plan) => {
      const session = exec.agent!.session
      await ctx.sessions.flush(session)
      const handle = await ctx.sessionPersistence.open(session.id, 'read')
      try {
        const { events } = await handle.read(plan.startSeq)
        const original = events.find(event => event.type === 'tool/result')
        if (original?.type !== 'tool/result') throw new Error('Expected recorded native fetch')
        session.append('tool/result', { ...original.data, message: { ...original.data.message,
          content: [{ type: 'text', text: 'A compacted display summary.' }] } },
        { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })
      } finally { await handle.close() }
      return collectResearchSources(ctx, exec, plan, limits)
    },
  })
  expect(fixture.result.isError).toBe(false)
  expect(fixture.observations?.[0]?.sources[0]?.content).toContain('The lighthouse remains dark.')
  expect(fixture.observations?.[0]?.sources[0]?.content).not.toContain('A compacted display summary.')
  expect(fixture.observations).toHaveLength(1)
})

it.each([1, 2])('counts usable and rejected native source rows together at cap %s', async cap => {
  const fixture = await nativeResearch({ search: { id: 'bounded-mixed', available: () => true, search: async () => ({
    sources: [{ url: 'https://example.test/signal', snippet: 'abc' }, { url: '/relative' }], truncated: false,
  }) }, inspect: (ctx, exec, plan) => collectResearchSources(ctx, exec, plan, { ...limits, maxResearchSources: cap }) })
  expect(fixture.result.isError).toBe(cap === 1)
  if (cap === 1) {
    expect(fixture.observations).toBeUndefined()
    expect(fixture.result.content).toEqual([{ type: 'text', text: expect.stringContaining('source index count exceeds') }])
  } else expect(fixture.observations?.[0]).toMatchObject({ sources: [{ sourceIndex: 0 }], rejectedSources: [{ sourceIndex: 1 }] })
})

it.each([37, 38])('counts rejected reference and title Unicode characters with native metadata at cap %s', async cap => {
  const fixture = await nativeResearch({ search: { id: 'bounded-reference', available: () => true, search: async () => ({
    sources: [{ url: '/😀甲', title: '乙😀丙' }], truncated: false,
  }) }, inspect: (ctx, exec, plan) => collectResearchSources(ctx, exec, plan, { ...limits, maxEvidenceChars: cap }) })
  expect(fixture.result.isError).toBe(cap === 37)
  if (cap === 37) expect(fixture.result.content).toEqual([{ type: 'text', text: expect.stringContaining('metadata exceeds') }])
  else expect(fixture.observations?.[0]?.rejectedSources).toEqual([{ sourceIndex: 0, reference: '/😀甲', title: '乙😀丙', reason: 'unsupported-reference' }])
})

it.each([95, 96])('retains twelve eight-source native searches only when the source cap permits all 96 rows (cap %s)', async cap => {
  const fixture = await nativeResearch({
    calls: Array.from({ length: 12 }, (_, index) => ({ id: `batch-${index}`, name: 'web_search' as const, args: { queries: [`signal-${index}`] } })),
    search: { id: 'full-search-budget', available: () => true, search: async () => ({
      sources: Array.from({ length: 8 }, (_, index) => ({ url: `https://example.test/signal/${index}`, snippet: 'abc' })), truncated: false,
    }) },
    inspect: (ctx, exec, plan) => collectResearchSources(ctx, exec, plan, { ...limits, maxResearchCalls: 12, maxResearchSources: cap, maxResearchLogEvents: 512, maxEvidenceChars: 16000 }),
  })
  expect(fixture.result.isError).toBe(cap === 95)
  if (cap === 95) expect(fixture.result.content).toEqual([{ type: 'text', text: expect.stringContaining('source index count exceeds') }])
  else expect(fixture.observations?.flatMap(observation => observation.sources)).toHaveLength(96)
})

it.each([
  '{"sources":[{"url":42}],"truncated":false}',
  '{"sources":[{"url":"https://example.test/signal"}],"truncated":"false"}',
])('retains native rejection of malformed provider JSON as a failed observation: %s', async payload => {
  const fixture = await nativeResearch({ search: { id: 'malformed-wire-search', available: () => true,
    // Invalid external JSON exercises native output validation before evidence collection.
    search: async (): Promise<WebSearchResult> => JSON.parse(payload),
  } })
  const native = fixture.nativeResults[0]
  expect(native?.isError).toBe(true)
  expect(fixture.result.isError).toBe(false)
  const error = native?.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  expect(error?.trim().length).toBeGreaterThan(0)
  expect(fixture.observations).toEqual([{ callId: 'search-history', name: 'web_search', input: { queries: ['lighthouse history'] },
    callSeq: expect.any(Number), resultSeq: expect.any(Number), status: 'failed', error, sources: [], rejectedSources: [] }])
})
