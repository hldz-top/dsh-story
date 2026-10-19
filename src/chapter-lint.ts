/**
 * Offline, report-only chapter lint: deterministic checks that need no model call.
 * Not wired into the writing pipeline; scripts/chapter-lint.mjs runs it over stored or exported drafts.
 *
 * Position metric: the chapter text is the stored scenes' `text` joined with "\n\n" (no title, exactly what
 * the exported .md carries after its "# title\n\n" line). One character is one Unicode code point; punctuation,
 * whitespace and newlines all count. percent = start offset (0-based code points) / total code points × 100,
 * rounded to one decimal.
 */

/** The parts of a stored body artifact the lint reads. */
export interface LintBody { readonly scenes: readonly { readonly sceneId: string; readonly text: string }[] }
/** The parts of a stored chapter-outline artifact the lint reads. */
export interface LintOutline {
  readonly throughLine?: string
  readonly constraints: readonly string[]
  readonly obligations: readonly { readonly id: string; readonly description: string }[]
  readonly scenes: readonly { readonly id: string; readonly purpose?: string; readonly action: string; readonly obligationIds: readonly string[] }[]
}
/** A known misspelling; matched as an exact substring. */
export interface TypoRule { readonly wrong: string; readonly right: string }
/** A named passage whose first occurrence is reported as a position. */
export interface LintAnchor { readonly label: string; readonly pattern: string }
export interface LintOptions { readonly outline?: LintOutline; readonly typos?: readonly TypoRule[]; readonly anchors?: readonly LintAnchor[]; readonly metaphorTerms?: readonly string[] }

export type LintSeverity = 'error' | 'info' | 'advisory'
export interface LintFinding { readonly check: 'panels' | 'literals' | 'positions' | 'typos' | 'metaphors'; readonly severity: LintSeverity; readonly code: string; readonly message: string }
export interface PanelLine { readonly index: number; readonly offset: number; readonly percent: number; readonly text: string }
export interface Located { readonly offset: number; readonly percent: number; readonly context: string }

export interface ChapterLintReport {
  readonly chars: number
  readonly panels: { readonly count: number; readonly nominal: number | null; readonly max: number | null; readonly lines: readonly PanelLine[]; readonly duplicates: readonly (readonly number[])[] }
  readonly literals: { readonly required: readonly { readonly literal: string; readonly occurrences: readonly Located[] }[]; readonly taskPanelDigit: boolean | null }
  readonly positions: {
    readonly scenes: readonly { readonly sceneId: string; readonly offset: number; readonly percent: number }[]
    readonly obligations: readonly { readonly id: string; readonly sceneId: string; readonly percent: number | null }[]
    readonly anchors: readonly { readonly label: string; readonly match: (Located & { readonly text: string }) | null }[]
  }
  readonly typos: readonly (TypoRule & Located)[]
  readonly metaphors: readonly (Located & { readonly sentence: string; readonly terms: readonly string[] })[]
  readonly findings: readonly LintFinding[]
}

/** Unambiguous misspellings seen in reviewed drafts. Wrong-sense words (「三画」「白露」) are deliberately absent: they are real words. */
export const DEFAULT_TYPOS: readonly TypoRule[] = [
  { wrong: '公窄', right: '狭窄' },
  { wrong: '从头上到尾', right: '从头到尾' },
  { wrong: '猪一行', right: '第二行' },
  { wrong: '掉水', right: '掉压' },
]

const PANEL_LINE = /^【[^\n]*】$/gmu
/** Numbers that only describe the plan (lengths, beat/panel counts, ratios), never prose facts. */
const META_UNIT = /^\s*(?:[–\-~～/]\s*\d|字|拍|条|次|%|％|章|段|步|个|句|处|成|倍|分之)/u
const LITERAL = /(?<![\p{L}\p{N}_.:：–\-~～/])([A-Z]?\d+(?::\d{2})?)(?![\p{L}\p{N}_:：])/gu
const META_PREFIX = new Set(['第', '–', '-', '~', '～', '/'])
/**
 * Technology and finance terms that turn a 「比」 comparison into a technical metaphor, as in the banned example
 * 「这条路的气密性比我的信用评级还差」. Seeded from qa-ch1-v2-style.md §六.2 (气密性、信用评级、带宽、内存、算力、协议栈)
 * plus close finance/IT neighbours. Ordinary words of this genre (压力、协议、气密胶、读数) are deliberately absent;
 * a term only counts inside a sentence that also contains a comparison construction ({@link COMPARISON}).
 */
