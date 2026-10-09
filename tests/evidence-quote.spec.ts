import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseArtifactId } from '../src/contracts.ts'
import { evidenceQuoteOccurs, parseReviewOutput, StageOutputError, type EvidenceSource, type ReviewCategory, type ReviewOutput } from '../src/stage-output.ts'

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
