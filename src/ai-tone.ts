/**
 * Host-side AI-tone markers for chapter narration, adapted from lieflat-less-ai-tone
 * (https://github.com/larashero3-dotcom/lieflat-less-ai-tone, commit 27d2923, MIT License, Copyright (c) 2026 shiujan;
 * full notice in third_party/lieflat-less-ai-tone.LICENSE). The patterns follow the skill's locatable trigger markers
 * (SKILL.md rules 1, 2, 4, 8/9, 10 and 11; regexes after scripts/compare-human-ai.py and scripts/check-structure.py).
 *
 * Only narration is scanned: 「」 and “” dialogue and standalone 【】 panel lines are removed first, because the skill
 * leaves dialogue, quotations and genre formatting alone. Rules the skill exempts for fiction are not ported: adjacent
 * sentence isomorphism (3), numbered headings (6) and idealised-persona metaphors (7). Rule 5 (提示性冒号) is not ported either:
 * in fiction it mostly hit in-story form fields such as report lines. Counts are evidence for an advisory
 * style review, never a gate; this module computes no chapter positions.
 */

export type AiToneRule = 'reversal' | 'enumeration' | 'dash' | 'opener' | 'nominalization' | 'long-attributive' | 'when-clause' | 'topic-shell' | 'connective' | 'restatement' | 'zero-subject-comment'
export interface AiToneMarker { readonly rule: AiToneRule; readonly skillRule: string; readonly count: number; readonly perThousandHan: number; readonly examples: readonly string[] }
export interface AiToneReport { readonly source: 'lieflat-less-ai-tone@27d2923 (MIT)'; readonly narrationHan: number; readonly markers: readonly AiToneMarker[] }

const SPAN = '[^，。！？；\\n]'
const patterns: readonly { readonly rule: Exclude<AiToneRule, 'zero-subject-comment'>; readonly skillRule: string; readonly pattern: RegExp }[] = [
  { rule: 'reversal', skillRule: '1 翻案腔', pattern: new RegExp(`(?:不是|并非|不在于)${SPAN}{1,20}，?(?:而是|而在于)|与其说[^。！？\\n]{1,20}不如说|看似[^。！？\\n]{1,20}实则|你以为[^。！？\\n]{1,20}其实|说到底|回头才发现|答案恰恰相反`, 'gu') },
  { rule: 'enumeration', skillRule: '2 顿号罗列过密', pattern: /[^，。！？；：、\n]{1,14}、[^，。！？；：、\n]{1,14}、[^，。！？；：、\n]{1,14}/gu },
  { rule: 'dash', skillRule: '4 破折号', pattern: /——/gu },
  { rule: 'opener', skillRule: '9 禁用起手式', pattern: /说白了|说穿了|先说结论/gu },
  { rule: 'nominalization', skillRule: '8 名词化概括', pattern: /(?:完成|实现|进行|开展)了?(?:对)?[^，。\n]{0,10}的(?:优化|提升|调整|分析|改造|升级)/gu },
  { rule: 'long-attributive', skillRule: '10 过长前置定语', pattern: /(?:一个|一种|一套|这种|这个)[^，。、；：！？\n]{15,}的[\u4e00-\u9fff]{2,5}/gu },
  { rule: 'when-clause', skillRule: '10 当…时', pattern: /当[^，。\n]{2,20}(?<!的时候)时，/gu },
  { rule: 'topic-shell', skillRule: '10 前置话题壳', pattern: /对于[^，。\n]{2,15}来说|对[^，。\n]{2,15}而言|就[^，。\n]{2,15}而言|在[^，。\n]{2,12}方面/gu },
  { rule: 'connective', skillRule: '10 句首连接词', pattern: /(?:^|(?<=[。！？\n]))(?:然而|因此|此外|与此同时|换言之|总而言之)[，、]/gmu },
  { rule: 'restatement', skillRule: '10 这意味着式复述', pattern: /这意味着|这表明|这说明|换句话说/gu },
]
const COMMENT = /^(?:听起来|看起来|看上去|听上去|说白了|说到底|换句话说|意味着|值得注意|不难看出|问题在于|原因在于|有意思的是|更重要的是|关键在于|真正的)/u
const ANAPHOR = /(?:这|那|其|此|上面|前面|刚才|以上|该|它|他|她)/u
const DIALOGUE = /「[^」]*」|“[^”]*”|^【[^\n]*】$/gmu
const HAN = /\p{Script=Han}/gu
const MAX_EXAMPLES = 3
const CONTEXT = 8

/** @param text - Assembled chapter text. @returns The text with dialogue and panel lines replaced by line breaks, so no match spans them. */
export function narrationOf(text: string): string { return text.replace(DIALOGUE, '\n') }

/** @returns The match widened by up to {@link CONTEXT} UTF-16 units on each side, never past a line break, so it stays an exact substring of the chapter. */
function excerpt(narration: string, index: number, length: number): string {
  const lineStart = narration.lastIndexOf('\n', index - 1) + 1
  const lineEnd = narration.indexOf('\n', index + length)
  return narration.slice(Math.max(lineStart, index - CONTEXT), Math.min(lineEnd < 0 ? narration.length : lineEnd, index + length + CONTEXT))
}

/** @param text - Assembled chapter text. @returns Marker counts per thousand narration Han characters, with exact excerpts. */
export function detectAiTone(text: string): AiToneReport {
  const narration = narrationOf(text)
  const narrationHan = narration.match(HAN)?.length ?? 0
  const markers: AiToneMarker[] = []
  const add = (rule: AiToneRule, skillRule: string, found: readonly string[]) => {
    if (found.length > 0) markers.push({ rule, skillRule, count: found.length, perThousandHan: narrationHan === 0 ? 0 : Math.round(found.length / narrationHan * 10_000) / 10, examples: found.slice(0, MAX_EXAMPLES) })
  }
  for (const { rule, skillRule, pattern } of patterns) add(rule, skillRule, [...narration.matchAll(pattern)].map(match => excerpt(narration, match.index, match[0].length)))
  const paragraphs = text.split('\n').map(line => line.trim()).filter(line => line.length >= 8 && !/^[「“【]/u.test(line))
  add('zero-subject-comment', '11 段首零主语评论', paragraphs.slice(1).filter(paragraph => COMMENT.test(paragraph) && !ANAPHOR.test(paragraph.split(/[，。！？]/u)[0] ?? '')).map(paragraph => paragraph.split(/[，。！？]/u)[0] ?? paragraph))
  return { source: 'lieflat-less-ai-tone@27d2923 (MIT)', narrationHan, markers }
}
