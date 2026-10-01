import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { parseArtifactId, parseNovelId, parseRequestId, type Artifact, type ArtifactId, type ArtifactKind, type NovelId, type ResearchObservation } from '../src/contracts.ts'
import { artifactMarkdown } from '../src/artifact-markdown.ts'
import { researchConclusions } from '../src/research.ts'
import { writingDomain } from '../src/records.ts'
import { testResearchLimits, useStorage } from './support/storage.ts'

function legacyArtifact(novelId: NovelId, id: ArtifactId, kind: ArtifactKind, text: string): Artifact {
  return { id, novelId, kind, revision: 1, text, chars: [...text].length, bytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex') }
}

function reference<K extends ArtifactKind>(artifact: Artifact, kind: K) {
  return { id: artifact.id, kind, revision: artifact.revision, sha256: artifact.sha256, chars: artifact.chars, bytes: artifact.bytes }
}

describe.each(['json', 'sqlite'] as const)('%s evidence compatibility', backend => {
  it.each([1, 2])('reads immutable version-%i evidence beside selected version-3 evidence after restart', async version => {
    const novelId = parseNovelId('novel_00000000-0000-4000-8000-000000000001')
    const briefId = parseArtifactId('artifact_00000000-0000-4000-8000-000000000001')
    const planId = parseArtifactId('artifact_00000000-0000-4000-8000-000000000002')
    const evidenceId = parseArtifactId('artifact_00000000-0000-4000-8000-000000000003')
    const sessionId = SessionId('legacy-research-author')
    const callId = ToolCallId('legacy-fetch')
    const questions = [{ id: 'signal', kind: 'external' as const, question: 'What does the signal mean?', reason: 'Navigation needs evidence.' }]
    const input = { version: 1, novelId, briefArtifactId: briefId, sessionId, startSeq: 10 }
    const brief = legacyArtifact(novelId, briefId, 'creative-brief', 'Investigate the harbor.')
    const plan = legacyArtifact(novelId, planId, 'research-plan', JSON.stringify({ ...input, questions }))
    const evidence = legacyArtifact(novelId, evidenceId, 'research-evidence', JSON.stringify({ ...input, version, planId, outcome: 'failed',
      findings: [{ questionId: 'signal', callIds: [callId], conclusion: 'Unavailable.', adequate: false, outcome: 'failed' }],
      observations: [{ callId, name: 'web_fetch', input: { url: 'https://example.test/signal' }, callSeq: 11, resultSeq: 12,
        status: 'failed', error: 'Unavailable.', sources: [], ...(version === 2 ? { rejectedSources: [] } : {}) }],
    }))
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 64 }, testResearchLimits, async (facility, root) => {
      const domain = await facility.open(writingDomain)
      try {
        for (const artifact of [brief, plan, evidence]) await domain.table('artifacts').put(artifact.id, artifact)
        await domain.table('novels').put(novelId, {
          id: novelId, workspace: root, title: 'Lighthouse', recordVersion: 5,
          createRequest: { requestId: parseRequestId('legacy-novel'), hash: 'a'.repeat(64) }, briefRequests: [],
          briefHistory: [reference(brief, 'creative-brief')], settingsHistory: [], settingsHeads: [], manuscriptHistory: [], manuscriptHeads: [], appliedChapters: [],
          researchHistory: [{ plan: reference(plan, 'research-plan'), result: reference(evidence, 'research-evidence'),
            briefArtifactId: briefId, sessionId, startSeq: 10, questions, outcome: 'failed', reservedCalls: [{ callId, name: 'web_fetch' }],
            startRequest: { requestId: parseRequestId('legacy-plan'), hash: 'b'.repeat(64) },
            completeRequest: { requestId: parseRequestId('legacy-complete'), hash: 'c'.repeat(64) } }],
        })
      } finally { await domain.close() }
    })
    const actor = { workspace: h.root, sessionId }
    const historical = h.service.getResearch(actor, { novelId, planId })
    expect(historical.outcome).toBe('failed')
    expect(h.service.getArtifact(actor, { novelId, artifactId: evidenceId })).toEqual(evidence)
    const markdown = artifactMarkdown(evidence)
    expect(markdown).toContain('No sources were recorded for this call.')
    expect(markdown).not.toContain('Rejected source reference')
    const current = await h.service.startResearch(actor, { novelId, briefArtifactId: briefId, requestId: parseRequestId('current-plan'),
      questions: [{ id: 'motive', kind: 'creative', question: 'Why stay?', reason: 'Author choice.' }] }, 20)
    const completed = await h.service.completeSelectedResearch(actor, { novelId, planId: current.planId, requestId: parseRequestId('current-complete'),
      findings: [{ questionId: 'motive', callIds: [], selections: [], conclusion: 'Wait for a friend.', adequate: true }] }, [])
    await h.restart()
    expect(h.service.getResearch(actor, { novelId, planId })).toEqual(historical)
    const after = h.service.getArtifact(actor, { novelId, artifactId: evidenceId })
    expect(after).toEqual(evidence)
    expect(artifactMarkdown(after)).toBe(markdown)
    expect(JSON.parse(h.service.getArtifact(actor, { novelId, artifactId: completed.result!.id }).text)).toMatchObject({ version: 3 })
    expect(h.service.listResearch(actor, novelId).map(item => item.outcome)).toEqual(['failed', 'not-needed'])
  })

  it('reads version-3 evidence that the earlier rule recorded failed only because a call no finding cites failed, and still refuses to admit it', async () => {
    const novelId = parseNovelId('novel_00000000-0000-4000-8000-000000000001')
    const briefId = parseArtifactId('artifact_00000000-0000-4000-8000-000000000001')
    const planId = parseArtifactId('artifact_00000000-0000-4000-8000-000000000002')
    const evidenceId = parseArtifactId('artifact_00000000-0000-4000-8000-000000000003')
    const sessionId = SessionId('earlier-rule-author')
    const fetched = ToolCallId('signal-fetch')
    const broken = ToolCallId('broken-fetch')
    const excerpt = 'The light marks the harbor entrance.'
    const length = [...excerpt].length
    const questions = [{ id: 'signal', kind: 'external' as const, question: 'What does the signal mean?', reason: 'Navigation needs evidence.' }]
    const input = { version: 1, novelId, briefArtifactId: briefId, sessionId, startSeq: 10 }
    const brief = legacyArtifact(novelId, briefId, 'creative-brief', 'Investigate the harbor.')
    const plan = legacyArtifact(novelId, planId, 'research-plan', JSON.stringify({ ...input, questions }))
    // What the earlier aggregate rule stored for this evidence: the only finding succeeded, but an uncited failed call made the plan failed.
    const evidence = legacyArtifact(novelId, evidenceId, 'research-evidence', JSON.stringify({ ...input, version: 3, planId, outcome: 'failed',
      findings: [{ questionId: 'signal', callIds: [fetched], conclusion: 'The light marks the entrance.', adequate: true, outcome: 'succeeded', selections: [{ callId: fetched, sourceIndex: 0, offset: 0, limit: length }] }],
      observations: [
        { callId: fetched, name: 'web_fetch', input: { url: 'https://example.test/signal' }, callSeq: 11, resultSeq: 12, status: 'succeeded', error: null, rejectedSources: [],
          sources: [{ sourceIndex: 0, url: 'https://example.test/signal', title: null, sha256: createHash('sha256').update(excerpt).digest('hex'), totalChars: length, bodyStart: 0, bodyEnd: length,
            httpStatus: 200, nativeTruncated: false, eligibility: 'usable', retention: 'selected', excerpts: [{ offset: 0, limit: length, text: excerpt }] }] },
        { callId: broken, name: 'web_fetch', input: { url: 'https://example.test/broken' }, callSeq: 13, resultSeq: 14, status: 'failed', error: 'fetch failed', rejectedSources: [], sources: [] },
      ] }))
    const h = await useStorage(backend, { maxArtifactBytes: 100_000, maxReadChars: 64 }, testResearchLimits, async (facility, root) => {
      const domain = await facility.open(writingDomain)
      try {
        for (const artifact of [brief, plan, evidence]) await domain.table('artifacts').put(artifact.id, artifact)
        await domain.table('novels').put(novelId, {
          id: novelId, workspace: root, title: 'Lighthouse', recordVersion: 5,
          createRequest: { requestId: parseRequestId('earlier-rule-novel'), hash: 'a'.repeat(64) }, briefRequests: [],
          briefHistory: [reference(brief, 'creative-brief')], settingsHistory: [], settingsHeads: [], manuscriptHistory: [], manuscriptHeads: [], appliedChapters: [],
          researchHistory: [{ plan: reference(plan, 'research-plan'), result: reference(evidence, 'research-evidence'),
            briefArtifactId: briefId, sessionId, startSeq: 10, questions, outcome: 'failed', reservedCalls: [{ callId: fetched, name: 'web_fetch' }, { callId: broken, name: 'web_fetch' }],
            startRequest: { requestId: parseRequestId('earlier-rule-plan'), hash: 'b'.repeat(64) },
            completeRequest: { requestId: parseRequestId('earlier-rule-complete'), hash: 'c'.repeat(64) } }],
        })
      } finally { await domain.close() }
    })
    const actor = { workspace: h.root, sessionId }
    const expectReadableButNotAdmissible = () => {
      expect(h.service.getResearch(actor, { novelId, planId })).toMatchObject({ outcome: 'failed', result: { kind: 'research-evidence' }, reservedCalls: [{ callId: fetched }, { callId: broken }] })
      expect(h.service.getArtifact(actor, { novelId, artifactId: evidenceId })).toEqual(evidence)
      expect(h.service.listResearch(actor, novelId).map(item => item.outcome)).toEqual(['failed'])
      const markdown = artifactMarkdown(evidence)
      expect(markdown).toContain('Outcome: Research failed')
      expect(markdown).toContain('Outcome: Sufficient evidence')
      expect(markdown).toContain('Recorded error')
      expect(() => h.service.settingsInputs(actor, novelId, 'a1', planId)).toThrowError(expect.objectContaining({ code: 'research-incomplete' }))
    }
    expectReadableButNotAdmissible()
    await h.restart()
    expectReadableButNotAdmissible()
  })
})

