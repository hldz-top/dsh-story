/** Settings reviews keep an advisory completeness note as a recorded finding; every other category and every other review keeps today's rules. */
import { describe, expect, it } from 'vitest'
import { parseArtifactId } from '../src/contracts.ts'
import { parseReviewOutput, type ReviewOutput } from '../src/stage-output.ts'
import { StageValidationRejection } from '../src/stage-rejection.ts'

const sha = (digit: string) => digit.repeat(64)
const setting = parseArtifactId('artifact_00000000-0000-4000-8000-0000000000d1')
const brief = parseArtifactId('artifact_00000000-0000-4000-8000-0000000000d2')
const TEXT = '协议七提示「七号门〔状态：已锁定〕」，他的维修签收单写「维修中·手动解锁」。'
const base = { reviewed: { artifactId: setting, sha256: sha('d') }, inputRefs: [{ artifactId: brief, sha256: sha('e') }], requiredChecks: ['completeness', 'consistency'] as const,
  evidenceSources: [{ artifactId: setting, text: TEXT }, { artifactId: brief, text: '系统流，硬科幻。' }] }
const settingsReview = { ...base, acceptAdvisoryCompleteness: true }
const evidence = [{ artifactId: setting, quote: '他的维修签收单写「维修中·手动解锁」。' }]

function review(issues: ReviewOutput['issues']): ReviewOutput {
  return { version: 1, reviewed: base.reviewed, inputRefs: base.inputRefs,
    checks: [{ category: 'completeness', summary: '门状态字段写全了。', evidence }, { category: 'consistency', summary: '与简介一致。', evidence }], issues } as ReviewOutput
}
const issue = (category: string, severity: 'advisory' | 'blocking') => ({ id: `${category}-${severity}`, category, severity, location: '§六', message: '说明。', evidence }) as ReviewOutput['issues'][number]
function rejection(run: () => unknown): string {
  try { run() } catch (cause) { expect(cause).toBeInstanceOf(StageValidationRejection); return (cause as Error).message }
  throw new Error('expected a rejection')
}

describe('advisory completeness notes in settings reviews', () => {
  it('keeps the review valid and records the note as advisory', () => {
    const parsed = parseReviewOutput(review([issue('completeness', 'advisory')]), settingsReview)
    expect(parsed.issues).toEqual([expect.objectContaining({ id: 'completeness-advisory', category: 'completeness', severity: 'advisory' })])
    expect(parsed.issues.some(item => item.severity === 'blocking')).toBe(false)
  })

  it('still treats a blocking completeness issue as blocking, alongside an accepted advisory one', () => {
    const parsed = parseReviewOutput(review([issue('completeness', 'advisory'), { ...issue('completeness', 'blocking'), id: 'missing' }]), settingsReview)
    expect(parsed.issues.map(item => [item.id, item.severity])).toEqual([['completeness-advisory', 'advisory'], ['missing', 'blocking']])
  })

  it('still rejects advisory issues in every other non-style category', () => {
    for (const category of ['consistency', 'obligations', 'continuity', 'length'])
      expect(rejection(() => parseReviewOutput(review([issue(category, 'advisory')]), settingsReview))).toMatch(new RegExp(`^${category} issues must be blocking`))
  })

  it('still requires style suggestions to stay advisory', () => {
    expect(rejection(() => parseReviewOutput(review([issue('style', 'blocking')]), settingsReview))).toMatch(/^Style suggestions must remain advisory/)
  })

  it('leaves non-settings reviews unchanged: an advisory completeness note still rejects the review', () => {
    expect(rejection(() => parseReviewOutput(review([issue('completeness', 'advisory')]), base))).toMatch(/^completeness issues must be blocking/)
  })
})
