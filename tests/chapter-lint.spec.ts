import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assembleChapter, chapterFromMarkdown, lintChapter, panelLimits, requiredLiterals, TECH_METAPHOR_TERMS, type LintBody, type LintOutline } from '../src/chapter-lint.ts'

// Acceptance spec: /workspace/dsh-story-notes/p1-lint-expectations.md (QA Lead, 2026-10-19 18:09 Asia/Taipei).
// Fixtures are the stored artifact texts of 第七号协议 ch1: v1 artifact_230c4d0c (sha256 c755b9a5…), v2 artifact_82f3048a
// (d11bbf53…), chapter outline artifact_e34c6398, plus the exported .md drafts.
const dir = new URL('./fixtures/chapter-lint/', import.meta.url)
const json = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as T
const outline = json<LintOutline>('ch1-outline.json')
const v1 = json<LintBody>('ch1-v1-body.json')
const v2 = json<LintBody>('ch1-v2-body.json')
const anchors = [
  { label: '任务完成', pattern: '【任务完成' },
  { label: '签字请求', pattern: '签这个|照章签个字' },
  { label: '天花板句', pattern: '两边必有一边' },
]
const codes = (report: ReturnType<typeof lintChapter>) => report.findings.map(finding => finding.code)
const near = (actual: number | undefined, expected: number) => expect(Math.abs((actual ?? Number.NaN) - expected)).toBeLessThanOrEqual(0.5)

describe('position metric', () => {
  it('measures the exported .md chapter text exactly as the stored scenes joined with blank lines', () => {
    for (const [body, file] of [[v1, 'ch1-v1.md'], [v2, 'ch1-v2.md']] as const) {
      expect(chapterFromMarkdown(readFileSync(new URL(file, dir), 'utf8'))).toBe(assembleChapter(body))
    }
    expect(lintChapter(v1).chars).toBe(4849)
    expect(lintChapter(v2).chars).toBe(4939)
  })

  it('counts code points, so astral characters move offsets by one', () => {
    const report = lintChapter('𠀀𠀀\n【一】')
    expect(report.chars).toBe(6)
    expect(report.panels.lines[0]).toMatchObject({ offset: 3, percent: 50 })
  })
})

describe('v1 draft (artifact_230c4d0c)', () => {
  const report = lintChapter(v1, { outline, anchors })

  it('flags 13 standalone 【】 lines over the outline cap of 10 and ignores the two inline 【】', () => {
    expect(report.panels).toMatchObject({ count: 13, nominal: 9, max: 10, duplicates: [] })
    expect(report.panels.lines.map(line => line.offset)).toEqual([905, 1167, 1226, 1248, 1265, 1810, 1849, 2420, 2437, 2478, 3202, 3233, 3999])
    expect(report.findings.find(finding => finding.code === 'panel-over-limit')?.message).toContain('多 3 条')
  })

  it('reports only the missing task-panel pacing number', () => {
    expect(report.literals.taskPanelDigit).toBe(false)
    expect(report.findings.filter(finding => finding.check === 'literals').map(finding => finding.code)).toEqual(['task-panel-digit-missing'])
  })

  it('places 任务完成 at 49.9% and the signing request at 58.3%, with scene starts as stored', () => {
    near(report.positions.anchors[0]!.match?.percent, 49.9)
    near(report.positions.anchors[1]!.match?.percent, 58.3)
    near(report.positions.anchors[2]!.match?.percent, 92.0)
    expect(report.positions.scenes.map(scene => scene.offset)).toEqual([0, 408, 905, 1419, 2420, 3020, 3662, 4626])
    expect(report.positions.scenes[0]!.sceneId).toBe('ch1-s1-cold-open')
  })

  it('finds 猪一行 and 掉水 and nothing else from the base table', () => {
    expect(report.typos.map(typo => [typo.wrong, typo.offset])).toEqual([['猪一行', 2953], ['掉水', 3778]])
  })
})

describe('v2 draft (artifact_82f3048a)', () => {
  const report = lintChapter(v2, { outline, anchors })

  it('accepts 10 lines at the cap, notes the nominal 9 and reports the duplicated 【记录】 pair', () => {
    expect(report.panels).toMatchObject({ count: 10, nominal: 9, max: 10, duplicates: [[9, 10]] })
    expect(codes(report)).not.toContain('panel-over-limit')
    expect(report.findings.filter(finding => finding.check === 'panels').map(finding => [finding.severity, finding.code])).toEqual([['info', 'panel-over-nominal'], ['info', 'panel-duplicate']])
  })

  it('misses no outline literal and finds the task-panel number', () => {
    expect(report.literals.taskPanelDigit).toBe(true)
    expect(report.literals.required.map(item => [item.literal, item.occurrences.length])).toEqual([['B3', 7], ['A4', 4], ['15:57', 2], ['16:02', 2], ['100', 1]])
    expect(report.findings.filter(finding => finding.check === 'literals')).toEqual([])
  })

  it('places 任务完成 at 59.3% and 照章签个字 at 66.1%, both inside the 70% line', () => {
    near(report.positions.anchors[0]!.match?.percent, 59.3)
    near(report.positions.anchors[1]!.match?.percent, 66.1)
    expect(report.positions.anchors[1]!.match?.text).toBe('照章签个字')
    expect(report.positions.scenes.map(scene => scene.offset)).toEqual([0, 332, 958, 1412, 1742, 2920, 3400, 3908])
    expect(report.positions.obligations.find(item => item.id === 'ch1-o10-brief-on-desk')).toMatchObject({ sceneId: 'ch1-s6-settlement-and-signature', percent: 59.1 })
  })

  it('finds 公窄 and 从头上到尾, but not wrong-sense real words like 白露', () => {
    expect(report.typos.map(typo => [typo.wrong, typo.offset])).toEqual([['公窄', 1929], ['从头上到尾', 923]])
    expect(assembleChapter(v2)).toContain('白露')
  })
})

