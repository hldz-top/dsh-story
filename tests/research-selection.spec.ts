import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { expect, it } from 'vitest'
import { collectResearchSources } from '../src/research-log.ts'
import { researchSourceIndex, readResearchSource, selectResearchEvidence, researchSelectedConclusions, selectedObservationSchema, type NativeResearchObservation, type ResearchSelectedFinding } from '../src/research-selection.ts'
import { useResearchLogFixture } from './support/research-log-fixture.ts'
import { testResearchLimits } from './support/storage.ts'

it('keeps a later useful native page selectable after an oversized corrupted first page', async () => {
  let log: NativeResearchObservation[] | undefined
  const limits = { ...testResearchLimits, maxEvidenceChars: 2000 }
  const fixture = await useResearchLogFixture({
    calls: [{ id: 'first', name: 'web_fetch', args: { url: 'https://example.test/first' } }, { id: 'later', name: 'web_fetch', args: { url: 'https://example.test/later' } }],
    fetchMaxOutputChars: 20000,
    search: { id: 'selection-search', available: () => true, search: async () => ({ sources: [], truncated: false }) },
    fetch: { id: 'selection-fetch', available: () => true, fetch: async request => ({ url: request.url, statusCode: 200, truncated: false,
      body: { kind: 'text', content: request.url.endsWith('first') ? '\uFFFD'.repeat(12000) : '灯光每十秒闪烁一次。' } }) },
    inspect: async (ctx, exec, plan) => { log = await collectResearchSources(ctx, exec, plan, limits); return [] },
  })
  expect(fixture.result.isError).toBe(false)
  if (log === undefined) throw new Error('Native sources were not collected')
  const index = researchSourceIndex(log, limits)
  expect(index.map(call => call.sources[0]?.eligibility)).toEqual(['suspect-encoding', 'usable'])
  expect(JSON.stringify(index)).not.toContain('\uFFFD')
  expect(JSON.stringify(index)).not.toContain('灯光每十秒')
  const later = log[1]!
  const source = later.sources[0]!
  const findings = [{ questionId: 'history', callIds: [later.callId], adequate: true, conclusion: 'The recorded light flashes every ten seconds.',
    selections: [{ callId: later.callId, sourceIndex: 0, offset: source.bodyStart, limit: source.bodyEnd - source.bodyStart }] }]
  const selected = selectResearchEvidence(log, findings, limits)
  expect(selected[0]!.sources[0]).toMatchObject({ retention: 'unselected', excerpts: [] })
  expect(selected[1]!.sources[0]).toMatchObject({ retention: 'selected', excerpts: [{ text: '灯光每十秒闪烁一次。' }] })
  expect(researchSelectedConclusions(fixture.plan.questions, findings, selected, limits).outcome).toBe('succeeded')
})

const sampleCallId = brandString<ToolCallId>('sample-call')
const questions = [{ id: 'fact', kind: 'external' as const, question: 'What happened?', reason: 'The required scene needs the recorded real fact.' }]
function sampleLog(content: string, httpStatus: number | null = null): NativeResearchObservation[] {
  return [{ callId: sampleCallId, name: httpStatus === null ? 'web_search' : 'web_fetch', input: httpStatus === null ? { queries: ['fact'] } : { url: 'https://example.test/fact' },
    callSeq: 1, resultSeq: 2, status: 'succeeded', error: null, rejectedSources: [], sources: [{ sourceIndex: 0, url: 'https://example.test/fact', title: 'Recorded fact', content,
      sha256: createHash('sha256').update(content).digest('hex'), totalChars: [...content].length, bodyStart: 0, bodyEnd: [...content].length, httpStatus, nativeTruncated: false }] }]
}
function finding(offset: number, limit: number): ResearchSelectedFinding {
  return { questionId: 'fact', callIds: [sampleCallId], adequate: true, conclusion: 'The supplied passage supports the scene.', selections: [{ callId: sampleCallId, sourceIndex: 0, offset, limit }] }
}

