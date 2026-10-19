/** AI-tone markers adapted from lieflat-less-ai-tone (MIT, third_party/lieflat-less-ai-tone.LICENSE). */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectAiTone, narrationOf } from '../src/ai-tone.ts'

const rules = (text: string) => Object.fromEntries(detectAiTone(text).markers.map(marker => [marker.rule, marker.count]))

describe('detectAiTone', () => {
  it.each([
    ['reversal', '真正的壁垒不是技术，而是认知。'],
    ['enumeration', '他检查了阀门、管线、仪表，然后坐下。'],
    ['dash', '答案其实很简单——专注。'],
    ['cue-colon', '一句话总结：这个方案成本太高。'],
    ['opener', '说白了，这个项目没有预算。'],
    ['nominalization', '团队完成了对流程的优化。'],
    ['long-attributive', '这是一个能够让团队在不增加人力的情况下显著提升审核速度的工具。'],
    ['when-clause', '当所有人都能写文章时，内容就不值钱了。'],
    ['topic-shell', '对于早期团队来说，招人最难。'],
    ['connective', '他关上门。然而，压力还在掉。'],
    ['restatement', '读数停了。这意味着漏点堵住了。'],
  ])('finds the %s marker', (rule, text) => {
    expect(rules(text)[rule]).toBe(1)
  })

  it('finds a zero-subject comment opening a later paragraph, not one with an anaphor', () => {
    expect(rules('门关上了，他坐下来喘气。\n更重要的是，阀门还没换。')['zero-subject-comment']).toBe(1)
    expect(rules('门关上了，他坐下来喘气。\n这一点更重要的是，阀门还没换。')['zero-subject-comment']).toBeUndefined()
    expect(rules('更重要的是，阀门还没换，第一段不算。')['zero-subject-comment']).toBeUndefined()
  })

  it('ignores dialogue, quotations and panel lines', () => {
    const text = '他说：「不是我，而是它——说白了，这意味着完了。」\n【任务已发布：然而，时间、地点、人物都有】\n“当你看见时，就跑。”'
    expect(detectAiTone(text).markers).toEqual([])
    expect(narrationOf(text)).not.toContain('说白了')
  })

  it('leaves the patterns the skill keeps for humans alone', () => {
    expect(detectAiTone('他为什么不报？门像一张嘴。被认为最稳的阀门也漏了。他慢慢地、一点一点地拧。').markers.filter(marker => marker.rule !== 'enumeration')).toEqual([])
  })

  it('quotes each example as an exact substring of the chapter and normalises by narration Han characters', () => {
    const text = '他看了一眼——表在掉。\n「说白了吧。」\n他又看了一眼——还在掉。'
    const report = detectAiTone(text)
    const dash = report.markers.find(marker => marker.rule === 'dash')
    expect(dash?.count).toBe(2)
    for (const example of dash?.examples ?? []) expect(text).toContain(example)
    expect(report.narrationHan).toBe(17)
    expect(dash?.perThousandHan).toBe(117.6)
  })

  it('reports the ch1 v1 dash habit and keeps the v2 draft nearly clean', () => {
    const body = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/ai-tone/${name}`, import.meta.url), 'utf8')) as { scenes: { text: string }[] }
    const chapter = (name: string) => body(name).scenes.map(scene => scene.text).join('\n\n')
    expect(rules(chapter('ch1-v1-body.json'))).toEqual({ enumeration: 4, dash: 14, 'cue-colon': 2 })
    expect(rules(chapter('ch1-v2-body.json'))).toEqual({ enumeration: 2, 'cue-colon': 1 })
  })
})
