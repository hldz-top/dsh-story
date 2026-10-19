import { describe, expect, it } from 'vitest'
import { parseArtifactId } from '../src/contracts.ts'
import { EvidenceRejection, parseContinuityOutput, parseReviewOutput, StageOutputError, type ReviewOutput } from '../src/stage-output.ts'
import { buildCitationRepairPrompt, mergeCitationRepair } from '../src/citation-repair.ts'
import { collectQuoteRepairs, onQuoteRepair, type QuoteRepair } from '../src/evidence-quote.ts'

const sha = (digit: string) => digit.repeat(64)
const body = parseArtifactId('artifact_00000000-0000-4000-8000-0000000000b1')
const outline = parseArtifactId('artifact_00000000-0000-4000-8000-0000000000c1')
const BODY = '沈遥扶住壁板，停了。舱段在掉压，气流专往他右手边扯。他把胶枪压在缝上，一寸一寸往前推。门框比四周板面凉一截。'
const OUTLINE = '第 1 章必须完成：失压事故—绑定系统—新手任务（手动封堵泄漏舱门）—首笔奖励。'
const sources = [{ artifactId: body, text: BODY }, { artifactId: outline, text: OUTLINE }]
const expected = { reviewed: { artifactId: body, sha256: sha('b') }, inputRefs: [{ artifactId: outline, sha256: sha('c') }], requiredChecks: ['completeness', 'consistency'] as const, evidenceSources: sources }

function review(overrides: Partial<ReviewOutput> = {}): ReviewOutput {
  return {
    version: 1, reviewed: expected.reviewed, inputRefs: expected.inputRefs,
    checks: [
      { category: 'completeness', summary: '失压与封堵都写到了。', evidence: [{ artifactId: body, quote: '他把胶枪压在缝上，一寸一寸往前推。' }] },
      { category: 'consistency', summary: '温度细节前后一致。', evidence: [{ artifactId: body, quote: '门框比四周板面凉一截。' }] },
    ],
    issues: [], ...overrides,
  } as ReviewOutput
}

function collect<T>(run: () => T): { value: T; repairs: QuoteRepair[] } {
  const repairs: QuoteRepair[] = []
  const stop = onQuoteRepair(repair => { repairs.push(repair) })
  try { return { value: run(), repairs } } finally { stop() }
}

function thrown(run: () => unknown): unknown {
  try { run() } catch (cause) { return cause }
  throw new Error('expected a rejection')
}

describe('dropping an unresolvable citation when its item keeps valid evidence', () => {
  it('drops it, keeps the valid quote, and reports a dropped event with the item location and host reason', () => {
    const value = review()
    value.checks[0]!.evidence.push({ artifactId: body, quote: '可惜没找到' })
    const { value: admitted, repairs } = collect(() => parseReviewOutput(value, expected))
    expect(admitted.checks[0]!.evidence).toEqual([{ artifactId: body, quote: '他把胶枪压在缝上，一寸一寸往前推。' }])
    expect(repairs).toEqual([{ kind: 'dropped', location: 'checks[0]', declared: { artifactId: body, quote: '可惜没找到' }, admitted: [], distance: 0, reason: expect.stringMatching(/^Evidence quote does not occur in its declared source/) }])
  })

  it('still rejects an item with no remaining valid evidence, reports no drop, and lists every such item', () => {
    const value = review()
    value.checks[0]!.evidence = [{ artifactId: body, quote: '可惜没找到' }]
    value.checks[1]!.evidence = [{ artifactId: body, quote: '"chapterNumber":1,"scenes":' }]
    const { repairs, value: cause } = collect(() => thrown(() => parseReviewOutput(value, expected)))
    expect(cause).toBeInstanceOf(EvidenceRejection)
    expect(cause).toBeInstanceOf(StageOutputError)
    const rejection = cause as EvidenceRejection
    expect(rejection.unresolved.map(item => item.location)).toEqual(['checks[0]', 'checks[1]'])
    expect(rejection.message).toMatch(/^Evidence quote does not occur in its declared source .*可惜没找到.*\(evidence item checks\[0\]\) 1 more evidence item\(s\) also have no admissible quote: checks\[1\]\./su)
    expect(repairs.filter(repair => repair.kind === 'dropped')).toEqual([])
  })

  it('applies every non-evidence rule first, so an evidence rejection is always the only defect', () => {
    const value = review({ issues: [{ id: 'i1', severity: 'advisory', category: 'continuity', location: '全章', message: '…', evidence: [{ artifactId: body, quote: '可惜没找到' }] }] })
    const cause = thrown(() => parseReviewOutput(value, expected))
    expect(cause).not.toBeInstanceOf(EvidenceRejection)
    expect((cause as Error).message).toMatch(/^continuity issues must be blocking/)
  })

  it('drops within continuity too, and still rejects a timeline event left without evidence', () => {
    const refs = [{ artifactId: body, sha256: sha('b') }]
    const base = { version: 1, inputRefs: refs, chapterNumber: 1, summary: '第一章结束。', characters: [], obligations: [] }
    const ok = collect(() => parseContinuityOutput({ ...base, timeline: [{ event: '封堵', evidence: [{ artifactId: body, quote: '一寸一寸往前推' }, { artifactId: body, quote: '他跳了下去' }] }] },
      { inputRefs: refs, chapterNumber: 1, obligationIds: [], evidenceSources: [sources[0]!], reviewedBodyId: body }))
    expect(ok.value.timeline[0]!.evidence).toEqual([{ artifactId: body, quote: '一寸一寸往前推' }])
    expect(ok.repairs).toEqual([expect.objectContaining({ kind: 'dropped', location: 'timeline[0]' })])
    expect(thrown(() => parseContinuityOutput({ ...base, timeline: [{ event: '封堵', evidence: [{ artifactId: body, quote: '他跳了下去' }] }] },
      { inputRefs: refs, chapterNumber: 1, obligationIds: [], evidenceSources: [sources[0]!], reviewedBodyId: body }))).toBeInstanceOf(EvidenceRejection)
  })

  it('scopes collected repairs to one admission even when admissions run concurrently', async () => {
    const one = review(); one.checks[0]!.evidence.push({ artifactId: body, quote: '可惜没找到' })
    const two = review()
    const [a, b] = await Promise.all([collectQuoteRepairs(async () => parseReviewOutput(one, expected)), collectQuoteRepairs(async () => parseReviewOutput(two, expected))])
    expect(a.repairs.map(repair => repair.kind)).toEqual(['dropped'])
    expect(b.repairs).toEqual([])
    expect(a.result.status).toBe('fulfilled')
  })
})

