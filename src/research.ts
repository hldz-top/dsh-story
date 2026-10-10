/** Research evidence classification and its durable record schemas. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { selectedFindingSchema, selectedObservationSchema } from './research-selection.ts'
import { artifactIdSchema, novelIdSchema, WritingError, type ResearchFinding, type ResearchLimits, type ResearchObservation, type ResearchOutcome, type ResearchQuestion } from './contracts.ts'

const nonblank = z.string().refine(value => value.trim().length > 0)
const callId = nonblank.transform(brandString<ToolCallId>)
/** Durable question declaration; duplicate identifiers are checked by the plan owner. */
export const researchQuestionSchema = z.strictObject({
  id: nonblank.max(256), kind: z.enum(['internal', 'creative', 'external']), question: nonblank, reason: nonblank,
})
/** Reserved native web invocation; results arrive through the host log collector. */
export const researchCallSchema = z.strictObject({ callId, name: z.enum(['web_search', 'web_fetch']) })
/** Recorded source excerpt with its position and full recorded-content digest. */
export const researchSourceSchema = z.strictObject({
  sourceIndex: z.number().int().nonnegative(),
  url: z.url().refine(value => /^https?:\/\//.test(value)), title: z.string().nullable(), excerpt: z.string(),
  offset: z.number().int().nonnegative(), totalChars: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), truncated: z.boolean(),
})
const legacyObservationSchema = researchCallSchema.extend({
  input: z.union([z.strictObject({ queries: z.array(z.string()) }), z.strictObject({ url: z.string() })]),
  callSeq: z.number().int().nonnegative(), resultSeq: z.number().int().nonnegative(),
  status: z.enum(['succeeded', 'failed']), sources: z.array(researchSourceSchema), error: z.string().nullable(),
})
/** Unusable native reference retained as audit data, never as an evidence URL. */
export const researchRejectedSourceSchema = z.strictObject({
  sourceIndex: z.number().int().nonnegative(),
  reference: z.string().refine(value => !researchSourceSchema.shape.url.safeParse(value).success, 'Rejected references cannot be usable HTTP(S) URLs'),
  title: z.string().nullable(),
  reason: z.literal('unsupported-reference'),
})
/** Version-2 host observation with explicit rejected native references. */
export const researchObservationSchema = legacyObservationSchema.extend({ rejectedSources: z.array(researchRejectedSourceSchema) })
  .refine(observation => {
    const indexes = [...observation.sources, ...observation.rejectedSources].map(source => source.sourceIndex).sort((a, b) => a - b)
    return indexes.every((value, index) => value === index)
  }, 'Accepted and rejected sources must retain every original index exactly once')
/** Model-supplied interpretation before program-owned outcome classification. */
export const researchFindingSchema = z.strictObject({
  questionId: nonblank.max(256), callIds: z.array(callId), conclusion: nonblank, adequate: z.boolean(),
})
/** Stored classification vocabulary. */
export const researchOutcomeSchema = z.enum(['not-needed', 'succeeded', 'insufficient', 'failed'])

const researchInputSchema = z.strictObject({
  version: z.literal(1), novelId: novelIdSchema, briefArtifactId: artifactIdSchema,
  sessionId: nonblank.transform(brandString<SessionId>), startSeq: z.number().int().nonnegative(),
})
/** Immutable plan JSON decoded at durable artifact and projection reads. */
export const researchPlanContentSchema = researchInputSchema.extend({ questions: z.array(researchQuestionSchema).nonempty() })
const evidenceFields = {
  planId: artifactIdSchema, findings: z.array(researchFindingSchema.extend({ outcome: researchOutcomeSchema })),
  outcome: researchOutcomeSchema,
}
/** Immutable v1/v2/v3 decoder; legacy bytes stay unchanged and only v1 gains rejected lists in memory. */
export const researchEvidenceContentSchema = z.union([
  researchInputSchema.extend({ ...evidenceFields, version: z.literal(3), findings: z.array(selectedFindingSchema.extend({ outcome: researchOutcomeSchema })), observations: z.array(selectedObservationSchema) }),
  researchInputSchema.extend({ ...evidenceFields, version: z.literal(2), observations: z.array(researchObservationSchema) }),
  researchInputSchema.extend({ ...evidenceFields, observations: z.array(legacyObservationSchema) }).transform(evidence => ({
    ...evidence, observations: evidence.observations.map(observation => ({ ...observation, rejectedSources: [] })),
  })),
])

