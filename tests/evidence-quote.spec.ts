import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseArtifactId } from '../src/contracts.ts'
import { evidenceQuoteOccurs, parseReviewOutput, StageOutputError, type EvidenceSource, type ReviewCategory, type ReviewOutput } from '../src/stage-output.ts'
import { onQuoteRepair, resolveEvidenceQuote, type QuoteRepair } from '../src/evidence-quote.ts'

/** Real stored review and exact sources from live run run_2a372815 (Bailian deepseek-v4.1-flash, settings a4). */
const fixture = JSON.parse(readFileSync(new URL('./fixtures/run-2a372815-a4-review.json', import.meta.url), 'utf8')) as {
  review: ReviewOutput; evidenceSources: Array<{ artifactId: string; kind: string; text: string }>
}
const sources: EvidenceSource[] = fixture.evidenceSources.map(source => ({ artifactId: parseArtifactId(source.artifactId), text: source.text }))
const expected = { reviewed: fixture.review.reviewed, inputRefs: fixture.review.inputRefs, requiredChecks: ['completeness', 'consistency'] as ReviewCategory[], evidenceSources: sources }
const a4 = fixture.evidenceSources[0]!
const MISQUOTE = '进一步确认受众维持现实向悬疑推理读者（依赖 a3）'
const SOURCE_EXCERPT = '受众维持现实向悬疑推理读者（依赖 a3）'

function replaceQuote(review: ReviewOutput, from: string, to: string): ReviewOutput {
  const swap = <T extends { evidence: ReviewOutput['checks'][number]['evidence'] }>(item: T): T => ({ ...item, evidence: item.evidence.map(e => e.quote === from ? { ...e, quote: to } : e) })
  return { ...review, checks: review.checks.map(swap), issues: review.issues.map(swap) }
}

describe('evidence quotes from run_2a372815 settings a4 review', () => {
  it('pins the real cause: the model prefixed invented words to an otherwise exact excerpt', () => {
    expect(a4.text).toContain(SOURCE_EXCERPT)
    expect(a4.text).not.toContain('进一步确认')
    expect(evidenceQuoteOccurs(MISQUOTE, a4.text)).toBe(false)
  })

  it('still rejects the stored review and names the offending citation so a repair can fix it', () => {
    let error: unknown
    try { parseReviewOutput(fixture.review, expected) } catch (cause) { error = cause }
    expect(error).toBeInstanceOf(StageOutputError)
    const message = (error as Error).message
    expect(message).toMatch(/^Evidence quote does not occur in its declared source/)
    expect(message).toContain(a4.artifactId)
    expect(message).toContain(MISQUOTE)
    expect(message).toMatch(/character for character/)
  })

  it('admits the same review once that quote is the exact source excerpt; every other real quote already matches', () => {
    expect(parseReviewOutput(replaceQuote(fixture.review, MISQUOTE, SOURCE_EXCERPT), expected).reviewed).toEqual(fixture.review.reviewed)
  })
})

describe('representation-only differences', () => {
  const text = a4.text
  it('matches a quote across a stored JSON line break written as a real newline', () => {
    // Stored settings are JSON: "...处理。\n6. 受众维持..." holds a backslash-n escape, not a newline.
    expect(text).toContain('处理。\\n6. 受众维持')
    expect(evidenceQuoteOccurs('交由专门的世界观维度处理。\n6. 受众维持现实向悬疑推理读者', text)).toBe(true)
  })
  it('matches full-width/half-width, whitespace, typographic quote and Markdown emphasis variants', () => {
    expect(evidenceQuoteOccurs('受众维持现实向悬疑推理读者(依赖a3)', text)).toBe(true)
    expect(evidenceQuoteOccurs('受众维持现实向悬疑推理读者（依赖 ａ３）', text)).toBe(true)
    expect(evidenceQuoteOccurs('**冷峻—温情配比约 7:3，以冷峻为主**', text)).toBe(true)
    expect(evidenceQuoteOccurs('He said “stop”.', 'He said "stop".')).toBe(true)
    expect(evidenceQuoteOccurs('He said "stop".', '{"text":"He said \\"stop\\"."}')).toBe(true)
  })
  it('keeps wording exact', () => {
    expect(evidenceQuoteOccurs('受众维持现实向推理读者（依赖 a3）', text)).toBe(false)
    expect(evidenceQuoteOccurs('受众维持现实向悬疑推理读者……不因次要情感', text)).toBe(false)
    expect(evidenceQuoteOccurs('** **', text)).toBe(false)
    expect(evidenceQuoteOccurs('ab', '{"x":"a","y":"b"}')).toBe(false)
  })
})

