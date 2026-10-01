import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { buildResearchPlanningPrompt, type ResearchPlanningRequest } from '../src/research-planning.ts'
import { parseArtifactId, parseNovelId, parseRequestId } from '../src/contracts.ts'
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