export const TECH_METAPHOR_TERMS: readonly string[] = ['气密性', '信用评级', '信用', '评级', '带宽', '内存', '算力', '协议栈', '利率', '贷款', '房贷', '股价', '汇率', 'KPI', '服务器', '网速', '硬盘', '缓存', 'CPU', '帧率', '分辨率', '版本号']
/**
 * The one comparison construction counted: 「X比Y还/更/都…」 within 16 characters. Excluded on purpose: 比如、比较、比方、
 * 比例、比赛、比分、比重、比率、对比、无比 (no comparison). 像/如同/仿佛-style metaphors are deliberately left to the review
 * prompts: 「像往常一样」 and 「好像」 make them too noisy for a lint. Known limits: comparisons spanning more than 16 characters
 * are not matched; a listed term elsewhere in a matched sentence still counts, so literal comparisons (「这扇门的气密性比上一扇还好」)
 * are reported too, which is why the finding is advisory.
 */
const COMPARISON = /(?<![无对])比(?![如较方例赛分重率])[^，,。！？!?\n]{1,16}?[还更都]/u
const CONTEXT = 12

/** @returns The chapter text exactly as reviewers and the exported .md see it. */
export function assembleChapter(body: LintBody): string { return body.scenes.map(scene => scene.text).join('\n\n') }

/** @param markdown - An exported chapter: "# title\n\n" + chapter text + "\n". @returns The chapter text without the title line. */
export function chapterFromMarkdown(markdown: string): string {
  const text = markdown.replace(/\r\n/gu, '\n')
  const body = /^# [^\n]*\n\n/u.test(text) ? text.replace(/^# [^\n]*\n\n/u, '') : text
  return body.endsWith('\n') ? body.slice(0, -1) : body
}

/** Offset arithmetic in code points. */
class Points {
  private readonly starts: number[] = []
  private readonly chars: string[]
  readonly length: number
  constructor(text: string) {
    this.chars = [...text]
    let index = 0
    for (const point of this.chars) { this.starts.push(index); index += point.length }
    this.length = this.chars.length
  }
  /** @param offset - A code-point offset. @returns Its string index. */
  utf16(offset: number): number { return offset >= this.length ? this.starts.length === 0 ? 0 : this.starts.at(-1)! + this.chars.at(-1)!.length : this.starts[offset]! }
  /** @param utf16 - A string index. @returns Its code-point offset. */
  offset(utf16: number): number {
    let low = 0, high = this.starts.length
    while (low < high) { const mid = (low + high) >> 1; if (this.starts[mid]! < utf16) low = mid + 1; else high = mid }
    return low
  }
  percent(offset: number): number { return this.length === 0 ? 0 : Math.round(offset / this.length * 1000) / 10 }
  locate(utf16: number, matched: number): Located {
    const offset = this.offset(utf16)
    const context = this.chars.slice(Math.max(0, offset - CONTEXT), offset + matched + CONTEXT).join('')
    return { offset, percent: this.percent(offset), context: context.replace(/\n+/gu, ' ') }
  }
}

function outlineText(outline: LintOutline): string[] {
  return [outline.throughLine ?? '', ...outline.constraints, ...outline.obligations.map(item => item.description), ...outline.scenes.flatMap(scene => [scene.purpose ?? '', scene.action])]
}

