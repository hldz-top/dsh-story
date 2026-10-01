import { describe, expect, it } from 'vitest'
import { assembleBody, countStoryWords, inspectBody } from '../src/body-text.ts'
import { artifactIdSchema } from '../src/contracts.ts'
import type { BodyOutput } from '../src/stage-output.ts'

function body(...texts: string[]): BodyOutput {
  return {
    version: 1, inputRefs: [{ artifactId: artifactIdSchema.parse('artifact_11111111-1111-4111-8111-111111111111'), sha256: 'a'.repeat(64) }],
    chapterNumber: 1, scenes: texts.map((text, index) => ({ sceneId: `scene-${index + 1}`, text })),
  }
}

describe('Story body text', () => {
  it('counts CJK characters and ASCII words with internal apostrophes and hyphens', () => {
    expect(countStoryWords("中文，hello world! A12 can't O’Neil well-known 2026-09-11。终")).toBe(10)
    expect(countStoryWords("'word' ’word’ -word- a--b a—b a_b 3.14")).toBe(11)
    expect(countStoryWords('\u3400\u4dbf\u4e00\u9fff\u33ff\u4dc0\ua000\u{20000}😀')).toBe(4)
    expect(countStoryWords('a中b2文3')).toBe(5)
    expect(countStoryWords(' \n\t，。！？…😀')).toBe(0)
    expect(countStoryWords('')).toBe(0)
  })

  it('joins scene text in order without trimming, adding titles, or normalizing line endings', () => {
    const output = body('  First scene.\r\n', '\n第二幕。  ')
    expect(assembleBody(output)).toBe('  First scene.\r\n\n\n\n第二幕。  ')
    expect(assembleBody(body('One scene.'))).toBe('One scene.')
    expect(output.scenes.map(scene => scene.text)).toEqual(['  First scene.\r\n', '\n第二幕。  '])
  })

  it.each([
    [2999, 'too-short', true], [3000, 'within-range', false], [5000, 'within-range', false], [5001, 'too-long', true],
  ])('reports the exact %i-word chapter without truncating it', (words, status, blocking) => {
    const text = '文'.repeat(words)
    expect(inspectBody(body(text), { minChapterWords: 3000, maxChapterWords: 5000 })).toEqual({
      text, wordCount: words, length: { status, blocking },
    })
  })

  it('measures assembled chapters with caller-supplied bounds and no per-scene ceiling', () => {
    const first = '文'.repeat(4999)
    expect(inspectBody(body(first, 'word'), { minChapterWords: 3000, maxChapterWords: 5000 })).toEqual({
      text: `${first}\n\nword`, wordCount: 5000, length: { status: 'within-range', blocking: false },
    })
    expect(inspectBody(body('a', 'b'), { minChapterWords: 2, maxChapterWords: 2 })).toEqual({
      text: 'a\n\nb', wordCount: 2, length: { status: 'within-range', blocking: false },
    })
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid configured limits (%s) before reporting chapter acceptance', value => {
      expect(() => inspectBody(body('word'), { minChapterWords: value, maxChapterWords: 5000 })).toThrow(RangeError)
      expect(() => inspectBody(body('word'), { minChapterWords: 1, maxChapterWords: value })).toThrow(RangeError)
    },
  )

  it('rejects reversed inclusive bounds', () => {
    expect(() => inspectBody(body('word'), { minChapterWords: 5000, maxChapterWords: 3000 })).toThrow(RangeError)
  })
})
