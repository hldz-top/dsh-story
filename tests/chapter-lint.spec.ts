import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assembleChapter, chapterFromMarkdown, JsonSyntaxError, LintInputError, lintChapter, panelLimits, parseJson, parseLintBody, parseLintOutline, parseTypoTable, requiredLiterals, storedArtifactText, TECH_METAPHOR_TERMS, type LintBody, type LintOutline } from '../src/chapter-lint.ts'

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

  it('reports exactly the two empty 【】 placeholders and no others', () => {
    expect(report.placeholders).toEqual([
      { offset: 2883, percent: 59.5, context: '老化。 他的眼睛还停在【】上。手先动，笔尖落到签名' },
      { offset: 3972, percent: 81.9, context: '开拉链翻到夹层，把那两条【】的安装回执翻出来——其实' },
    ])
    expect(report.findings.filter(finding => finding.code === 'empty-bracket')).toEqual([
      { check: 'placeholders', severity: 'advisory', code: 'empty-bracket', message: '空【】（59.5%）：老化。 他的眼睛还停在【】上。手先动，笔尖落到签名' },
      { check: 'placeholders', severity: 'advisory', code: 'empty-bracket', message: '空【】（81.9%）：开拉链翻到夹层，把那两条【】的安装回执翻出来——其实' },
    ])
    expect(report.panels.count).toBe(13)
    expect(report.findings.filter(finding => finding.severity === 'error').map(finding => finding.code)).toEqual(['panel-over-limit', 'task-panel-digit-missing', 'typo', 'typo'])
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

describe('empty 【】 placeholders (advisory)', () => {
  const empty = (report: ReturnType<typeof lintChapter>) => report.findings.filter(finding => finding.code === 'empty-bracket')

  it('reports a pair at the start, middle and end of a paragraph, including two on one line', () => {
    const text = '【】在段首。\n\n一行里【】有【】两处。\n\n停在段尾【】'
    const report = lintChapter(text)
    expect(report.panels.count).toBe(0)
    expect(report.placeholders).toEqual([
      { offset: 0, percent: 0, context: '【】在段首。 一行里【】有' },
      { offset: 11, percent: 40.7, context: '【】在段首。 一行里【】有【】两处。 停在段尾' },
      { offset: 14, percent: 51.9, context: '在段首。 一行里【】有【】两处。 停在段尾【】' },
      { offset: 25, percent: 92.6, context: '有【】两处。 停在段尾【】' },
    ])
    expect(empty(report).map(finding => [finding.severity, finding.check, finding.code])).toEqual([
      ['advisory', 'placeholders', 'empty-bracket'],
      ['advisory', 'placeholders', 'empty-bracket'],
      ['advisory', 'placeholders', 'empty-bracket'],
      ['advisory', 'placeholders', 'empty-bracket'],
    ])
    expect(empty(report).map(finding => finding.message)).toEqual(report.placeholders.map(item => `空【】（${item.percent}%）：${item.context}`))
    expect(report.findings.every(finding => finding.severity !== 'error')).toBe(true)
  })

  it('ignores filled brackets, half-width brackets and an unmatched 【 or 】', () => {
    const text = '【标题】写好了。半角[]不算。落单的【和】也不算。非空【x】跳过。【 标题 】同样跳过。'
    const report = lintChapter(text)
    expect(report.placeholders).toEqual([])
    expect(empty(report)).toEqual([])
    expect(report.findings).toEqual([])
    expect(report.panels.count).toBe(0)
    expect(lintChapter(v2).placeholders).toEqual([])
    expect(lintChapter(v2).panels.count).toBe(10)
  })

  it('treats whitespace-only interiors as empty, including adjacent pairs and nearby astral text', () => {
    const spaced = lintChapter('前【 】中【　】后')
    expect(spaced.placeholders).toEqual([
      { offset: 1, percent: 11.1, context: '前【 】中【　】后' },
      { offset: 5, percent: 55.6, context: '前【 】中【　】后' },
    ])
    expect(spaced.panels.count).toBe(0)
    for (const sample of ['【\t】', '【\n】', '【 \u3000\t】']) {
      const report = lintChapter(`前${sample}后`)
      expect(report.placeholders, sample).toHaveLength(1)
      expect(report.panels.count, sample).toBe(0)
      expect(report.findings.every(finding => finding.severity === 'advisory'), sample).toBe(true)
    }
    const adjacent = lintChapter('甲【】【】乙')
    expect(adjacent.placeholders.map(item => item.offset)).toEqual([1, 3])
    expect(adjacent.chars).toBe(6)
    const astral = lintChapter('前文😀【】，𠀀【】后')
    expect(astral.chars).toBe(10)
    expect(astral.placeholders.map(item => [item.offset, item.percent])).toEqual([[3, 30], [7, 70]])
    expect(astral.placeholders.every(item => item.context === '前文😀【】，𠀀【】后')).toBe(true)
    expect(astral.findings.every(finding => finding.severity === 'advisory')).toBe(true)
  })

  it('keeps the panel count and does not make the finding blocking', () => {
    const inline = lintChapter('他的眼睛还停在【】上。\n\n【任务完成】\n\n那两条【】的安装回执')
    expect(inline.panels).toMatchObject({ count: 1, lines: [{ text: '【任务完成】' }] })
    expect(inline.placeholders).toHaveLength(2)
    expect(inline.findings.filter(finding => finding.severity === 'error')).toEqual([])
    const line = lintChapter('【】\n\n【任务完成】')
    expect(line.panels.count).toBe(2)
    expect(line.panels.lines.map(item => item.text)).toEqual(['【】', '【任务完成】'])
    expect(line.placeholders).toEqual([{ offset: 0, percent: 0, context: '【】 【任务完成】' }])
    expect(empty(line).map(finding => finding.severity)).toEqual(['advisory'])
    for (const sample of ['【 】', '【　】']) {
      const report = lintChapter(sample)
      expect(report.panels.count, sample).toBe(1)
      expect(report.placeholders, sample).toHaveLength(1)
      expect(report.findings.every(finding => finding.severity === 'advisory'), sample).toBe(true)
    }
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
    expect(lintChapter('他像往常一样检查舱门的气密性。').metaphors).toEqual([])
    expect(lintChapter('这条路的气密性比我的信用评级还差。').metaphors).toHaveLength(1)
    expect(lintChapter('他喘得比服务器宕机时还急。').metaphors.map(item => item.terms)).toEqual([['服务器']])
  })

  it('ignores comparison characters inside ordinary words and literal uses of a term', () => {
    for (const sentence of ['气密性好像有点问题。', '气密性好像纸一样薄。', '那条缝像一台掉线的服务器似的。', '他的耐心如同老旧服务器。', '比如气密性，他每班都查。', '舱门的气密性无比重要。', '他比较了两次信用评级。', '舱门的气密性检测通过了。']) {
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

  it('exits 0 when the only finding is an empty 【】', () => {
    const script = fileURLToPath(new URL('../scripts/chapter-lint.mjs', import.meta.url))
    const scratch = mkdtempSync(join(tmpdir(), 'chapter-lint-empty-'))
    const chapter = join(scratch, 'chapter.md')
    writeFileSync(chapter, '# 标题\n\n他停在【】上。\n')
    const result = spawnSync(process.execPath, [script, chapter, '--json'], { encoding: 'utf8', timeout: 20_000 })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const report = JSON.parse(result.stdout) as ReturnType<typeof lintChapter>
    expect(report.panels.count).toBe(0)
    expect(report.placeholders).toHaveLength(1)
    expect(report.findings.map(finding => [finding.severity, finding.code])).toEqual([['advisory', 'empty-bracket']])
  })
})

describe('chapter-lint CLI input errors (qa-pr12-lint.md G1, G2, Q1, Q2)', () => {
  const script = fileURLToPath(new URL('../scripts/chapter-lint.mjs', import.meta.url))
  const fixture = (name: string) => fileURLToPath(new URL(name, dir))
  const scratch = mkdtempSync(join(tmpdir(), 'chapter-lint-'))
  const file = (name: string, content: string | Uint8Array) => { const path = join(scratch, name); writeFileSync(path, content); return path }
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 20_000 })
  const store = file('store.json', JSON.stringify({ tables: { artifacts: { outline: { text: readFileSync(new URL('ch1-outline.json', dir), 'utf8') } } } }))

  it.each([
    ['{} as the body', [file('empty.json', '{}')]],
    ['the outline as the body', [fixture('ch1-outline.json')]],
    ['the body as the outline', [fixture('ch1-v1-body.json'), '--outline', fixture('ch1-v1-body.json')]],
    ['a bad --anchor regex', [fixture('ch1-v1.md'), '--anchor', '坏=([']],
    ['typos that is not an array', [fixture('ch1-v1.md'), '--typos', file('typos-object.json', '{"a":1}')]],
    ['a --store body id naming an outline', ['--store', store, '--body-id', 'outline']],
    ['a typo with an empty wrong value', [fixture('ch1-v1.md'), '--typos', file('typos-empty.json', '[{"wrong":"","right":"x"}]')]],
    ['a GBK-encoded chapter', [file('gbk.md', Uint8Array.from([0x23, 0x20, 0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x0a]))]],
  ])('exits 2 with one stderr line and no stack for %s', (_name, args) => {
    const result = run(...args)
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^chapter-lint: [^\n]+\n$/)
    expect(result.stderr).not.toMatch(/\bat |node:internal/)
  })

  it('prints usage for --help and -h', () => {
    for (const flag of ['--help', '-h']) {
      const result = run(flag)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Usage:')
    }
  })
})

describe('chapter-lint input validation (qa-postmerge-main.md G2, T2, T3)', () => {
  const inputError = (action: () => unknown) => {
    try { action() } catch (cause) {
      expect(cause).toBeInstanceOf(LintInputError)
      const error = cause as LintInputError
      return `${error.path}: ${error.message}`
    }
    throw new Error('expected a LintInputError')
  }
  const syntaxError = (text: string) => {
    try { parseJson(text) } catch (cause) {
      expect(cause).toBeInstanceOf(JsonSyntaxError)
      const error = cause as JsonSyntaxError
      return `${error.line}:${error.column}: ${error.message}`
    }
    throw new Error('expected a JsonSyntaxError')
  }

  it('locates JSON syntax errors by line and code-point column without engine wording', () => {
    expect(syntaxError('{"scenes":[')).toBe('1:12: unexpected end of input')
    expect(syntaxError('{\n  "scenes": [\n    {"sceneId": "s1", "text": "x",}\n  ]\n}')).toBe('3:35: expected a property name, got "}"')
    expect(syntaxError('{\n  "title": "𠀀𠀀",\n  oops\n}')).toBe('3:3: expected a property name, got "o"')
    expect(syntaxError('{"title": "𠀀𠀀" x}')).toBe('1:16: expected "," or "}", got "x"')
    expect(syntaxError('[1, 2]\n]')).toBe('2:1: unexpected content after the JSON value: "]"')
    expect(syntaxError('{"a": "line\nbreak"}')).toBe('1:12: control character in string')
    expect(syntaxError('{"a": "\\q"}')).toBe('1:8: invalid escape in string')
    expect(syntaxError('{"a": "never closed')).toBe('1:7: unterminated string')
    expect(syntaxError('\ufeff{}')).toBe('1:1: unexpected character U+FEFF')
    expect(syntaxError('[-]')).toBe('1:2: invalid number')
    expect(syntaxError('')).toBe('1:1: unexpected end of input')
    expect(parseJson(' {"a": [1, -2.5e3, true, null, "\\u00e9"]} ')).toEqual({ a: [1, -2500, true, null, 'é'] })
  })

  it('names the exact body field', () => {
    expect(inputError(() => parseLintBody(null))).toBe('$: expected a chapter body object with a "scenes" array, got null')
    expect(inputError(() => parseLintBody([]))).toBe('$: expected a chapter body object with a "scenes" array, got an array')
    expect(inputError(() => parseLintBody({}))).toBe('$.scenes: expected an array of scenes, got missing')
    expect(inputError(() => parseLintBody({ scenes: 'x' }))).toBe('$.scenes: expected an array of scenes, got a string')
    expect(inputError(() => parseLintBody({ scenes: [{ sceneId: 'a', text: 'x' }, 7] }))).toBe('$.scenes[1]: expected a scene object, got a number')
    expect(inputError(() => parseLintBody({ scenes: [{ sceneId: 'a', text: 'x' }, { sceneId: 'b', text: 5 }] }))).toBe('$.scenes[1].text: expected a string, got a number')
    expect(inputError(() => parseLintBody({ scenes: [{ sceneId: 'a' }] }))).toBe('$.scenes[0].text: expected a string, got missing')
    expect(inputError(() => parseLintBody({ scenes: [{ id: 'a', text: 'x' }] }))).toBe('$.scenes[0].sceneId: expected a string, got missing')
    expect(parseLintBody(v1)).toBe(v1)
    expect(parseLintBody(v2)).toBe(v2)
  })

  it('names the exact outline field', () => {
    const valid = structuredClone(outline) as unknown as Record<string, unknown>
    const broken = (patch: (copy: Record<string, any>) => void) => { const copy = structuredClone(valid) as Record<string, any>; patch(copy); return () => parseLintOutline(copy) }
    expect(inputError(() => parseLintOutline(null))).toBe('$: expected a chapter outline object, got null')
    expect(inputError(() => parseLintOutline({}))).toBe('$.constraints: expected an array of strings, got missing')
    expect(inputError(broken(copy => { copy.constraints = 'x' }))).toBe('$.constraints: expected an array of strings, got a string')
    expect(inputError(broken(copy => { copy.constraints[1] = 3 }))).toBe('$.constraints[1]: expected a string, got a number')
    expect(inputError(broken(copy => { copy.throughLine = null }))).toBe('$.throughLine: expected a string, got null')
    expect(inputError(broken(copy => { delete copy.obligations[2].id }))).toBe('$.obligations[2].id: expected a string, got missing')
    expect(inputError(broken(copy => { copy.scenes[3].action = {} }))).toBe('$.scenes[3].action: expected a string, got an object')
    expect(inputError(broken(copy => { copy.scenes[0].purpose = 1 }))).toBe('$.scenes[0].purpose: expected a string, got a number')
    expect(inputError(broken(copy => { copy.scenes[1].obligationIds = [true] }))).toBe('$.scenes[1].obligationIds[0]: expected a string, got a boolean')
    expect(inputError(() => parseLintOutline(v1))).toBe('$.constraints: expected an array of strings, got missing')
    expect(parseLintOutline(outline)).toBe(outline)
  })

  it('names the exact typo entry and requires a string right value', () => {
    expect(inputError(() => parseTypoTable({ a: 1 }))).toBe('$: expected an array of {"wrong", "right"} entries, got an object')
    expect(inputError(() => parseTypoTable(['的']))).toBe('$[0]: expected a {"wrong", "right"} entry, got a string')
    expect(inputError(() => parseTypoTable([{ wrong: 'a', right: 'b' }, { wrong: '', right: 'x' }]))).toBe('$[1].wrong: expected a nonempty string, got an empty string')
    expect(inputError(() => parseTypoTable([{ right: 'x' }]))).toBe('$[0].wrong: expected a nonempty string, got missing')
    expect(inputError(() => parseTypoTable([{ wrong: '的' }]))).toBe('$[0].right: expected a string, got missing')
    expect(inputError(() => parseTypoTable([{ wrong: '的', right: 5 }]))).toBe('$[0].right: expected a string, got a number')
  })

  it('tells a missing artifact from an artifact without text', () => {
    const store = { tables: { artifacts: { 'artifact_ok': { text: '{}' }, 'artifact_notext': { kind: 'body' }, 'odd id': { text: 1 } } } }
    expect(storedArtifactText(store, 'artifact_ok')).toBe('{}')
    expect(inputError(() => storedArtifactText(store, 'artifact_nope'))).toBe('$.tables.artifacts.artifact_nope: artifact not found')
    expect(inputError(() => storedArtifactText(store, 'artifact_notext'))).toBe('$.tables.artifacts.artifact_notext.text: artifact has no text: expected a string, got missing')
    expect(inputError(() => storedArtifactText(store, 'odd id'))).toBe('$.tables.artifacts["odd id"].text: artifact has no text: expected a string, got a number')
    expect(inputError(() => storedArtifactText(store, 'toString'))).toBe('$.tables.artifacts.toString: artifact not found')
    expect(inputError(() => storedArtifactText({ tables: {} }, 'x'))).toBe('$.tables.artifacts: expected an artifacts table, got missing')
    expect(inputError(() => storedArtifactText({}, 'x'))).toBe('$.tables: expected an object of tables, got missing')
  })
})

describe('chapter-lint CLI error lines name the file and field (qa-postmerge-main.md G2, T2, T3)', () => {
  const script = fileURLToPath(new URL('../scripts/chapter-lint.mjs', import.meta.url))
  const fixture = (name: string) => fileURLToPath(new URL(name, dir))
  const scratch = mkdtempSync(join(tmpdir(), 'chapter-lint-g2-'))
  const file = (name: string, content: string) => { writeFileSync(join(scratch, name), content); return name }
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: scratch, encoding: 'utf8', timeout: 20_000 })
  const md = fixture('ch1-v2.md')
  const outlineText = readFileSync(new URL('ch1-outline.json', dir), 'utf8')
  const bodyText = readFileSync(new URL('ch1-v1-body.json', dir), 'utf8')
  file('store.json', JSON.stringify({ tables: { artifacts: {
    artifact_body: { kind: 'body', text: bodyText },
    artifact_outline: { kind: 'chapter-outline', text: outlineText },
    artifact_bad: { kind: 'body', text: '{\n  "scenes": [\n    oops\n  ]\n}' },
    artifact_notext: { kind: 'body' },
    artifact_badscene: { kind: 'body', text: JSON.stringify({ scenes: [{ sceneId: 's1', text: 'x' }, { sceneId: 's2', text: null }] }) },
  } } }))

  it.each([
    ['body {}', [file('missing-body.json', '{}')], 'missing-body.json: $.scenes: expected an array of scenes, got missing'],
    ['body null', [file('null-body.json', 'null')], 'null-body.json: $: expected a chapter body object with a "scenes" array, got null'],
    ['scenes as a string', [file('scenes-string.json', '{"scenes":"x"}')], 'scenes-string.json: $.scenes: expected an array of scenes, got a string'],
    ['a numeric scene text', [file('text-num.json', '{"scenes":[{"sceneId":"a","text":"x"},{"sceneId":"b","text":7}]}')], 'text-num.json: $.scenes[1].text: expected a string, got a number'],
    ['a scene without text', [file('text-missing.json', '{"scenes":[{"sceneId":"a"}]}')], 'text-missing.json: $.scenes[0].text: expected a string, got missing'],
    ['a scene without sceneId', [file('noid.json', '{"scenes":[{"id":"a","text":"x"}]}')], 'noid.json: $.scenes[0].sceneId: expected a string, got missing'],
    ['the outline as the body', [file('outline-as-body.json', outlineText)], 'outline-as-body.json: $.scenes[0].text: expected a string, got missing'],
    ['outline {}', [md, '--outline', file('outline-empty.json', '{}')], 'outline-empty.json: $.constraints: expected an array of strings, got missing'],
    ['outline constraints as a string', [md, '--outline', file('outline-type.json', '{"constraints":"x","obligations":[],"scenes":[]}')], 'outline-type.json: $.constraints: expected an array of strings, got a string'],
    ['a bad outline scene', [md, '--outline', file('outline-scene.json', '{"constraints":[],"obligations":[],"scenes":[{"id":"s","action":"a","obligationIds":[1]}]}')], 'outline-scene.json: $.scenes[0].obligationIds[0]: expected a string, got a number'],
    ['the body as the outline', [md, '--outline', file('body-as-outline.json', bodyText)], 'body-as-outline.json: $.constraints: expected an array of strings, got missing'],
    ['typos as an object', [md, '--typos', file('typ-object.json', '{"a":1}')], 'typ-object.json: $: expected an array of {"wrong", "right"} entries, got an object'],
    ['a typo entry as a string', [md, '--typos', file('typ-string.json', '["的"]')], 'typ-string.json: $[0]: expected a {"wrong", "right"} entry, got a string'],
    ['an empty wrong', [md, '--typos', file('typ-wrong-empty.json', '[{"wrong":"公窄","right":"狭窄"},{"wrong":"","right":"x"}]')], 'typ-wrong-empty.json: $[1].wrong: expected a nonempty string, got an empty string'],
    ['a numeric wrong', [md, '--typos', file('typ-wrong-num.json', '[{"wrong":5,"right":"x"}]')], 'typ-wrong-num.json: $[0].wrong: expected a nonempty string, got a number'],
    ['a missing right', [md, '--typos', file('typ-right-missing.json', '[{"wrong":"的"}]')], 'typ-right-missing.json: $[0].right: expected a string, got missing'],
    ['a numeric right', [md, '--typos', file('typ-right-num.json', '[{"wrong":"的","right":5}]')], 'typ-right-num.json: $[0].right: expected a string, got a number'],
    ['a truncated body', [file('bad-body.json', '{"scenes":[')], 'bad-body.json:1:12: invalid JSON: unexpected end of input'],
    ['a trailing comma in the outline', [md, '--outline', file('bad-outline.json', '{\n  "constraints": [\n    "a",\n  ]\n}')], 'bad-outline.json:4:3: invalid JSON: unexpected character "]"'],
    ['a bad typo table', [md, '--typos', file('bad-typos.json', '[{"wrong": "的" "right": "地"}]')], 'bad-typos.json:1:16: invalid JSON: expected "," or "}", got "\\""'],
    ['a bad store', ['--store', file('bad-store.json', '{"tables":\n'), '--body-id', 'x'], 'bad-store.json:2:1: invalid JSON: unexpected end of input'],
    ['a store without artifacts', ['--store', file('store-noart.json', '{"tables":{}}'), '--body-id', 'x'], 'store-noart.json: $.tables.artifacts: expected an artifacts table, got missing'],
    ['an unknown artifact', ['--store', 'store.json', '--body-id', 'artifact_nope'], 'store.json: $.tables.artifacts.artifact_nope: artifact not found'],
    ['an artifact without text', ['--store', 'store.json', '--body-id', 'artifact_notext'], 'store.json: $.tables.artifacts.artifact_notext.text: artifact has no text: expected a string, got missing'],
    ['artifact text that is not JSON', ['--store', 'store.json', '--body-id', 'artifact_bad'], 'store.json: artifact artifact_bad: 3:5: invalid JSON: unexpected character "o"'],
    ['a bad scene in a stored body', ['--store', 'store.json', '--body-id', 'artifact_badscene'], 'store.json: artifact artifact_badscene: $.scenes[1].text: expected a string, got null'],
    ['a body id naming an outline', ['--store', 'store.json', '--body-id', 'artifact_outline'], 'store.json: artifact artifact_outline: $.scenes[0].text: expected a string, got missing'],
    ['an outline id naming a body', ['--store', 'store.json', '--body-id', 'artifact_body', '--outline-id', 'artifact_body'], 'store.json: artifact artifact_body: $.constraints: expected an array of strings, got missing'],
    ['a bad --anchor regex', [md, '--anchor', '坏=(['], '--anchor 坏: invalid regular expression "(["'],
  ])('reports %s on one line with its location', (_name, args, expected) => {
    const result = run(...args)
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(`chapter-lint: ${expected}\n`)
    expect(result.stderr).not.toMatch(/invalid input|Cannot read|is not iterable|is not a function|\bat |node:internal/)
  })

  it('reports an unexpected lint failure as one internal-error line without the engine message', () => {
    // Every known bad input is rejected before lintChapter; force a failure inside it to exercise the fallback.
    const hook = `data:text/javascript,${encodeURIComponent("String.prototype.matchAll = function () { throw new TypeError('Cannot read properties of undefined (reading \\'leak\\')') }")}`
    const result = spawnSync(process.execPath, ['--import', hook, script, md], { cwd: scratch, encoding: 'utf8', timeout: 20_000 })
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('chapter-lint: internal error (TypeError); please report the command and input\n')
  })

  it('still reports a valid stored body with its outline', () => {
    const result = run('--store', 'store.json', '--body-id', 'artifact_body', '--outline-id', 'artifact_outline', '--json')
    expect(result.status).toBe(0)
    expect((JSON.parse(result.stdout) as ReturnType<typeof lintChapter>).chars).toBe(4849)
  })
})