/** @returns The nominal and hard 【】 caps the outline states, e.g. 「全章 9 条（可增至 10 条…）」 or 「全章约 9–10 条【】」. */
export function panelLimits(outline: LintOutline | undefined): { nominal: number | null; max: number | null } {
  if (outline === undefined) return { nominal: null, max: null }
  let nominal: number | null = null
  let max: number | null = null
  for (const text of outlineText(outline)) {
    if (!text.includes('【】')) continue
    const fixed = /全章\s*(\d+)\s*条/u.exec(text)
    if (fixed !== null) nominal ??= Number(fixed[1])
    const raise = /可增至\s*(\d+)\s*条/u.exec(text)
    if (raise !== null) max = Math.max(max ?? 0, Number(raise[1]))
    const range = /全章约?\s*(\d+)\s*[–\-~～]\s*(\d+)\s*条/u.exec(text)
    if (range !== null) { nominal ??= Number(range[1]); max = Math.max(max ?? 0, Number(range[2])) }
  }
  return { nominal, max: max ?? nominal }
}

/** @returns Arabic-numeral facts the outline asks the prose to carry (times, codes such as B3, amounts), excluding plan metadata. */
export function requiredLiterals(outline: LintOutline): string[] {
  const found = new Set<string>()
  for (const text of outlineText(outline)) {
    for (const match of text.matchAll(LITERAL)) {
      const start = match.index
      if (META_PREFIX.has(text.slice(0, start).trimEnd().slice(-1))) continue
      if (META_UNIT.test(text.slice(start + match[1]!.length))) continue
      found.add(match[1]!)
    }
  }
  return [...found]
}

/** @returns Whether a scene plans a 【任务已发布】 panel whose pacing must be given as a number. */
function requiresTaskDigit(outline: LintOutline): boolean {
  return outline.scenes.some(scene => scene.action.includes('任务已发布') && /一个数字/u.test(scene.action))
}

/**
 * @param chapter - Chapter text (see {@link assembleChapter}) or a stored body for scene positions.
 * @param options - Outline for caps, literals and obligation positions; typo table; named anchors.
 * @returns A report; nothing is rejected or rewritten.
 */