describe('citation-only repair of an evidence-rejected review', () => {
  const prior = review()
  prior.checks[0]!.evidence = [{ artifactId: outline, quote: '他把签了名的简报折好' }]
  const rejection = thrown(() => parseReviewOutput(prior, expected)) as EvidenceRejection

  it('gives the repair child only the unresolved items, with their claims, rejected quotes and host reasons', () => {
    expect(rejection.unresolved.map(item => item.location)).toEqual(['checks[0]'])
    const prompt = buildCitationRepairPrompt({ novelId: 'novel_x', inputs: [], prior, unresolved: rejection.unresolved })
    const data = JSON.parse(prompt.slice(prompt.indexOf('TASK_DATA\n\n') + 'TASK_DATA\n\n'.length)) as { kind: string; items: Array<{ location: string; claim: object; rejected: Array<{ quote: string; hostReason: string }> }> }
    expect(data.kind).toBe('review-citation-repair')
    expect(data.items).toEqual([{ location: 'checks[0]', claim: { category: 'completeness', summary: '失压与封堵都写到了。' }, rejected: [{ artifactId: outline, quote: '他把签了名的简报折好', hostReason: rejection.unresolved[0]!.reasons[0] }] }])
    expect(prompt).not.toContain('门框比四周板面凉一截')
  })

  it('replaces only the rejected item\'s evidence; every accepted item and field stays identical, and the merge then admits', () => {
    const merged = mergeCitationRepair(prior, rejection.unresolved, { version: 1, items: [{ location: 'checks[0]', evidence: [{ artifactId: body, quote: '他把胶枪压在缝上' }] }] }) as ReviewOutput
    expect(merged.checks[1]).toEqual(prior.checks[1])
    expect({ ...merged, checks: [] }).toEqual({ ...prior, checks: [] })
    expect(merged.checks[0]).toEqual({ ...prior.checks[0], evidence: [{ artifactId: body, quote: '他把胶枪压在缝上' }] })
    expect(prior.checks[0]!.evidence[0]!.quote).toBe('他把签了名的简报折好')
    expect(parseReviewOutput(merged, expected).checks[0]!.evidence).toEqual([{ artifactId: body, quote: '他把胶枪压在缝上' }])
  })

  it('rejects a repair that touches an unlisted item or omits a listed one', () => {
    expect(() => mergeCitationRepair(prior, rejection.unresolved, { version: 1, items: [{ location: 'checks[1]', evidence: [{ artifactId: body, quote: '门框' }] }] }))
      .toThrow(/exactly one entry per listed location: missing "checks\[0\]"; unexpected "checks\[1\]"/)
    expect(() => mergeCitationRepair(prior, rejection.unresolved, { version: 1, items: [] })).toThrow(StageOutputError)
  })
})