describe('no false positives', () => {
  it('extracts only fact literals from the outline, never plan metadata', () => {
    expect(requiredLiterals(outline).sort()).toEqual(['100', '15:57', '16:02', 'A4', 'B3'])
    expect(panelLimits(outline)).toEqual({ nominal: 9, max: 10 })
  })

  it('keeps 掉压, 从头…, 一行, 两指宽 and Chinese numerals clean', () => {
    const clean = '舱段在掉压。他从头量到底，又从头看到尾。第一行写着名字，缝只有两指宽。十六点零二，他记得。'
    expect(lintChapter(clean, { outline }).findings.filter(finding => finding.check !== 'literals')).toEqual([])
    for (const body of [v1, v2]) {
      const report = lintChapter(body)
      expect(report.typos.some(typo => typo.wrong === '掉水' && typo.context.includes('掉压'))).toBe(false)
      expect(report.metaphors).toEqual([])
    }
  })

  it('does not count inline 【】 as panel lines', () => {
    expect(lintChapter('他的眼睛还停在【】上。\n\n【任务完成】').panels.count).toBe(1)
  })

  it('reports nothing for a chapter without outline, typos or metaphors', () => {
    expect(lintChapter('他把扳手放回工具包。门框是凉的。').findings).toEqual([])
  })
})

describe('technical metaphors (advisory)', () => {
  it('flags the banned example sentence by its term list', () => {
    const report = lintChapter('「这条路的气密性比我的信用评级还差。」他抬头看了一眼。')
    expect(report.metaphors.map(item => [item.sentence, item.terms])).toEqual([['「这条路的气密性比我的信用评级还差', ['气密性', '信用评级', '信用', '评级']]])
    expect(report.findings.map(finding => [finding.severity, finding.code])).toEqual([['advisory', 'tech-metaphor']])
  })

  it('reports 0 for both drafts, including every 气密胶 tool mention', () => {
    for (const [body, count] of [[v1, 1], [v2, 2]] as const) {
      expect(assembleChapter(body).split('气密胶').length - 1).toBe(count)
      expect(lintChapter(body).metaphors).toEqual([])
    }
  })

  it('needs a comparison marker as well as a term', () => {
    expect(lintChapter('他把应急锁环、气密胶、对接环密封件一件件码进工具包。带宽不够。').metaphors).toEqual([])
    expect(lintChapter('他像往常一样拧开气密胶。').metaphors).toEqual([])
    expect(TECH_METAPHOR_TERMS).not.toContain('气密')
    expect(lintChapter('那条缝像一台掉线的服务器似的。').metaphors.map(item => item.terms)).toEqual([['服务器']])
    expect(lintChapter('他喘得比服务器宕机时还急。').metaphors.map(item => item.terms)).toEqual([['服务器']])
  })

  it('ignores comparison characters inside ordinary words and literal uses of a term', () => {
    for (const sentence of ['气密性好像有点问题。', '比如气密性，他每班都查。', '舱门的气密性无比重要。', '他比较了两次信用评级。', '舱门的气密性检测通过了。']) {
      expect(lintChapter(sentence).metaphors, sentence).toEqual([])
    }
  })

  it('leaves ordinary comparisons and genre words alone', () => {
    const clean = '他签过的责任单比他修过的门还多。压力比刚才低了一格。气密胶比平时稠。他不确定这东西要不要付利息。比如这道缝。'
    expect(lintChapter(clean).metaphors).toEqual([])
  })
})

describe('scripts/chapter-lint.mjs', () => {
  it('reports an exported draft offline and exits 0 even with findings', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const output = execFileSync(process.execPath, ['scripts/chapter-lint.mjs', 'tests/fixtures/chapter-lint/ch1-v2.md', '--outline', 'tests/fixtures/chapter-lint/ch1-outline.json', '--json'], { cwd: root, encoding: 'utf8' })
    const report = JSON.parse(output) as ReturnType<typeof lintChapter>
    expect(report.panels.duplicates).toEqual([[9, 10]])
    expect(report.typos.map(typo => typo.wrong)).toEqual(['公窄', '从头上到尾'])
  })
})