export function lintChapter(chapter: string | LintBody, options: LintOptions = {}): ChapterLintReport {
  const text = typeof chapter === 'string' ? chapter : assembleChapter(chapter)
  const points = new Points(text)
  const findings: LintFinding[] = []
  const { outline } = options
  for (const typo of options.typos ?? []) {
    if (typeof typo?.wrong !== 'string' || typo.wrong.length === 0) throw new Error('every typo entry needs a nonempty "wrong" string')
    if (typeof typo.right !== 'string') throw new Error('every typo entry needs a "right" string')
  }

  const lines: PanelLine[] = [...text.matchAll(PANEL_LINE)].map((match, index) => {
    const offset = points.offset(match.index)
    return { index: index + 1, offset, percent: points.percent(offset), text: match[0] }
  })
  const groups = new Map<string, number[]>()
  for (const line of lines) groups.set(line.text, [...(groups.get(line.text) ?? []), line.index])
  const duplicates = [...groups.values()].filter(group => group.length > 1)
  const { nominal, max } = panelLimits(outline)
  if (max !== null && lines.length > max) findings.push({ check: 'panels', severity: 'error', code: 'panel-over-limit', message: `【】独立行 ${lines.length} 条，超过细纲上限 ${max} 条（多 ${lines.length - max} 条）` })
  else if (nominal !== null && lines.length > nominal) findings.push({ check: 'panels', severity: 'info', code: 'panel-over-nominal', message: `【】独立行 ${lines.length} 条，多于名义值 ${nominal} 条，未超上限 ${max}` })
  for (const group of duplicates) findings.push({ check: 'panels', severity: 'info', code: 'panel-duplicate', message: `【】第 ${group.join('、')} 条全文相同：${lines[group[0]! - 1]!.text}` })

  const required = outline === undefined ? [] : requiredLiterals(outline).map(literal => ({ literal, occurrences: occurrences(text, literal, points) }))
  for (const item of required) if (item.occurrences.length === 0) findings.push({ check: 'literals', severity: 'error', code: 'literal-missing', message: `细纲要求的数字字面量「${item.literal}」未出现在正文` })
  let taskPanelDigit: boolean | null = null
  if (outline !== undefined && requiresTaskDigit(outline)) {
    const first = lines.findIndex(line => line.text.includes('任务已发布'))
    if (first < 0) taskPanelDigit = false
    else {
      const group = [lines[first]!]
      for (let index = first + 1; index < lines.length; index++) {
        const previous = group.at(-1)!
        if (text.slice(points.utf16(previous.offset) + previous.text.length, points.utf16(lines[index]!.offset)).trim() !== '') break
        group.push(lines[index]!)
      }
      // A location code such as B3 names a place, not the pacing number the outline asks for.
      taskPanelDigit = group.some(line => /(?<![A-Za-z\d])\d/u.test(line.text))
    }
    if (!taskPanelDigit) findings.push({ check: 'literals', severity: 'error', code: 'task-panel-digit-missing', message: '细纲要求【任务已发布】用一个数字写明节奏，任务面板（含紧随的面板行）没有阿拉伯数字' })
  }

  const scenes: { sceneId: string; offset: number; percent: number }[] = []
  if (typeof chapter !== 'string') {
    let offset = 0
    for (const scene of chapter.scenes) {
      scenes.push({ sceneId: scene.sceneId, offset, percent: points.percent(offset) })
      offset += [...scene.text].length + 2
    }
  }
  const obligations = outline === undefined ? [] : outline.scenes.flatMap(scene => scene.obligationIds.map(id => ({ id, sceneId: scene.id, percent: scenes.find(item => item.sceneId === scene.id)?.percent ?? null })))
  const anchors = (options.anchors ?? []).map(anchor => {
    const match = new RegExp(anchor.pattern, 'u').exec(text)
    return { label: anchor.label, match: match === null ? null : { ...points.locate(match.index, [...match[0]].length), text: match[0] } }
  })

  const typos = (options.typos ?? DEFAULT_TYPOS).flatMap(rule => occurrences(text, rule.wrong, points).map(found => ({ ...rule, ...found })))
  for (const typo of typos) findings.push({ check: 'typos', severity: 'error', code: 'typo', message: `错字「${typo.wrong}」→「${typo.right}」（${typo.percent}%）：${typo.context}` })

  const terms = options.metaphorTerms ?? TECH_METAPHOR_TERMS
  const metaphors: (Located & { sentence: string; terms: string[] })[] = []
  for (const match of text.matchAll(/[^。！？!?\n]+/gu)) {
    const sentence = match[0]
    if (!COMPARISON.test(sentence)) continue
    const hits = terms.filter(term => sentence.includes(term))
    if (hits.length > 0) metaphors.push({ ...points.locate(match.index, [...sentence].length), sentence: sentence.trim(), terms: hits })
  }
  for (const metaphor of metaphors) findings.push({ check: 'metaphors', severity: 'advisory', code: 'tech-metaphor', message: `技术比喻（${metaphor.terms.join('、')}，${metaphor.percent}%）：${metaphor.sentence}` })

  return { chars: points.length, panels: { count: lines.length, nominal, max, lines, duplicates }, literals: { required, taskPanelDigit }, positions: { scenes, obligations, anchors }, typos, metaphors, findings }
}

function occurrences(text: string, needle: string, points: Points): Located[] {
  if (needle.length === 0) throw new Error('cannot search for an empty string')
  const found: Located[] = []
  for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + needle.length)) found.push(points.locate(index, [...needle].length))
  return found
}

/**
 * Input the lint cannot interpret. `path` locates the offending field in JSONPath style: `$` is the document root,
 * e.g. `$.scenes[2].text` or `$[0].right`.
 */
export class LintInputError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(message)
    this.name = 'LintInputError'
    this.path = path
  }
}

/** A JSON syntax error at a 1-based line and column; columns count code points. */
export class JsonSyntaxError extends Error {
  readonly line: number
  readonly column: number
  constructor(line: number, column: number, message: string) {
    super(message)
    this.name = 'JsonSyntaxError'
    this.line = line
    this.column = column
  }
}