function collectRepairs<T>(run: () => T): { value: T; repairs: QuoteRepair[] } {
  const repairs: QuoteRepair[] = []
  const stop = onQuoteRepair(repair => { repairs.push(repair) })
  try { return { value: run(), repairs } } finally { stop() }
}

function rejection(run: () => unknown): string {
  try { run() } catch (cause) { expect(cause).toBeInstanceOf(StageOutputError); return (cause as Error).message }
  throw new Error('expected a rejection')
}

describe('host repair of near-exact quotes', () => {
  const quoteFrom = (review: ReviewOutput, artifactId: string) => review.checks.flatMap(check => check.evidence).filter(e => e.artifactId === artifactId).map(e => e.quote)

  it('snaps a single wrong character to the exact source text and reports it', () => {
    const typo = '受众维持现实向悬疑推理读着（依赖 a3）'
    const { value, repairs } = collectRepairs(() => parseReviewOutput(replaceQuote(fixture.review, MISQUOTE, typo), expected))
    expect(quoteFrom(value, a4.artifactId)).toContain(SOURCE_EXCERPT)
    expect(quoteFrom(value, a4.artifactId)).not.toContain(typo)
    expect(repairs).toHaveLength(1)
    expect(repairs[0]).toMatchObject({ kind: 'snapped', distance: 1, declared: { quote: typo }, admitted: [{ artifactId: a4.artifactId, quote: SOURCE_EXCERPT }] })
  })

  it('splits an ellipsis-joined quote into one exact citation per excerpt', () => {
    const joined = '受众维持现实向悬疑推理读者……不因次要情感'
    const { value, repairs } = collectRepairs(() => parseReviewOutput(replaceQuote(fixture.review, MISQUOTE, joined), expected))
    const quotes = quoteFrom(value, a4.artifactId)
    expect(quotes).toEqual(expect.arrayContaining(['受众维持现实向悬疑推理读者', '不因次要情感']))
    expect(quotes).not.toContain(joined)
    expect(repairs).toMatchObject([{ kind: 'segmented', distance: 0 }])
  })

  it('still rejects a quote that differs by more than the bound, and offers the closest source text to copy', () => {
    const reworded = '受众保持现实系悬疑推理读者群（依赖 a3）'
    const message = rejection(() => parseReviewOutput(replaceQuote(fixture.review, MISQUOTE, reworded), expected))
    expect(message).toMatch(/^Evidence quote does not occur in its declared source/)
    expect(message).toContain(`Closest source text, in ${a4.artifactId}`)
    expect(message).toContain('悬疑推理读者')
    // The original prefixed misquote (5 invented characters) is beyond the bound too.
    expect(rejection(() => parseReviewOutput(fixture.review, expected))).toContain('Closest source text')
  })

  it('rejects a near match that is ambiguous between two source locations', () => {
    const sources = [{ artifactId: 'artifact_a', text: '甲板七号舱门的密封圈已经老化。乙板七号舱门的密封圈已经老化。' }]
    const result = resolveEvidenceQuote({ artifactId: 'artifact_a', quote: '丙板七号舱门的密封圈已经老化' }, sources, ['artifact_a'])
    expect(result.status).toBe('rejected')
    const unique = resolveEvidenceQuote({ artifactId: 'artifact_a', quote: '甲板七号舱门的密封圈己经老化' }, sources, ['artifact_a'])
    expect(unique).toMatchObject({ status: 'admitted', citations: [{ artifactId: 'artifact_a', quote: '甲板七号舱门的密封圈已经老化' }], repair: { kind: 'snapped' } })
  })

  it('splits a quote copied from raw body JSON into its prose (run_b7e8a00f chapter 1 body review)', () => {
    // The reviewer read the stored body artifact as JSON and quoted the field scaffolding; the evidence source is the assembled prose.
    const body = { artifactId: 'artifact_body', text: '……\n\n他回到终端上，把自己这一班读过的压力曲线调出来。屏幕上那条线很平。' }
    const quote = '{"sceneId":"ch1-s8-contradiction-and-close","text":"他回到终端上，把自己这一班读过的压力曲线调出来。'
    expect(resolveEvidenceQuote({ artifactId: 'artifact_body', quote }, [body], ['artifact_body'])).toMatchObject({
      status: 'admitted', citations: [{ artifactId: 'artifact_body', quote: '他回到终端上，把自己这一班读过的压力曲线调出来。' }], repair: { kind: 'segmented' } })
    // Prose values that do not occur stay rejected.
    expect(resolveEvidenceQuote({ artifactId: 'artifact_body', quote: '{"sceneId":"s1","text":"他从未回到终端，也没有调出任何曲线。"}' }, [body], ['artifact_body']).status).toBe('rejected')
  })

  it('does not snap short quotes', () => {
    expect(resolveEvidenceQuote({ artifactId: 'artifact_a', quote: '甲板八号' }, [{ artifactId: 'artifact_a', text: '甲板七号舱门' }], ['artifact_a']).status).toBe('rejected')
  })
})

