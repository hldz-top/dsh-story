/** Deterministic chapter assembly and Story-compatible word counting. */
import type { BodyOutput } from './stage-output.ts'

/** Inclusive chapter-total bounds supplied by the host configuration. */
export interface BodyWordBounds { readonly minChapterWords: number; readonly maxChapterWords: number }
/** Program-owned chapter length finding; a violation blocks application. */
export type BodyLengthResult = { readonly status: 'within-range'; readonly blocking: false }
  | { readonly status: 'too-short' | 'too-long'; readonly blocking: true }
/** Exact assembled text and its deterministic length finding. */
export interface BodyInspection { readonly text: string; readonly wordCount: number; readonly length: BodyLengthResult }

/** @param output - Validated scenes in chapter order. @returns Exact scene text separated by two line feeds. */
export function assembleBody(output: BodyOutput): string {
  return output.scenes.map(scene => scene.text).join('\n\n')
}

/** @param text - Reader-facing chapter prose. @returns The Story word count. */
export function countStoryWords(text: string): number {
  let count = 0
  for (const _match of text.matchAll(/[\u3400-\u4dbf\u4e00-\u9fff]|[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)) count += 1
  return count
}

/** @param output - Validated scene text in planned order. @param bounds - Positive safe integer inclusive chapter bounds; invalid or reversed limits throw RangeError. @returns Unmodified prose, measured words, and a blocking finding when outside the range. */
export function inspectBody(output: BodyOutput, bounds: BodyWordBounds): BodyInspection {
  for (const name of ['minChapterWords', 'maxChapterWords'] as const) {
    if (!Number.isSafeInteger(bounds[name]) || bounds[name] <= 0) throw new RangeError(`${name} must be a positive safe integer`)
  }
  if (bounds.minChapterWords > bounds.maxChapterWords) throw new RangeError('minChapterWords must not exceed maxChapterWords')
  const text = assembleBody(output)
  const wordCount = countStoryWords(text)
  const length: BodyLengthResult = wordCount < bounds.minChapterWords
    ? { status: 'too-short', blocking: true }
    : wordCount > bounds.maxChapterWords
      ? { status: 'too-long', blocking: true }
      : { status: 'within-range', blocking: false }
  return { text, wordCount, length }
}
