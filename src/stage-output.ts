/** Model-output admission for versioned novel-writing stages. */
import { z } from 'zod'
import { artifactIdSchema, type ArtifactId } from './contracts.ts'
import type { SettingsDimensionKind } from './settings-catalog.ts'

/** A catalog classification dimension records a label and its grounds, not world-building detail. The single source for this set; stage-prompts.ts imports it rather than declaring its own copy. */
export const ENUM_SETTINGS_KINDS: ReadonlySet<SettingsDimensionKind> = new Set(['enum_single', 'enum_multi'])
/** Maximum facts a classification (enum) settings dimension may declare; llm_free dimensions are unbounded. */
export const MAX_ENUM_SETTINGS_FACTS = 10
/** Maximum Unicode code points of contentMarkdown for a classification (enum) settings dimension. */
export const MAX_ENUM_SETTINGS_CONTENT_CHARS = 2500

/** A generated value violates the requested stage's mechanical requirements. */
export class StageOutputError extends Error {
  /** @param message - The concrete requirement a repaired output must satisfy. */
  constructor(message: string) { super(message); this.name = 'StageOutputError' }
}

const text = z.string().min(1).refine(value => value.trim().length > 0, 'Text must not be blank')
const inputRefSchema = z.strictObject({ artifactId: artifactIdSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) })
const inputsSchema = z.strictObject({ version: z.literal(1), inputRefs: z.array(inputRefSchema).nonempty() })
const factSchema = z.strictObject({ id: text, statement: text })
const settingsSchema = inputsSchema.extend({
  dimensionCode: z.string().regex(/^[a-z][a-z0-9]*$/), facts: z.array(factSchema).nonempty(), contentMarkdown: text,
})
const citationSchema = z.strictObject({ artifactId: artifactIdSchema, quote: text })
const reviewCategorySchema = z.enum(['completeness', 'consistency', 'obligations', 'continuity', 'length', 'style'])
const reviewSchema = inputsSchema.extend({
  reviewed: inputRefSchema,
  checks: z.array(z.strictObject({ category: reviewCategorySchema, summary: text, evidence: z.array(citationSchema).nonempty() })).nonempty(),
  issues: z.array(z.strictObject({
    id: text, severity: z.enum(['blocking', 'advisory']).describe('Style issues must be advisory; every other category must be blocking.'), category: reviewCategorySchema,
    location: text, message: text, evidence: z.array(citationSchema).nonempty(),
  })),
})
const obligationSchema = z.strictObject({ id: text, description: text })
const bookOutlineSchema = inputsSchema.extend({
  contentMarkdown: text, ending: text,
  characterArcs: z.array(z.strictObject({ character: text, development: text })).nonempty(),
  chapters: z.array(z.strictObject({
    chapterNumber: z.number().int().positive(), title: text, purpose: text, targetWords: z.number().int().positive(),
    obligations: z.array(obligationSchema),
  })).nonempty(),
})
const chapterOutlineSchema = inputsSchema.extend({
  chapterNumber: z.number().int().positive(), title: text, targetWords: z.number().int().positive(), throughLine: text,
  constraints: z.array(text), obligations: z.array(obligationSchema),
  scenes: z.array(z.strictObject({ id: text, purpose: text, action: text, obligationIds: z.array(text) })).nonempty(),
})
const bodySchema = inputsSchema.extend({
  chapterNumber: z.number().int().positive(), scenes: z.array(z.strictObject({ sceneId: text, text })).nonempty(),
})
const continuitySchema = inputsSchema.extend({
  chapterNumber: z.number().int().positive(), summary: text,
  characters: z.array(z.strictObject({ name: text, state: text })),
  timeline: z.array(z.strictObject({ event: text, evidence: z.array(citationSchema).nonempty() })),
  obligations: z.array(z.strictObject({
    id: text, status: z.enum(['open', 'fulfilled']), explanation: text, evidence: z.array(citationSchema),
  })),
})