it('reads literal Unicode pages and permits an empty end-of-source page', () => {
  const log = sampleLog('A😀B𠀀C')
  const range = { callId: sampleCallId, sourceIndex: 0, offset: 1, limit: 2 }
  expect(readResearchSource(log, range, 2)).toMatchObject({ offset: 1, text: '😀B', nextOffset: 3, totalChars: 5, eof: false })
  expect(readResearchSource(log, { ...range, offset: 5, limit: 1 }, 2)).toMatchObject({ text: '', offset: 5, nextOffset: 5, eof: true })
  expect(selectResearchEvidence(log, [finding(1, 2)], testResearchLimits)[0]!.sources[0]!.excerpts).toEqual([{ offset: 1, limit: 2, text: '😀B' }])
})

it.each([
  { sourceIndex: 1, offset: 0, limit: 1 }, { sourceIndex: 0, offset: -1, limit: 1 },
  { sourceIndex: 0, offset: 6, limit: 1 }, { sourceIndex: 0, offset: 0, limit: 0 },
  { sourceIndex: 0, offset: 0, limit: 3 }, { sourceIndex: 0, offset: 0.5, limit: 1 },
])('rejects unobserved or out-of-bounds source pages: %j', range => {
  expect(() => readResearchSource(sampleLog('A😀B𠀀C'), { callId: sampleCallId, ...range }, 2)).toThrow()
})

it('keeps HTTP 403 text readable while rejecting it as adequate factual evidence', () => {
  const log = sampleLog('Security verification is required.', 403)
  const findings = [finding(0, 8)]
  expect(readResearchSource(log, findings[0]!.selections[0]!, 8)).toMatchObject({ httpStatus: 403, eligibility: 'http-error', text: 'Security' })
  const observations = selectResearchEvidence(log, findings, testResearchLimits)
  expect(researchSelectedConclusions(questions, findings, observations, testResearchLimits).outcome).toBe('insufficient')
  expect(selectedObservationSchema.safeParse({ ...observations[0], sources: [{ ...observations[0]!.sources[0], eligibility: 'usable' }] }).success).toBe(false)
})

it('requires selected usable text rather than a source title or model adequacy flag', () => {
  for (const log of [sampleLog(''), sampleLog('  '), sampleLog('garbled � text')]) {
    const empty = { ...finding(0, 1), selections: [] }
    expect(researchSelectedConclusions(questions, [empty], selectResearchEvidence(log, [empty], testResearchLimits), testResearchLimits).outcome).toBe('insufficient')
  }
  const bad = [finding(0, 1)]
  expect(researchSelectedConclusions(questions, bad, selectResearchEvidence(sampleLog('�'), bad, testResearchLimits), testResearchLimits).outcome).toBe('insufficient')
})

it('deduplicates exact shared ranges and enforces the total selected-text cap', () => {
  const limits = { ...testResearchLimits, maxEvidenceChars: 1000 }
  const log = sampleLog('x'.repeat(1001))
  const first = finding(0, 1000)
  const observations = selectResearchEvidence(log, [first, { ...first, questionId: 'another' }], limits)
  expect(observations[0]!.sources[0]!.excerpts).toHaveLength(1)
  expect(observations[0]!.sources[0]!.excerpts[0]!.text).toHaveLength(1000)
  expect(() => selectResearchEvidence(log, [first, finding(1000, 1)], limits)).toThrow('Selected research excerpts exceed')
})

it('counts source metadata separately from selected excerpt text', () => {
  const limits = { ...testResearchLimits, maxEvidenceChars: 1000 }
  const log = sampleLog('x'.repeat(1000))
  expect(selectResearchEvidence(log, [finding(0, 1000)], limits)[0]!.sources[0]!.excerpts[0]!.limit).toBe(1000)
  const oversized = log.map(call => ({ ...call, sources: call.sources.map(source => ({ ...source, title: 't'.repeat(1001) })) }))
  expect(() => researchSourceIndex(oversized, limits)).toThrow('source index metadata')
})

