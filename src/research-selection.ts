/** Literal evidence selection from complete persisted native web results. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { WritingError, type ResearchFinding, type ResearchLimits, type ResearchObservation, type ResearchOutcome, type ResearchQuestion } from './contracts.ts'

/** Complete recorded text stays internal to host collection and literal page selection. */
export interface NativeResearchSource {
  readonly sourceIndex: number
  readonly url: string
  readonly title: string | null
  readonly content: string
  readonly sha256: string
  readonly totalChars: number
  readonly bodyStart: number
  readonly bodyEnd: number
  readonly httpStatus: number | null
  readonly nativeTruncated: boolean
}
/** Native receipt identity and its complete recorded source text. */
export type NativeResearchObservation = Omit<ResearchObservation, 'sources'> & { readonly sources: readonly NativeResearchSource[] }
/** Source status describes evidence eligibility, not transport completion. */
export type ResearchSourceEligibility = 'usable' | 'http-error' | 'empty' | 'suspect-encoding'
/** Content-free source record presented before any page reads. */
export type IndexedResearchSource = Omit<NativeResearchSource, 'content'> & { readonly eligibility: ResearchSourceEligibility }
/** Content-free index retains failed calls and rejected references. */
export type IndexedResearchObservation = Omit<NativeResearchObservation, 'sources'> & { readonly sources: readonly IndexedResearchSource[] }
/** Exact Unicode range selected from one observed native source. */
export interface ResearchSelection { readonly callId: ToolCallId; readonly sourceIndex: number; readonly offset: number; readonly limit: number }
/** Each conclusion cites exact source ranges in addition to the observed call identities. */
export type ResearchSelectedFinding = ResearchFinding & { readonly selections: readonly ResearchSelection[] }
/** A literal selected page; limit is the actual retained character count. */
export interface ResearchExcerpt { readonly offset: number; readonly limit: number; readonly text: string }
/** Saved source metadata and independently selected literal excerpts. */
export type SelectedResearchSource = IndexedResearchSource & { readonly retention: 'selected' | 'unselected'; readonly excerpts: readonly ResearchExcerpt[] }
/** Version-3 observations retain source indices even when no text is selected. */
export type SelectedResearchObservation = Omit<IndexedResearchObservation, 'sources'> & { readonly sources: readonly SelectedResearchSource[] }
/** Literal readback with exact provenance and Unicode cursor values. */
export type ResearchSourcePage = IndexedResearchSource & { readonly callId: ToolCallId; readonly offset: number; readonly nextOffset: number; readonly eof: boolean; readonly text: string }