/** @returns The parsed value. @throws {@link JsonSyntaxError} with the position of the first syntax error. */
export function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown } catch { throw locateJsonError(text) }
}

class SyntaxAt {
  readonly offset: number
  readonly message: string
  constructor(offset: number, message: string) { this.offset = offset; this.message = message }
}

/** Re-scans text that JSON.parse rejected, so the reported position and reason do not depend on the engine's wording. */
function locateJsonError(text: string): JsonSyntaxError {
  let index = 0
  const fail = (message: string, at = index): never => {
    throw new SyntaxAt(at, at >= text.length ? 'unexpected end of input' : message)
  }
  const unexpected = (): never => fail(`unexpected character ${describeAt(text, index)}`)
  const space = () => { while (index < text.length && ' \t\n\r'.includes(text[index]!)) index++ }
  const string = () => {
    const start = index++
    while (index < text.length) {
      const char = text[index]!
      if (char === '"') { index++; return }
      if (char === '\\') {
        const escape = text[index + 1]
        if (escape !== undefined && '"\\/bfnrt'.includes(escape)) index += 2
        else if (escape === 'u' && /^[\dA-Fa-f]{4}$/u.test(text.slice(index + 2, index + 6))) index += 6
        else fail('invalid escape in string')
      } else if (char < ' ') fail('control character in string')
      else index++
    }
    fail('unterminated string', start)
  }
  const value = (): void => {
    space()
    const char = text[index]
    if (char === '{') {
      index++
      space()
      if (text[index] === '}') { index++; return }
      for (;;) {
        space()
        if (text[index] !== '"') fail(`expected a property name, got ${describeAt(text, index)}`)
        string()
        space()
        if (text[index] !== ':') fail(`expected ":", got ${describeAt(text, index)}`)
        index++
        value()
        space()
        if (text[index] === ',') { index++; continue }
        if (text[index] === '}') { index++; return }
        fail(`expected "," or "}", got ${describeAt(text, index)}`)
      }
    }
    if (char === '[') {
      index++
      space()
      if (text[index] === ']') { index++; return }
      for (;;) {
        value()
        space()
        if (text[index] === ',') { index++; continue }
        if (text[index] === ']') { index++; return }
        fail(`expected "," or "]", got ${describeAt(text, index)}`)
      }
    }
    if (char === '"') return string()
    if (char === '-' || (char !== undefined && char >= '0' && char <= '9')) {
      const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/uy
      number.lastIndex = index
      if (!number.test(text)) fail('invalid number')
      index = number.lastIndex
      return
    }
    for (const literal of ['true', 'false', 'null']) if (text.startsWith(literal, index)) { index += literal.length; return }
    unexpected()
  }
  try {
    value()
    space()
    if (index < text.length) fail(`unexpected content after the JSON value: ${describeAt(text, index)}`)
    return position(text, 0, 'invalid JSON')
  } catch (cause) {
    if (cause instanceof SyntaxAt) return position(text, cause.offset, cause.message)
    throw cause
  }
}

function describeCharacter(point: number): string {
  return point < 0x20 || point === 0x7f || point === 0xfeff ? `U+${point.toString(16).toUpperCase().padStart(4, '0')}` : JSON.stringify(String.fromCodePoint(point))
}
function describeAt(text: string, index: number): string {
  return index >= text.length ? 'end of input' : describeCharacter(text.codePointAt(index)!)
}
function position(text: string, offset: number, message: string): JsonSyntaxError {
  const before = text.slice(0, offset)
  const lineStart = before.lastIndexOf('\n') + 1
  return new JsonSyntaxError(before.split('\n').length, Array.from(before.slice(lineStart)).length + 1, message)
}