/** Exact immutable source identity declared by a stage output. */
export type StageInputRef = z.infer<typeof inputRefSchema>
/** Generated candidate for one selected settings dimension; application is host-owned. */
export type SettingsDimensionOutput = z.infer<typeof settingsSchema>
/** Substantive review categories; the host specifies those required for the stage. */
export type ReviewCategory = z.infer<typeof reviewCategorySchema>
/** Review findings tied to an exact candidate and quoted source versions. */
export type ReviewOutput = z.infer<typeof reviewSchema>
/** Ordered book structure, character development, ending, and chapter obligations. */
export type BookOutlineOutput = z.infer<typeof bookOutlineSchema>
/** Ordered chapter scenes and the required obligations they execute. */
export type ChapterOutlineOutput = z.infer<typeof chapterOutlineSchema>
/** Reader-facing scene text; assembly and chapter-total counting belong to the host. */
export type BodyOutput = z.infer<typeof bodySchema>
/** Proposed actual continuity; fulfilled obligations cite the reviewed body. */
export type ContinuityOutput = z.infer<typeof continuitySchema>
/** An exact excerpt cited by a model output. */
export type EvidenceCitation = z.infer<typeof citationSchema>
/** Host-verified text available for exact quotation checks. */
export interface EvidenceSource { readonly artifactId: ArtifactId; readonly text: string }

/** Model response schemas; use z.toJSONSchema(schema, { io: 'input' }) for the branded identifier parsers. */
export const StageOutputSchemas = {
  settings: settingsSchema, review: reviewSchema, 'book-outline': bookOutlineSchema, 'chapter-outline': chapterOutlineSchema,
  body: bodySchema, continuity: continuitySchema,
} as const

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new StageOutputError(`Duplicate ${label}`)
}

function matchingInputs(actual: readonly StageInputRef[], expected: readonly StageInputRef[]): void {
  unique(actual.map(ref => ref.artifactId), 'input artifact')
  unique(expected.map(ref => ref.artifactId), 'expected input artifact')
  if (actual.length !== expected.length || actual.some(ref => !expected.some(input => input.artifactId === ref.artifactId && input.sha256 === ref.sha256))) {
    throw new StageOutputError('Stage input references do not match the requested versions')
  }
}

function matchingObligations(actual: readonly string[], expected: readonly string[]): void {
  unique(actual, 'obligation ID')
  unique(expected, 'expected obligation ID')
  if (actual.length !== expected.length || actual.some(id => !expected.includes(id))) throw new StageOutputError('Stage obligations do not match the requested obligations')
}

/** Code points of a rejected quote echoed back in the repair message. */
const QUOTE_ECHO_CHARS = 120
/** Separates decoded JSON string values so a normalized quote cannot silently span two fields. */
const FIELD_BREAK = '\u0000'

/**
 * Comparison key for quotation membership. It discards only representation differences a faithful copy can introduce:
 * Unicode compatibility forms (full-width/half-width, NFKC), whitespace and line breaks, typographic versus straight
 * quote marks, and Markdown emphasis/code markers. Wording, order and all other punctuation stay exact, so an added,
 * dropped or reworded character still fails.
 */
