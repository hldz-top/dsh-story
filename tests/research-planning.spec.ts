import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { buildResearchPlanningPrompt, isResearchPlanningOutputError, researchNecessity, type ResearchPlanningRequest } from '../src/research-planning.ts'
import { parseArtifactId, parseNovelId, parseRequestId, WritingError, type ResearchLimits } from '../src/contracts.ts'
import { testResearchLimits } from './support/storage.ts'

const request: Omit<ResearchPlanningRequest, 'outputTarget'> = {
  parentSessionId: SessionId('planning-parent'),
  novelId: parseNovelId('novel_00000000-0000-4000-8000-000000000001'),
  briefArtifactId: parseArtifactId('artifact_00000000-0000-4000-8000-000000000001'),
  purpose: 'Establish the evidence needed for settings dimension a3.',
  requestId: parseRequestId('planning-request'),
  inputs: [{ id: parseArtifactId('artifact_00000000-0000-4000-8000-000000000001'), kind: 'creative-brief', revision: 1, sha256: 'a'.repeat(64), chars: 3100, bytes: 6200 }],
}

it('quotes stage data while scoping research to exactly TASK_DATA.outputTarget', () => {
  const outputTarget = { kind: 'settings', dimensionCode: 'a3' }
  const prompt = buildResearchPlanningPrompt({ ...request, outputTarget }, testResearchLimits)
  const [instructions, data] = prompt.split('\n\nTASK_DATA\n\n')
  expect(JSON.parse(data!)).toEqual({ kind: 'research-planning', novelId: request.novelId, briefArtifactId: request.briefArtifactId, purpose: request.purpose, requestId: request.requestId, inputs: request.inputs, outputTarget })
  expect(instructions).toContain('TASK_DATA.outputTarget')
  expect(instructions).toContain('Internal questions concern supplied facts')
})

it.each([
  { label: 'a settings outputTarget with a catalog', outputTarget: { kind: 'settings', dimensionCode: 'a3', catalog: { code: 'a3', name: '受众', dependsOn: ['a1'], enabled: true, kind: 'enum_single', requiredFor: [] } } },
  { label: 'a manuscript target with no catalog', outputTarget: { kind: 'body', chapterNumber: 1 } },
])('tells the local planner a present outputTarget.catalog is the complete dimension definition with no predefined option list, for $label', ({ outputTarget }) => {
  const prompt = buildResearchPlanningPrompt({ ...request, outputTarget }, testResearchLimits)
  const [instructions] = prompt.split('\n\nTASK_DATA\n\n')
  expect(instructions).toContain('When TASK_DATA.outputTarget.catalog is present, it is the complete definition of that settings dimension. Its kind states only the output form: enum_single means one label, enum_multi a short set of labels, llm_free free-form facts. The catalog defines no predefined option list; which label or labels to choose is a creative question resolved from the brief and accepted dependencies. Never ask about the host program\'s internals, such as option lists, schemas, validation rules, counting implementation or tools; TASK_DATA and these instructions already fix them. Every internal question must be answerable from the supplied inputs.')
})

describe('real e1 planning capture from live run run_dbe969a5', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/run-dbe969a5-e1-planning.json', import.meta.url), 'utf8')) as {
    serviceLimits: ResearchLimits & Record<string, number>; decision: { questions: Array<{ id: string; kind: string }> } & Record<string, unknown>
  }
  const limits = fixture.serviceLimits

  it('planned 13 questions (5 internal, 8 creative) against the per-plan limit of 12, well inside the text limit', () => {
    expect(fixture.decision.questions).toHaveLength(13)
    expect(fixture.decision.questions.filter(question => question.kind === 'internal')).toHaveLength(5)
    expect(fixture.decision.questions.filter(question => question.kind === 'creative')).toHaveLength(8)
    expect(limits.maxResearchQuestions).toBe(12)
    expect(() => researchNecessity({ ...fixture.decision, questions: fixture.decision.questions.slice(0, 12) }, limits)).not.toThrow()
  })

  it('rejects the stored capture with a repairable error that states the count and the limit', () => {
    let error: unknown
    try { researchNecessity(fixture.decision, limits) } catch (cause) { error = cause }
    expect(error).toBeInstanceOf(WritingError)
    expect((error as WritingError).code).toBe('research-budget')
    expect((error as Error).message).toBe('Research questions exceed the configured limits: 13 questions, at most 12 per plan counting internal, creative and external questions together')
    expect(isResearchPlanningOutputError(error)).toBe(true)
  })

  it('keeps the first planning prompt byte-identical and adds the rejection and limit only to a replacement capture', () => {
    const outputTarget = { kind: 'settings', dimensionCode: 'e1' }
    const first = buildResearchPlanningPrompt({ ...request, outputTarget }, limits)
    expect(buildResearchPlanningPrompt({ ...request, outputTarget }, limits, null)).toBe(first)
    expect(first).toContain('Maximum 12 questions and 16000 combined Unicode characters')
    const message = 'Research questions exceed the configured limits: 13 questions, at most 12 per plan counting internal, creative and external questions together'
    const [instructions, data] = buildResearchPlanningPrompt({ ...request, outputTarget }, limits, message).split('\n\nTASK_DATA\n\n')
    expect(instructions).toContain(`The host rejected the previous planning decision for this exact target: ${message}`)
    expect(instructions).toContain('at most 12 questions in total, counting internal, creative and external questions together')
    expect(data).toBe(first.split('\n\nTASK_DATA\n\n')[1])
  })
})

it('states text-limit overruns with the measured count', () => {
  const question = { id: 'q1', kind: 'creative' as const, question: '长'.repeat(30), reason: '因'.repeat(30) }
  expect(() => researchNecessity({ mode: 'input-only', reason: 'r', questions: [question], externalRequirements: [] }, { ...testResearchLimits, maxEvidenceChars: 50 }))
    .toThrow('Research questions exceed the configured limits: 60 Unicode characters of question and reason text, at most 50')
})