it('refuses display headers, unknown calls, rejected sources and ranges beyond recorded text', () => {
  const log = sampleLog('HEADER body FOOTER', 200).map(call => ({ ...call, sources: call.sources.map(source => ({ ...source, bodyStart: 7, bodyEnd: 11 })) }))
  expect(() => selectResearchEvidence(log, [finding(0, 6)], testResearchLimits)).toThrow('source body')
  expect(() => selectResearchEvidence(log, [finding(7, 12)], testResearchLimits)).toThrow('fit entirely')
  expect(() => readResearchSource(log, { callId: brandString<ToolCallId>('unknown'), sourceIndex: 0, offset: 7, limit: 1 }, 10)).toThrow('observed native call')
  const rejected = log.map(call => ({ ...call, sources: [], rejectedSources: [{ sourceIndex: 0, reference: '/private/source', title: null, reason: 'unsupported-reference' as const }] }))
  expect(() => readResearchSource(rejected, { callId: sampleCallId, sourceIndex: 0, offset: 0, limit: 1 }, 10)).toThrow('unobserved or rejected source')
})

it('does not allow an adequate finding to cite a range absent from saved evidence', () => {
  const log = sampleLog('An accurate real fact.')
  const saved = selectResearchEvidence(log, [finding(0, 2)], testResearchLimits)
  expect(() => researchSelectedConclusions(questions, [finding(2, 2)], saved, testResearchLimits)).toThrow('absent from saved evidence')
})

it('bounds duplicate selection declarations separately from deduplicated text', () => {
  const limits = { ...testResearchLimits, maxEvidenceChars: 1000 }
  const input = finding(0, 1)
  const repeated = { ...input, selections: Array.from({ length: 100 }, () => input.selections[0]!) }
  expect(() => selectResearchEvidence(sampleLog('fact'), [repeated], limits)).toThrow('source index metadata')
})

const failedCallId = brandString<ToolCallId>('failed-call')
/** A native call that failed in transport: recorded with its error and no sources. */
function failedCall(): NativeResearchObservation {
  return { callId: failedCallId, name: 'web_fetch', input: { url: 'https://example.test/broken' }, callSeq: 3, resultSeq: 4, status: 'failed', error: 'fetch failed', rejectedSources: [], sources: [] }
}
const creativeQuestion = { id: 'ending', kind: 'creative' as const, question: 'How does the story end?', reason: 'An authorial decision.' }
const creativeFinding: ResearchSelectedFinding = { questionId: 'ending', callIds: [], adequate: true, conclusion: 'The keeper leaves at dawn.', selections: [] }

it.each([
  { label: 'an adequate external finding citing only a successful call', planned: questions, findings: [finding(0, 2)], expected: 'succeeded' },
  { label: 'only a creative finding', planned: [creativeQuestion], findings: [creativeFinding], expected: 'not-needed' },
  { label: 'an inadequate external finding', planned: questions, findings: [{ ...finding(0, 2), adequate: false }], expected: 'insufficient' },
])('derives the aggregate outcome from the findings alone when a call that no finding cites failed: $label', ({ planned, findings, expected }) => {
  const observations = selectResearchEvidence([...sampleLog('An accurate real fact.'), failedCall()], findings, testResearchLimits)
  const classified = researchSelectedConclusions(planned, findings, observations, testResearchLimits)
  expect(classified.outcome).toBe(expected)
  expect(classified.findings.map(item => item.outcome)).toEqual([expected])
  // The failure stays in the saved evidence exactly as recorded: neither hidden, dropped nor rewritten.
  expect(observations).toHaveLength(2)
  expect(observations[1]).toEqual(failedCall())
})

it.each([
  { label: 'a finding cites the failed call', findings: [{ ...finding(0, 2), callIds: [failedCallId], selections: [] }] },
  { label: 'an external finding cites no call', findings: [{ ...finding(0, 2), callIds: [], selections: [] }] },
])('still fails the aggregate outcome when a finding itself fails: $label', ({ findings }) => {
  const observations = selectResearchEvidence([...sampleLog('An accurate real fact.'), failedCall()], findings, testResearchLimits)
  expect(researchSelectedConclusions(questions, findings, observations, testResearchLimits)).toMatchObject({ outcome: 'failed', findings: [{ outcome: 'failed' }] })
})