const nonblank = z.string().refine(value => value.trim().length > 0 && value.isWellFormed())
const callIdSchema = nonblank.transform(brandString<ToolCallId>)
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const httpUrl = z.url().refine(value => /^https?:\/\//.test(value))
/** Strict selected-range JSON received from model tools. */
export const researchSelectionSchema = z.strictObject({ callId: callIdSchema, sourceIndex: integer, offset: integer, limit: integer.positive() }) satisfies z.ZodType<ResearchSelection>
/** Strict modern finding input; selected ranges are explicit even when empty. */
export const selectedFindingSchema = z.strictObject({
  questionId: nonblank.max(256), callIds: z.array(callIdSchema), conclusion: nonblank, adequate: z.boolean(), selections: z.array(researchSelectionSchema),
}) satisfies z.ZodType<ResearchSelectedFinding>
const selectedSourceSchema = z.strictObject({
  sourceIndex: integer, url: httpUrl, title: z.string().nullable(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  totalChars: integer, bodyStart: integer, bodyEnd: integer, httpStatus: z.number().int().min(100).max(599).nullable(), nativeTruncated: z.boolean(),
  eligibility: z.enum(['usable', 'http-error', 'empty', 'suspect-encoding']), retention: z.enum(['selected', 'unselected']),
  excerpts: z.array(z.strictObject({ offset: integer, limit: integer.positive(), text: z.string() })),
}).refine(source => source.bodyStart <= source.bodyEnd && source.bodyEnd <= source.totalChars
  && (source.retention === 'selected') === (source.excerpts.length > 0)
  && (source.httpStatus === null || source.httpStatus >= 200 && source.httpStatus < 300 ? source.eligibility !== 'http-error' : source.eligibility === 'http-error')
  && source.excerpts.every(excerpt => excerpt.offset >= source.bodyStart && excerpt.offset + excerpt.limit <= source.bodyEnd && [...excerpt.text].length === excerpt.limit)
  && new Set(source.excerpts.map(excerpt => JSON.stringify([excerpt.offset, excerpt.limit]))).size === source.excerpts.length,
'Persisted source status and excerpt ranges must match their recorded metadata')
/** Strict version-3 observation schema; legacy evidence retains its own decoder. */
export const selectedObservationSchema = z.strictObject({
  callId: callIdSchema, name: z.enum(['web_search', 'web_fetch']),
  input: z.union([z.strictObject({ queries: z.array(z.string()) }), z.strictObject({ url: z.string() })]),
  callSeq: integer, resultSeq: integer, status: z.enum(['succeeded', 'failed']), error: z.string().nullable(),
  sources: z.array(selectedSourceSchema),
  rejectedSources: z.array(z.strictObject({ sourceIndex: integer, reference: z.string().refine(value => !httpUrl.safeParse(value).success), title: z.string().nullable(), reason: z.literal('unsupported-reference') })),
}).refine(observation => [...observation.sources, ...observation.rejectedSources].map(source => source.sourceIndex).sort((left, right) => left - right).every((index, offset) => index === offset),
'Accepted and rejected sources must retain every original index exactly once') satisfies z.ZodType<SelectedResearchObservation>

function sourceIndex(source: NativeResearchSource): IndexedResearchSource {
  const { content, ...metadata } = source
  const body = [...content].slice(source.bodyStart, source.bodyEnd).join('')
  const eligibility: ResearchSourceEligibility = source.httpStatus !== null && (source.httpStatus < 200 || source.httpStatus >= 300) ? 'http-error'
    : body.trim().length === 0 ? 'empty' : body.includes('\uFFFD') ? 'suspect-encoding' : 'usable'
  return { ...metadata, eligibility }
}

function checkMetadata(log: readonly IndexedResearchObservation[], findings: readonly ResearchSelectedFinding[], limits: ResearchLimits): void {
  if (log.length > limits.maxResearchCalls || log.reduce((sum, call) => sum + call.sources.length + call.rejectedSources.length, 0) > limits.maxResearchSources) {
    throw new WritingError('research-budget', 'Research call or source index count exceeds the configured limit')
  }
  let chars = 0
  for (const call of log) {
    chars += [...call.callId + (call.error ?? '')].length
    chars += 'url' in call.input ? [...call.input.url].length : call.input.queries.reduce((sum, query) => sum + [...query].length, 0)
    for (const source of call.sources) chars += [...source.url + (source.title ?? '') + source.sha256].length
    for (const source of call.rejectedSources) chars += [...source.reference + (source.title ?? '')].length
  }
  for (const finding of findings) {
    chars += [...finding.questionId].length + finding.callIds.reduce((sum, callId) => sum + [...callId].length, 0)
    for (const selection of finding.selections) chars += [...JSON.stringify([selection.callId, selection.sourceIndex, selection.offset, selection.limit])].length
  }
  if (chars > limits.maxEvidenceChars) throw new WritingError('research-budget', 'Research source index metadata exceeds the configured text limit')
}

/** @param log - Verified native sources. @param limits - Independent finite metadata and source bounds. @returns An index without body text or previews. */
export function researchSourceIndex(log: readonly NativeResearchObservation[], limits: ResearchLimits): IndexedResearchObservation[] {
  const index = log.map(({ sources, ...observation }) => ({ ...observation, sources: sources.map(sourceIndex) }))
  checkMetadata(index, [], limits)
  return index
}

function selectedSource(log: readonly NativeResearchObservation[], selection: ResearchSelection): NativeResearchSource {
  const call = log.find(call => call.callId === selection.callId)
  if (call === undefined || call.status !== 'succeeded') throw new WritingError('research-incomplete', 'Research selection requires a successful observed native call')
  const source = call.sources.find(source => source.sourceIndex === selection.sourceIndex)
  if (source === undefined) throw new WritingError('research-incomplete', 'Research selection names an unobserved or rejected source')
  return source
}

/** @param log - Verified recorded source text. @param selection - Exact native identity and Unicode range. @param maxReadChars - Finite per-read limit. @returns A literal source page without another retrieval call. */
export function readResearchSource(log: readonly NativeResearchObservation[], selection: ResearchSelection, maxReadChars: number): ResearchSourcePage {
  if (!Number.isSafeInteger(selection.sourceIndex) || selection.sourceIndex < 0 || !Number.isSafeInteger(selection.offset) || selection.offset < 0
    || !Number.isSafeInteger(selection.limit) || selection.limit < 1 || selection.limit > maxReadChars) throw new WritingError('invalid-input', 'Research source read requires a valid bounded Unicode range')
  const source = selectedSource(log, selection)
  if (selection.offset > source.totalChars) throw new WritingError('invalid-input', 'Research source offset exceeds recorded content')
  const text = [...source.content].slice(selection.offset, selection.offset + selection.limit).join('')
  const nextOffset = selection.offset + [...text].length
  return { ...sourceIndex(source), callId: selection.callId, offset: selection.offset, nextOffset, eof: nextOffset === source.totalChars, text }
}

/** @param log - Verified native source text. @param findings - Exact selected ranges per conclusion. @param limits - Separate metadata and retained-text bounds. @returns All observations with only the requested literal excerpts retained. */
export function selectResearchEvidence(log: readonly NativeResearchObservation[], findings: readonly ResearchSelectedFinding[], limits: ResearchLimits): SelectedResearchObservation[] {
  const index = researchSourceIndex(log, limits)
  checkMetadata(index, findings, limits)
  const selected = new Map<string, ResearchExcerpt[]>()
  let retainedChars = 0
  for (const finding of findings) for (const selection of finding.selections) {
    if (!finding.callIds.includes(selection.callId)) throw new WritingError('invalid-input', 'A selected range must belong to a cited call')
    const source = selectedSource(log, selection)
    const page = readResearchSource(log, selection, limits.maxEvidenceChars)
    if ([...page.text].length !== selection.limit) throw new WritingError('invalid-input', 'A selected range must fit entirely inside recorded content')
    if (selection.offset < source.bodyStart || page.nextOffset > source.bodyEnd) throw new WritingError('invalid-input', 'Evidence selections must stay within the recorded source body')
    const key = JSON.stringify([selection.callId, selection.sourceIndex])
    const excerpts = selected.get(key) ?? []
    if (excerpts.some(excerpt => excerpt.offset === selection.offset && excerpt.limit === selection.limit)) continue
    retainedChars += selection.limit
    if (retainedChars > limits.maxEvidenceChars) throw new WritingError('research-budget', 'Selected research excerpts exceed the configured text limit')
    excerpts.push({ offset: selection.offset, limit: selection.limit, text: page.text })
    selected.set(key, excerpts)
  }
  return index.map(observation => ({ ...observation, sources: observation.sources.map(source => {
    const excerpts = selected.get(JSON.stringify([observation.callId, source.sourceIndex])) ?? []
    return { ...source, retention: excerpts.length === 0 ? 'unselected' as const : 'selected' as const, excerpts }
  }) }))
}

/** @param questions - Immutable plan questions. @param findings - Model interpretations with exact selections. @param observations - Saved literal excerpts and native statuses. @param limits - Finite source and conclusion limits. @returns Findings and the host-owned aggregate outcome. */
export function researchSelectedConclusions(questions: readonly ResearchQuestion[], findings: readonly ResearchSelectedFinding[], observations: readonly SelectedResearchObservation[], limits: ResearchLimits) {
  if (findings.length !== questions.length || new Set(findings.map(finding => finding.questionId)).size !== findings.length
    || findings.some(finding => !questions.some(question => question.id === finding.questionId))) throw new WritingError('invalid-input', 'Research findings must answer every planned question exactly once')
  checkMetadata(observations, findings, limits)
  if (findings.reduce((sum, finding) => sum + [...finding.conclusion].length, 0) > limits.maxEvidenceChars
    || observations.reduce((sum, call) => sum + call.sources.reduce((count, source) => count + source.excerpts.reduce((length, excerpt) => length + [...excerpt.text].length, 0), 0), 0) > limits.maxEvidenceChars) {
    throw new WritingError('research-budget', 'Research conclusions or selected excerpts exceed the configured text limit')
  }
  const classified = questions.map(question => {
    const finding = findings.find(finding => finding.questionId === question.id)!
    if (new Set(finding.callIds).size !== finding.callIds.length) throw new WritingError('invalid-input', 'Research finding call ids must be unique')
    const calls = finding.callIds.map(id => {
      const call = observations.find(call => call.callId === id)
      if (call === undefined) throw new WritingError('research-incomplete', 'A finding names an unobserved native web call')
      return call
    })
    const evidence = finding.selections.map(selection => {
      if (!finding.callIds.includes(selection.callId)) throw new WritingError('invalid-input', 'A selected range must belong to a cited call')
      const source = calls.find(call => call.callId === selection.callId)?.sources.find(source => source.sourceIndex === selection.sourceIndex)
      const excerpt = source?.excerpts.find(excerpt => excerpt.offset === selection.offset && excerpt.limit === selection.limit)
      if (source === undefined || excerpt === undefined || source.retention !== 'selected') throw new WritingError('research-incomplete', 'A finding cites an excerpt absent from saved evidence')
      if (excerpt.offset < source.bodyStart || excerpt.offset + excerpt.limit > source.bodyEnd || [...excerpt.text].length !== excerpt.limit) throw new WritingError('research-incomplete', 'Saved research excerpt does not match its declared range')
      return source.eligibility === 'usable' && excerpt.text.trim().length > 0
    })
    let outcome: ResearchOutcome
    if (question.kind !== 'external') {
      if (calls.length > 0 || finding.selections.length > 0) throw new WritingError('invalid-input', 'Internal and creative questions cannot cite external evidence')
      outcome = 'not-needed'
    } else if (calls.length === 0 || calls.some(call => call.status === 'failed')) outcome = 'failed'
    else if (!finding.adequate || evidence.length === 0 || evidence.some(usable => !usable)) outcome = 'insufficient'
    else outcome = 'succeeded'
    return { ...finding, outcome }
  })
  // The aggregate follows the classified findings alone. A failed call that no finding cites stays recorded in the observations
  // with its status and error but no longer fails the plan by itself; a finding that cites a failed call is already 'failed' above.
  const outcomes = classified.map(finding => finding.outcome)
  const outcome: ResearchOutcome = outcomes.includes('failed') ? 'failed'
    : outcomes.includes('insufficient') ? 'insufficient' : outcomes.includes('succeeded') ? 'succeeded' : 'not-needed'
  return { findings: classified, outcome }
}