export function evidenceQuoteKey(value: string): string {
  return value.normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/gu, '"')
    .replace(/[*`]/gu, '')
    .replace(/\s+/gu, '')
}

function jsonStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') into.push(value)
  else if (Array.isArray(value)) for (const item of value) jsonStrings(item, into)
  else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) jsonStrings(item, into)
}

/** Stored structured artifacts are JSON, which the model reads with escaped line breaks and quote marks; also match against their decoded string values. */
function sourceKeys(text: string): readonly string[] {
  const keys = [evidenceQuoteKey(text)]
  if (/^\s*[[{]/u.test(text)) {
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { return keys }
    const strings: string[] = []
    jsonStrings(parsed, strings)
    if (strings.length > 0) keys.push(strings.map(evidenceQuoteKey).join(FIELD_BREAK))
  }
  return keys
}

/** @param quote - Model-cited excerpt. @param text - Host-verified source text. @returns Whether the excerpt occurs in the source up to representation-only differences. */
export function evidenceQuoteOccurs(quote: string, text: string): boolean {
  if (text.includes(quote)) return true
  const key = evidenceQuoteKey(quote)
  return key.length > 0 && sourceKeys(text).some(source => source.includes(key))
}

function quoteEcho(quote: string): string {
  const chars = [...quote]
  return JSON.stringify(chars.length <= QUOTE_ECHO_CHARS ? quote : `${chars.slice(0, QUOTE_ECHO_CHARS).join('')}…`)
}

function checkEvidence(citations: readonly EvidenceCitation[], sources: readonly EvidenceSource[], admitted: readonly ArtifactId[]): void {
  for (const citation of citations) {
    if (!admitted.includes(citation.artifactId)) throw new StageOutputError('Evidence names an artifact outside the stage inputs')
    const source = sources.find(item => item.artifactId === citation.artifactId)
    if (source === undefined || !evidenceQuoteOccurs(citation.quote, source.text)) {
      throw new StageOutputError(`Evidence quote does not occur in its declared source ${citation.artifactId}: ${quoteEcho(citation.quote)}. `
        + 'Copy each quote character for character as one contiguous excerpt of that artifact; do not add lead-in words, paraphrase, or join separate passages.')
    }
  }
}

/** @param value - Model JSON value. @param expected - Requested dimension and exact upstream versions. @returns A detached validated settings candidate; structural only — a persisted or replayed candidate must always still parse. */
export function parseSettingsDimensionOutput(value: unknown, expected: { dimensionCode: string; inputRefs: readonly StageInputRef[] }): SettingsDimensionOutput {
  const output = settingsSchema.parse(value)
  matchingInputs(output.inputRefs, expected.inputRefs)
  if (output.dimensionCode !== expected.dimensionCode) throw new StageOutputError('Settings dimension differs from the requested dimension')
  unique(output.facts.map(fact => fact.id), 'settings fact ID')
  return output
}

/**
 * Scope check for a freshly admitted classification (enum) settings candidate; llm_free is unbounded.
 * Callers apply this only when admitting a new model output, never on readback or idempotent replay,
 * so a candidate accepted by an earlier version of this bound remains durably readable.
 * @param output - Already structurally validated settings output. @param kind - The dimension's catalog kind.
 */
export function checkSettingsDimensionScope(output: SettingsDimensionOutput, kind: SettingsDimensionKind): void {
  if (!ENUM_SETTINGS_KINDS.has(kind)) return
  if (output.facts.length > MAX_ENUM_SETTINGS_FACTS) {
    throw new StageOutputError(`A classification dimension allows at most ${MAX_ENUM_SETTINGS_FACTS} facts; this candidate has ${output.facts.length}`)
  }
  const contentChars = [...output.contentMarkdown].length
  if (contentChars > MAX_ENUM_SETTINGS_CONTENT_CHARS) {
    throw new StageOutputError(`A classification dimension allows at most ${MAX_ENUM_SETTINGS_CONTENT_CHARS} characters of contentMarkdown; this candidate has ${contentChars}`)
  }
}

/** @param value - Model review JSON. @param expected - Exact target, required checks, and host-verified sources. @returns A review with cited evidence; adoption remains host-owned. */
export function parseReviewOutput(value: unknown, expected: {
  reviewed: StageInputRef; inputRefs: readonly StageInputRef[]; requiredChecks: readonly ReviewCategory[]; evidenceSources: readonly EvidenceSource[]
}): ReviewOutput {
  const output = reviewSchema.parse(value)
  matchingInputs(output.inputRefs, expected.inputRefs)
  if (output.reviewed.artifactId !== expected.reviewed.artifactId || output.reviewed.sha256 !== expected.reviewed.sha256) {
    throw new StageOutputError('Reviewed artifact differs from the requested candidate version')
  }
  unique(output.checks.map(check => check.category), 'review check category')
  unique(output.issues.map(issue => issue.id), 'review issue ID')
  unique(expected.evidenceSources.map(source => source.artifactId), 'evidence source')
  if (expected.requiredChecks.some(category => !output.checks.some(check => check.category === category))) throw new StageOutputError('Review is missing a required check')
  const admitted = [output.reviewed.artifactId, ...output.inputRefs.map(ref => ref.artifactId)]
  for (const check of output.checks) checkEvidence(check.evidence, expected.evidenceSources, admitted)
  for (const issue of output.issues) {
    if (issue.category === 'style' && issue.severity !== 'advisory') throw new StageOutputError('Style suggestions must remain advisory')
    if (issue.category !== 'style' && issue.severity !== 'blocking') throw new StageOutputError(`${issue.category} issues must be blocking`)
    checkEvidence(issue.evidence, expected.evidenceSources, admitted)
  }
  return output
}

/** @param value - Model book outline JSON. @param expected - Exact inputs and requested total chapter count. @returns A complete ordered book plan with unique obligation IDs. */
export function parseBookOutlineOutput(value: unknown, expected: { inputRefs: readonly StageInputRef[]; chapterCount: number }): BookOutlineOutput {
  const output = bookOutlineSchema.parse(value)
  matchingInputs(output.inputRefs, expected.inputRefs)
  if (output.chapters.length !== expected.chapterCount || output.chapters.some((chapter, index) => chapter.chapterNumber !== index + 1)) {
    throw new StageOutputError('Book chapters must cover the requested count in order from chapter 1')
  }
  unique(output.chapters.flatMap(chapter => chapter.obligations.map(obligation => obligation.id)), 'book obligation ID')
  unique(output.characterArcs.map(arc => arc.character), 'character arc')
  return output
}

/** @param value - Model chapter outline JSON. @param expected - Exact inputs, chapter number, and required obligations. @returns A chapter plan covering each obligation through ordered scenes. */
export function parseChapterOutlineOutput(value: unknown, expected: {
  inputRefs: readonly StageInputRef[]; chapterNumber: number; obligationIds: readonly string[]
}): ChapterOutlineOutput {
  const output = chapterOutlineSchema.parse(value)
  matchingInputs(output.inputRefs, expected.inputRefs)
  if (output.chapterNumber !== expected.chapterNumber) throw new StageOutputError('Chapter outline does not match the requested chapter')
  matchingObligations(output.obligations.map(obligation => obligation.id), expected.obligationIds)
  unique(output.scenes.map(scene => scene.id), 'scene ID')
  const covered = new Set<string>()
  for (const scene of output.scenes) {
    unique(scene.obligationIds, 'scene obligation ID')
    for (const id of scene.obligationIds) {
      if (!expected.obligationIds.includes(id)) throw new StageOutputError('Scene names an unknown obligation')
      covered.add(id)
    }
  }
  if (expected.obligationIds.some(id => !covered.has(id))) throw new StageOutputError('A required obligation has no assigned scene')
  return output
}

/** @param value - Model body JSON. @param expected - Exact inputs, chapter number, and ordered scene IDs. @returns Complete ordered scene text, including candidates that require length repair. */
export function parseBodyOutput(value: unknown, expected: {
  inputRefs: readonly StageInputRef[]; chapterNumber: number; sceneIds: readonly string[]
}): BodyOutput {
  const output = bodySchema.parse(value)
  matchingInputs(output.inputRefs, expected.inputRefs)
  if (output.chapterNumber !== expected.chapterNumber) throw new StageOutputError('Body does not match the requested chapter')
  unique(output.scenes.map(scene => scene.sceneId), 'body scene ID')
  unique(expected.sceneIds, 'expected scene ID')
  if (output.scenes.length !== expected.sceneIds.length || output.scenes.some((scene, index) => scene.sceneId !== expected.sceneIds[index])) {
    throw new StageOutputError('Body must contain every planned scene in the requested order')
  }
  return output
}

/** @param value - Model continuity JSON. @param expected - Exact inputs, chapter, obligations, and actual reviewed-body source. @returns Proposed continuity with verified quotations; semantic review and application remain host-owned. */
export function parseContinuityOutput(value: unknown, expected: {
  inputRefs: readonly StageInputRef[]; chapterNumber: number; obligationIds: readonly string[];
  evidenceSources: readonly EvidenceSource[]; reviewedBodyId: ArtifactId
}): ContinuityOutput {
  const output = continuitySchema.parse(value)
  matchingInputs(output.inputRefs, expected.inputRefs)
  if (output.chapterNumber !== expected.chapterNumber) throw new StageOutputError('Continuity does not match the requested chapter')
  matchingObligations(output.obligations.map(obligation => obligation.id), expected.obligationIds)
  unique(output.characters.map(character => character.name), 'continuity character')
  unique(expected.evidenceSources.map(source => source.artifactId), 'evidence source')
  const admitted = output.inputRefs.map(ref => ref.artifactId)
  if (!admitted.includes(expected.reviewedBodyId) || !expected.evidenceSources.some(source => source.artifactId === expected.reviewedBodyId)) {
    throw new StageOutputError('Reviewed body must be a declared input with source text')
  }
  for (const event of output.timeline) checkEvidence(event.evidence, expected.evidenceSources, admitted)
  for (const obligation of output.obligations) {
    if (obligation.status === 'fulfilled' && !obligation.evidence.some(citation => citation.artifactId === expected.reviewedBodyId)) {
      throw new StageOutputError('A fulfilled obligation requires evidence from the actual reviewed body')
    }
    checkEvidence(obligation.evidence, expected.evidenceSources, admitted)
  }
  return output
}