/** @param questions - Caller-supplied planning input. @param limits - Per-plan bounds. @returns Detached validated questions. */
export function researchQuestions(questions: readonly ResearchQuestion[], limits: ResearchLimits): ResearchQuestion[] {
  const parsed = z.array(researchQuestionSchema).nonempty().parse(questions)
  const violation = researchQuestionViolation(parsed, limits)
  if (violation !== null) throw new WritingError(violation.code, violation.message)
  return parsed
}

/**
 * Shared finite and identity rules for a question list, so the tool path and model-output admission report the same specific message.
 * @param questions - Structurally valid questions. @param limits - Per-plan bounds. @returns The first violation, or null.
 */
export function researchQuestionViolation(questions: readonly ResearchQuestion[], limits: ResearchLimits): { code: 'research-budget' | 'invalid-input'; message: string } | null {
  if (questions.length > limits.maxResearchQuestions) {
    return { code: 'research-budget', message: `Research questions exceed the configured limits: ${questions.length} questions, at most ${limits.maxResearchQuestions} per plan counting internal, creative and external questions together` }
  }
  const chars = questions.reduce((sum, item) => sum + [...item.question].length + [...item.reason].length, 0)
  if (chars > limits.maxEvidenceChars) {
    return { code: 'research-budget', message: `Research questions exceed the configured limits: ${chars} Unicode characters of question and reason text, at most ${limits.maxEvidenceChars}` }
  }
  const seen = new Set<string>()
  for (const item of questions) {
    if (seen.has(item.id)) return { code: 'invalid-input', message: `Research question ids must be unique: ${JSON.stringify(item.id)} appears more than once` }
    seen.add(item.id)
  }
  return null
}

/**
 * Classify supplied findings using all settled host observations, without accepting a model's success assertion.
 * @param questions - Exact plan questions.
 * @param findings - Model conclusions for every question.
 * @param observations - Host-verified native web outcomes.
 * @param limits - Evidence retention bounds.
 * @returns Classified findings and the aggregate outcome.
 */
export function researchConclusions(questions: readonly ResearchQuestion[], findings: readonly ResearchFinding[], observations: readonly ResearchObservation[], limits: ResearchLimits) {
  const parsed = z.array(researchFindingSchema).parse(findings)
  if (parsed.length !== questions.length || new Set(parsed.map(item => item.questionId)).size !== parsed.length
    || parsed.some(item => !questions.some(question => question.id === item.questionId))) {
    throw new WritingError('invalid-input', 'Research findings must answer every planned question exactly once')
  }
  const sources = observations.flatMap(observation => observation.sources)
  const rejected = observations.flatMap(observation => observation.rejectedSources)
  const excerptChars = sources.reduce((sum, source) => sum + [...source.excerpt].length, 0)
  const rejectedChars = rejected.reduce((sum, source) => sum + [...source.reference].length + (source.title === null ? 0 : [...source.title].length), 0)
  const conclusionChars = parsed.reduce((sum, finding) => sum + [...finding.conclusion].length, 0)
  if (sources.length + rejected.length > limits.maxResearchSources || excerptChars + rejectedChars > limits.maxEvidenceChars || conclusionChars > limits.maxEvidenceChars) {
    throw new WritingError('research-budget', 'Research sources, excerpts, rejected references or conclusions exceed the configured limits')
  }
  const classified = questions.map(question => {
    const finding = parsed.find(item => item.questionId === question.id)!
    if (new Set(finding.callIds).size !== finding.callIds.length) throw new WritingError('invalid-input', 'Research finding call ids must be unique')
    const calls = finding.callIds.map(id => {
      const observed = observations.find(item => item.callId === id)
      if (observed === undefined) throw new WritingError('research-incomplete', 'A finding names an unobserved native web call')
      return observed
    })
    let outcome: ResearchOutcome
    if (question.kind !== 'external') {
      if (calls.length > 0) throw new WritingError('invalid-input', 'Internal and creative questions cannot cite external calls')
      outcome = 'not-needed'
    } else if (calls.length === 0 || calls.some(call => call.status === 'failed')) outcome = 'failed'
    else if (!finding.adequate || !calls.some(call => call.sources.some(source => source.excerpt.trim().length > 0))) outcome = 'insufficient'
    else outcome = 'succeeded'
    return { ...finding, outcome }
  })
  const outcomes = classified.map(finding => finding.outcome)
  const outcome: ResearchOutcome = observations.some(call => call.status === 'failed') || outcomes.includes('failed') ? 'failed'
    : outcomes.includes('insufficient') ? 'insufficient'
    : outcomes.includes('succeeded') ? 'succeeded' : 'not-needed'
  return { findings: classified, outcome }
}