it('keeps the legacy version-1/2 classifier failing the aggregate outcome on any failed observation', () => {
  const fetched = ToolCallId('legacy-fetch')
  const broken = ToolCallId('legacy-broken')
  const questions = [{ id: 'signal', kind: 'external' as const, question: 'What does the signal mean?', reason: 'Navigation needs evidence.' }]
  const excerpt = 'The light marks the harbor entrance.'
  const observations: ResearchObservation[] = [
    { callId: fetched, name: 'web_fetch', input: { url: 'https://example.test/signal' }, callSeq: 11, resultSeq: 12, status: 'succeeded', error: null, rejectedSources: [],
      sources: [{ sourceIndex: 0, url: 'https://example.test/signal', title: null, excerpt, offset: 0, totalChars: [...excerpt].length, sha256: createHash('sha256').update(excerpt).digest('hex'), truncated: false }] },
    { callId: broken, name: 'web_fetch', input: { url: 'https://example.test/broken' }, callSeq: 13, resultSeq: 14, status: 'failed', error: 'fetch failed', rejectedSources: [], sources: [] },
  ]
  const classified = researchConclusions(questions, [{ questionId: 'signal', callIds: [fetched], conclusion: 'The light marks the entrance.', adequate: true }], observations, testResearchLimits)
  // Stored legacy evidence keeps validating under the rule it was written with, so this read-only path is deliberately not aligned with the current writer.
  expect(classified.findings.map(item => item.outcome)).toEqual(['succeeded'])
  expect(classified.outcome).toBe('failed')
})