type Fields = Record<string, unknown>
function kind(value: unknown): string {
  if (value === undefined) return 'missing'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'string') return value.length === 0 ? 'an empty string' : 'a string'
  if (typeof value === 'object') return 'an object'
  return `a ${typeof value}`
}
/** @returns `path` extended by one property, bracket-quoted when it is not an identifier. */
export function fieldPath(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`
  return /^[A-Za-z_$][\w$]*$/u.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}
function record(value: unknown, path: string, expected: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new LintInputError(path, `expected ${expected}, got ${kind(value)}`)
  return value as Fields
}
function list(value: unknown, path: string, expected: string): unknown[] {
  if (!Array.isArray(value)) throw new LintInputError(path, `expected ${expected}, got ${kind(value)}`)
  return value
}
function text(value: unknown, path: string, nonempty = false): void {
  if (typeof value !== 'string' || (nonempty && value.length === 0)) throw new LintInputError(path, `expected a ${nonempty ? 'nonempty ' : ''}string, got ${kind(value)}`)
}
function strings(value: unknown, path: string): void {
  list(value, path, 'an array of strings').forEach((item, index) => text(item, fieldPath(path, index)))
}

/** @returns `value` as a stored body. @throws {@link LintInputError} at the first field the lint cannot read. */
export function parseLintBody(value: unknown): LintBody {
  const body = record(value, '$', 'a chapter body object with a "scenes" array')
  list(body['scenes'], '$.scenes', 'an array of scenes').forEach((item, index) => {
    const path = fieldPath('$.scenes', index)
    const scene = record(item, path, 'a scene object')
    text(scene['text'], fieldPath(path, 'text'))
    text(scene['sceneId'], fieldPath(path, 'sceneId'))
  })
  return value as LintBody
}

/** @returns `value` as a stored chapter outline. @throws {@link LintInputError} at the first field the lint cannot read. */
export function parseLintOutline(value: unknown): LintOutline {
  const outline = record(value, '$', 'a chapter outline object')
  if (outline['throughLine'] !== undefined) text(outline['throughLine'], '$.throughLine')
  strings(outline['constraints'], '$.constraints')
  list(outline['obligations'], '$.obligations', 'an array of obligations').forEach((item, index) => {
    const path = fieldPath('$.obligations', index)
    const obligation = record(item, path, 'an obligation object')
    text(obligation['id'], fieldPath(path, 'id'))
    text(obligation['description'], fieldPath(path, 'description'))
  })
  list(outline['scenes'], '$.scenes', 'an array of scenes').forEach((item, index) => {
    const path = fieldPath('$.scenes', index)
    const scene = record(item, path, 'a scene object')
    text(scene['id'], fieldPath(path, 'id'))
    if (scene['purpose'] !== undefined) text(scene['purpose'], fieldPath(path, 'purpose'))
    text(scene['action'], fieldPath(path, 'action'))
    strings(scene['obligationIds'], fieldPath(path, 'obligationIds'))
  })
  return value as LintOutline
}

/** @returns `value` as a typo table. @throws {@link LintInputError} at the first entry the lint cannot use. */
export function parseTypoTable(value: unknown): TypoRule[] {
  list(value, '$', 'an array of {"wrong", "right"} entries').forEach((item, index) => {
    const path = fieldPath('$', index)
    const entry = record(item, path, 'a {"wrong", "right"} entry')
    text(entry['wrong'], fieldPath(path, 'wrong'), true)
    text(entry['right'], fieldPath(path, 'right'))
  })
  return value as TypoRule[]
}

/**
 * @param store - A parsed `story_writing.json` storage file.
 * @param id - An artifact id.
 * @returns The artifact's stored text.
 * @throws {@link LintInputError} when the artifacts table, the artifact or its text is absent.
 */
export function storedArtifactText(store: unknown, id: string): string {
  const tables = record(record(store, '$', 'a storage object')['tables'], '$.tables', 'an object of tables')
  const artifacts = record(tables['artifacts'], '$.tables.artifacts', 'an artifacts table')
  const path = fieldPath('$.tables.artifacts', id)
  if (!Object.hasOwn(artifacts, id)) throw new LintInputError(path, 'artifact not found')
  const artifact = record(artifacts[id], path, 'an artifact object')
  const stored = artifact['text']
  if (typeof stored !== 'string') throw new LintInputError(fieldPath(path, 'text'), `artifact has no text: expected a string, got ${kind(stored)}`)
  return stored
}