/** Real final chapter-1 outline review and exact sources from live run run_78b4448f (Bailian deepseek-v4.1-flash-1017). */
const misattributed = JSON.parse(readFileSync(new URL('./fixtures/run-78b4448f-ch1-outline-review.json', import.meta.url), 'utf8')) as {
  review: ReviewOutput; evidenceSources: Array<{ artifactId: string; kind: string; text: string }>
}

describe('mis-attributed source from run_78b4448f chapter 1 outline review', () => {
  const sources: EvidenceSource[] = misattributed.evidenceSources.map(source => ({ artifactId: parseArtifactId(source.artifactId), text: source.text }))
  const bySource = (kind: string) => sources[misattributed.evidenceSources.findIndex(source => source.kind === kind)]!
  const outline = bySource('book-outline'), settings = bySource('settings')
  const QUOTE = '第 1 章必须完成：失压事故—绑定系统—新手任务（手动封堵泄漏舱门）—首笔奖励—察觉系统提示与事故记录相矛盾的细节这一拥有系统的开场链。'
  const reviewExpected = { reviewed: misattributed.review.reviewed, inputRefs: misattributed.review.inputRefs, evidenceSources: sources }

  it('pins the real cause: the exact quote is in the settings input, but the model named the book outline', () => {
    const cited = misattributed.review.checks.flatMap(check => check.evidence).find(e => e.quote === QUOTE)
    expect(cited?.artifactId).toBe(outline.artifactId)
    expect(evidenceQuoteOccurs(QUOTE, outline.text)).toBe(false)
    expect(evidenceQuoteOccurs(QUOTE, settings.text)).toBe(true)
  })

  it('admits the stored review by correcting only the artifactId, and reports the repair', () => {
    const checks = { ...reviewExpected, requiredChecks: misattributed.review.checks.map(check => check.category) }
    // The stored attempt also carried an unrelated defect (an advisory length issue); with the quote repaired, that is now the only rejection.
    expect(rejection(() => parseReviewOutput(misattributed.review, checks))).toMatch(/^length issues must be blocking/)
    const review = { ...misattributed.review, issues: misattributed.review.issues.filter(issue => issue.category === 'style' || issue.severity === 'blocking') }
    const { value, repairs } = collectRepairs(() => parseReviewOutput(review, checks))
    const fixed = value.checks.flatMap(check => check.evidence).filter(e => e.quote === QUOTE)
    expect(fixed).toEqual([{ artifactId: settings.artifactId, quote: QUOTE }])
    expect(repairs).toContainEqual({ kind: 'reattributed', distance: 0, declared: { artifactId: outline.artifactId, quote: QUOTE }, admitted: [{ artifactId: settings.artifactId, quote: QUOTE }] })
  })

  it('lists every admitted input holding the text when the correction would be ambiguous', () => {
    const twin = { artifactId: parseArtifactId('artifact_00000000-0000-4000-8000-000000000001'), text: `副本：${QUOTE}` }
    const result = resolveEvidenceQuote({ artifactId: outline.artifactId, quote: QUOTE }, [...sources, twin], [...sources.map(source => source.artifactId), twin.artifactId])
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') {
      expect(result.hint).toContain(settings.artifactId)
      expect(result.hint).toContain(twin.artifactId)
    }
  })
})
