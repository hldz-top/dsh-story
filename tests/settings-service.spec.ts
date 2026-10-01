import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { parseRequestId, type Actor } from '../src/contracts.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { NovelRecord, ArtifactRecord } from '../src/records.ts'
import { StageOutputSchemas } from '../src/stage-output.ts'
import { useStorage } from './support/storage.ts'

const limits = { maxArtifactBytes: 65_536, maxReadChars: 4096 }

describe.each(['json', 'sqlite'] as const)('%s settings adoption', backend => {
  it('persists a complete settings candidate without adopting it before review', async () => {
    const h = await useStorage(backend, limits)
    const actor: Actor = { workspace: h.root, sessionId: brandString<SessionId>('writer') }
    const novel = await h.service.createNovel(actor, { requestId: parseRequestId('create'), title: 'Harbor', brief: 'A mystery set in a fictional harbor.' })
    const plan = await h.service.startResearch(actor, { novelId: novel.id, requestId: parseRequestId('research'), briefArtifactId: novel.brief.id,
      questions: [{ id: 'genre', kind: 'creative', question: 'Choose a genre', reason: 'An authorial decision' }] }, 0)
    const evidence = await h.service.completeSelectedResearch(actor, { novelId: novel.id, planId: plan.planId, requestId: parseRequestId('evidence'),
      findings: [{ questionId: 'genre', callIds: [], selections: [], conclusion: 'Use a fictional mystery', adequate: true }] }, [])
    if (evidence.result === null) throw new Error('Expected completed research')
    const inputRefs = [novel.brief, evidence.result].map(ref => ({ artifactId: ref.id, sha256: ref.sha256 }))
    const output = { version: 1, dimensionCode: 'a1', inputRefs, facts: [{ id: 'genre-main', statement: 'The story is a mystery.' }], contentMarkdown: '# Genre\nMystery.' }
    const candidate = await h.service.saveSettingsCandidate(actor, { novelId: novel.id, requestId: parseRequestId('candidate'),
      dimensionCode: 'a1', researchPlanId: plan.planId, output, childSessionId: brandString<SessionId>('child-genre') })
    expect(candidate).toMatchObject({ dimensionCode: 'a1', status: 'candidate', stale: false, review: null })
    expect(h.service.getSettings(actor, novel.id).applied).toEqual([])
    const stored = h.service.getArtifact(actor, { novelId: novel.id, artifactId: candidate.artifact.id })
    expect(stored.kind).toBe('settings-dimension')
    expect(JSON.parse(stored.text)).toEqual(output)
    await h.restart()
    expect(h.service.getSettings(actor, novel.id)).toEqual({ applied: [], history: [candidate] })
  })
})

it('rejects a fresh classification candidate above the bound at admission through the real saveSettingsCandidate path', async () => {
  const h = await useStorage('json', limits)
  const actor: Actor = { workspace: h.root, sessionId: brandString<SessionId>('writer') }
  const novel = await h.service.createNovel(actor, { requestId: parseRequestId('create'), title: 'Harbor', brief: 'A mystery set in a fictional harbor.' })
  const plan = await h.service.startResearch(actor, { novelId: novel.id, requestId: parseRequestId('research'), briefArtifactId: novel.brief.id,
    questions: [{ id: 'genre', kind: 'creative', question: 'Choose a genre', reason: 'An authorial decision' }] }, 0)
  const research = await h.service.completeSelectedResearch(actor, { novelId: novel.id, planId: plan.planId, requestId: parseRequestId('evidence'),
    findings: [{ questionId: 'genre', callIds: [], selections: [], conclusion: 'Use a fictional mystery', adequate: true }] }, [])
  if (research.result === null) throw new Error('Expected completed research')
  const inputRefs = [novel.brief, research.result].map(ref => ({ artifactId: ref.id, sha256: ref.sha256 }))
  const output = { version: 1, dimensionCode: 'a1', inputRefs, facts: Array.from({ length: 11 }, (_, index) => ({ id: `fact-${index}`, statement: 'A label with brief grounds.' })), contentMarkdown: '# Genre\nMystery.' }
  await expect(h.service.saveSettingsCandidate(actor, { novelId: novel.id, requestId: parseRequestId('candidate'),
    dimensionCode: 'a1', researchPlanId: plan.planId, output, childSessionId: brandString<SessionId>('child-genre') }))
    .rejects.toThrow('A classification dimension allows at most 10 facts; this candidate has 11')
  expect(h.service.getSettings(actor, novel.id).history).toEqual([])
})

it('keeps an already-persisted over-bound classification candidate durably readable on plain readback', async () => {
  const { h, actor, novel, request, candidate } = await createCandidate('json')
  await h.service.close()
  const path = join(h.root, 'data', 'story_writing.json')
  const document: { tables: { novels: Record<string, NovelRecord>; artifacts: Record<string, ArtifactRecord> } } = JSON.parse(await readFile(path, 'utf8'))
  const novelRecord = document.tables.novels[novel.id]
  const entry = novelRecord?.settingsHistory[0]
  const artifactRecord = document.tables.artifacts[candidate.artifact.id]
  if (!novelRecord || !entry || !artifactRecord) throw new Error('Missing persisted fixture')
  // Simulate a candidate admitted by an earlier plugin version, before the classification bound existed.
  // Canonicalize through the same schema saveSettingsCandidate/validateSettings parse, so the field order matches what the stored provenance hash was actually computed over.
  const overBoundOutput = StageOutputSchemas.settings.parse({ ...request.output, facts: Array.from({ length: 11 }, (_, index) => ({ id: `fact-${index}`, statement: 'A world-building fact the earlier admission never bounded.' })) })
  const text = JSON.stringify(overBoundOutput)
  const sha256 = createHash('sha256').update(text).digest('hex')
  const chars = [...text].length
  const bytes = Buffer.byteLength(text, 'utf8')
  Object.assign(artifactRecord, { text, sha256, chars, bytes })
  Object.assign(entry.artifact, { sha256, chars, bytes })
  entry.request.hash = createHash('sha256').update(JSON.stringify([entry.researchPlanId, entry.childSessionId, overBoundOutput])).digest('hex')
  await writeFile(path, JSON.stringify(document))
  await h.restart()
  const history = h.service.getSettings(actor, novel.id).history
  expect(history).toHaveLength(1)
  expect(history[0]).toMatchObject({ dimensionCode: 'a1', status: 'candidate', stale: false })
  expect(JSON.parse(h.service.getArtifact(actor, { novelId: novel.id, artifactId: candidate.artifact.id }).text)).toEqual(overBoundOutput)
})

async function createCandidate(backend: 'json' | 'sqlite') {
  const h = await useStorage(backend, limits)
  const actor: Actor = { workspace: h.root, sessionId: brandString<SessionId>('writer') }
  const novel = await h.service.createNovel(actor, { requestId: parseRequestId('create'), title: 'Harbor', brief: 'A mystery set in a fictional harbor.' })
  const plan = await h.service.startResearch(actor, { novelId: novel.id, requestId: parseRequestId('research'), briefArtifactId: novel.brief.id,
    questions: [{ id: 'genre', kind: 'creative', question: 'Choose a genre', reason: 'An authorial decision' }] }, 0)
  const research = await h.service.completeSelectedResearch(actor, { novelId: novel.id, planId: plan.planId, requestId: parseRequestId('evidence'),
    findings: [{ questionId: 'genre', callIds: [], selections: [], conclusion: 'Use a fictional mystery', adequate: true }] }, [])
  if (research.result === null) throw new Error('Expected completed research')
  const inputRefs = [novel.brief, research.result].map(ref => ({ artifactId: ref.id, sha256: ref.sha256 }))
  const output = { version: 1, dimensionCode: 'a1', inputRefs, facts: [{ id: 'genre-main', statement: 'The story is a mystery.' }], contentMarkdown: '# Genre\nMystery.' }
  const request = { novelId: novel.id, requestId: parseRequestId('candidate'), dimensionCode: 'a1', researchPlanId: plan.planId, output, childSessionId: brandString<SessionId>('child-genre') }
  const candidate = await h.service.saveSettingsCandidate(actor, request)
  return { h, actor, novel, request, candidate }
}

it.each(['json', 'sqlite'] as const)('%s replays a candidate after its brief changed without regenerating', async backend => {
  const { h, actor, novel, request, candidate } = await createCandidate(backend)
  await h.service.saveBrief(actor, { novelId: novel.id, requestId: parseRequestId('edit'), expectedRevision: 1, text: 'Move the story to the mountains.' })
  await h.restart()
  expect(await h.service.saveSettingsCandidate(actor, request)).toEqual({ ...candidate, stale: true })
  expect(h.service.getSettings(actor, novel.id).history).toHaveLength(1)
  await expect(h.service.saveSettingsCandidate(actor, { ...request, output: { ...request.output, contentMarkdown: 'Different genre' } })).rejects.toMatchObject({ code: 'request-conflict' })
})

it.each(['dimensionCode', 'inputRefs', 'researchPlanId', 'brief-text'] as const)('rejects damaged settings input or index: %s', async change => {
  const { h, actor, novel, request, candidate } = await createCandidate('json')
  await h.service.close()
  const path = join(h.root, 'data', 'story_writing.json')
  const document: { tables: { novels: Record<string, NovelRecord>; artifacts: Record<string, ArtifactRecord> } } = JSON.parse(await readFile(path, 'utf8'))
  const record = document.tables.novels[novel.id]
  const entry = record?.settingsHistory[0]
  const brief = document.tables.artifacts[novel.brief.id]
  if (!entry || !brief) throw new Error('Missing persisted fixture')
  if (change === 'dimensionCode') entry.dimensionCode = 'a2'
  if (change === 'inputRefs') entry.inputRefs = [{ artifactId: candidate.artifact.id, sha256: candidate.artifact.sha256 }]
  if (change === 'researchPlanId') entry.researchPlanId = novel.brief.id
  if (change === 'brief-text') brief.text = 'Tampered brief.'
  await writeFile(path, JSON.stringify(document))
  await h.restart()
  if (change === 'brief-text') {
    await expect(h.service.saveSettingsCandidate(actor, { ...request, requestId: parseRequestId('another') })).rejects.toMatchObject({ code: 'corrupt-artifact' })
  } else expect(() => h.service.getSettings(actor, novel.id)).toThrow()
})

it.each(['json', 'sqlite'] as const)('%s adopts only the exact nonblocking reviewed candidate', async backend => {
  const { h, actor, novel, candidate } = await createCandidate(backend)
  const exact = { novelId: novel.id, candidateId: candidate.artifact.id }
  await expect(h.service.applySettingsCandidate(actor, { ...exact, reviewId: novel.brief.id, expectedAppliedId: null })).rejects.toMatchObject({ code: 'review-blocked' })
  const evidence = [{ artifactId: candidate.artifact.id, quote: 'Mystery.' }]
  const output = { version: 1, reviewed: { artifactId: candidate.artifact.id, sha256: candidate.artifact.sha256 }, inputRefs: candidate.inputRefs,
    checks: [{ category: 'completeness', summary: 'The genre is specified.', evidence }, { category: 'consistency', summary: 'The genre matches the creative brief.', evidence }],
    issues: [{ id: 'wording', category: 'style', severity: 'advisory', location: 'Genre', message: 'Expand later if useful.', evidence }] }
  const reviewed = await h.service.saveSettingsReview(actor, { ...exact, expectedReviewId: null, requestId: parseRequestId('review'), output, childSessionId: brandString<SessionId>('reviewer') })
  expect(reviewed.status).toBe('reviewed')
  expect(h.service.getSettings(actor, novel.id).applied).toEqual([])
  if (reviewed.review === null) throw new Error('Missing review')
  const request = { ...exact, reviewId: reviewed.review.id, expectedAppliedId: null }
  const applied = await h.service.applySettingsCandidate(actor, request)
  expect(applied.status).toBe('applied')
  expect(h.service.getSettings(actor, novel.id).applied).toEqual([applied])
  await h.restart()
  expect(await h.service.applySettingsCandidate(actor, request)).toEqual(applied)
  expect(h.service.getSettings(actor, novel.id).history).toHaveLength(1)
  const refs = h.service.settingsInputs(actor, novel.id, 'a2', h.service.listResearch(actor, novel.id)[0]!.planId)
  expect(refs.at(-1)?.id).toBe(candidate.artifact.id)
})

it.each(['json', 'sqlite'] as const)('%s preserves a blocked candidate and rejects stale adoption', async backend => {
  const { h, actor, novel, candidate } = await createCandidate(backend)
  const exact = { novelId: novel.id, candidateId: candidate.artifact.id }
  const evidence = [{ artifactId: candidate.artifact.id, quote: 'Mystery.' }]
  const output = { version: 1, reviewed: { artifactId: candidate.artifact.id, sha256: candidate.artifact.sha256 }, inputRefs: candidate.inputRefs,
    checks: [{ category: 'completeness', summary: 'Genre specified.', evidence }, { category: 'consistency', summary: 'Conflicts with the requested tone.', evidence }],
    issues: [{ id: 'genre', category: 'consistency', severity: 'blocking', location: 'Genre', message: 'Fix the contradiction.', evidence }] }
  const blocked = await h.service.saveSettingsReview(actor, { ...exact, expectedReviewId: null, requestId: parseRequestId('blocked-review'), output, childSessionId: brandString<SessionId>('reviewer') })
  expect(blocked.status).toBe('blocked')
  if (blocked.review === null) throw new Error('Missing blocking review')
  await expect(h.service.applySettingsCandidate(actor, { ...exact, reviewId: blocked.review.id, expectedAppliedId: null })).rejects.toMatchObject({ code: 'review-blocked' })
  const reviewed = await h.service.saveSettingsReview(actor, { ...exact, expectedReviewId: blocked.review.id, requestId: parseRequestId('clear-review'), output: { ...output, issues: [] }, childSessionId: brandString<SessionId>('reviewer-2') })
  if (reviewed.review === null) throw new Error('Missing completed review')
  await expect(h.service.applySettingsCandidate(actor, { ...exact, reviewId: blocked.review.id, expectedAppliedId: null })).rejects.toMatchObject({ code: 'review-blocked' })
  await h.service.saveBrief(actor, { novelId: novel.id, requestId: parseRequestId('edit'), expectedRevision: 1, text: 'A new premise.' })
  await expect(h.service.applySettingsCandidate(actor, { ...exact, reviewId: reviewed.review.id, expectedAppliedId: null })).rejects.toMatchObject({ code: 'revision-conflict' })
  await h.restart()
  expect(h.service.getSettings(actor, novel.id).applied).toEqual([])
  expect(h.service.getSettings(actor, novel.id).history[0]).toMatchObject({ status: 'reviewed', stale: true })
  expect(h.service.getArtifact(actor, { novelId: novel.id, artifactId: blocked.review.id }).kind).toBe('review')
})

it('rejects an old passing review arriving after a newer blocking review', async () => {
  const { h, actor, novel, candidate } = await createCandidate('json')
  const evidence = [{ artifactId: candidate.artifact.id, quote: 'Mystery.' }]
  const output = { version: 1, reviewed: { artifactId: candidate.artifact.id, sha256: candidate.artifact.sha256 }, inputRefs: candidate.inputRefs,
    checks: [{ category: 'completeness', summary: 'Specified.', evidence }, { category: 'consistency', summary: 'A conflict was found.', evidence }],
    issues: [{ id: 'conflict', category: 'consistency', severity: 'blocking', location: 'Genre', message: 'Conflicting genres.', evidence }] }
  const base = { novelId: novel.id, candidateId: candidate.artifact.id, expectedReviewId: null, childSessionId: brandString<SessionId>('reviewer') }
  const blocked = await h.service.saveSettingsReview(actor, { ...base, requestId: parseRequestId('newer-review'), output })
  await expect(h.service.saveSettingsReview(actor, { ...base, requestId: parseRequestId('late-review'), output: { ...output, issues: [] } })).rejects.toMatchObject({ code: 'revision-conflict' })
  expect(h.service.getSettings(actor, novel.id).history[0]).toEqual(blocked)
})

it.each(['blocking-flag', 'missing-review', 'unreviewed-adoption', 'duplicate-head'] as const)('rejects corrupted review/adoption status: %s', async change => {
  const { h, actor, novel, candidate } = await createCandidate('json')
  const evidence = [{ artifactId: candidate.artifact.id, quote: 'Mystery.' }]
  const output = { version: 1, reviewed: { artifactId: candidate.artifact.id, sha256: candidate.artifact.sha256 }, inputRefs: candidate.inputRefs,
    checks: [{ category: 'completeness', summary: 'Specified.', evidence }, { category: 'consistency', summary: 'A conflict was found.', evidence }],
    issues: [{ id: 'conflict', category: 'consistency', severity: 'blocking', location: 'Genre', message: 'Conflicting genres.', evidence }] }
  const reviewed = await h.service.saveSettingsReview(actor, { novelId: novel.id, candidateId: candidate.artifact.id, expectedReviewId: null,
    requestId: parseRequestId('review'), output, childSessionId: brandString<SessionId>('reviewer') })
  if (reviewed.review === null) throw new Error('Missing review')
  await h.service.close()
  const path = join(h.root, 'data', 'story_writing.json')
  const document: { tables: { novels: Record<string, NovelRecord>; artifacts: Record<string, ArtifactRecord> } } = JSON.parse(await readFile(path, 'utf8'))
  const novelRecord = document.tables.novels[novel.id]
  const entry = novelRecord?.settingsHistory[0]
  if (!entry || !novelRecord || !entry.reviewHistory[0]) throw new Error('Missing persisted fixture')
  if (change === 'blocking-flag') entry.reviewHistory[0].blocking = false
  if (change === 'missing-review') delete document.tables.artifacts[reviewed.review.id]
  if (change === 'unreviewed-adoption') { entry.reviewHistory = []; entry.applied = true; novelRecord.settingsHeads = [{ dimensionCode: 'a1', artifactId: candidate.artifact.id }] }
  if (change === 'duplicate-head') novelRecord.settingsHeads = [{ dimensionCode: 'a1', artifactId: candidate.artifact.id }, { dimensionCode: 'a1', artifactId: candidate.artifact.id }]
  await writeFile(path, JSON.stringify(document))
  if (change === 'duplicate-head') await expect(h.restart()).rejects.toThrow()
  else { await h.restart(); expect(() => h.service.getSettings(actor, novel.id)).toThrow() }
})


it.each(['json', 'sqlite'] as const)('%s revises an applied dimension without making its lineage stale', async backend => {
  const { h, actor, novel, request, candidate } = await createCandidate(backend)
  async function reviewed(version: typeof candidate, id: string) {
    const evidence = [{ artifactId: version.artifact.id, quote: 'Mystery.' }]
    const result = await h.service.saveSettingsReview(actor, { novelId: novel.id, candidateId: version.artifact.id, expectedReviewId: null,
      requestId: parseRequestId(id), childSessionId: brandString<SessionId>(id), output: { version: 1,
        reviewed: { artifactId: version.artifact.id, sha256: version.artifact.sha256 }, inputRefs: version.inputRefs,
        checks: ['completeness', 'consistency'].map(category => ({ category, summary: 'The dimension is supported.', evidence })), issues: [] } })
    if (result.review === null) throw new Error('Missing review')
    return result.review.id
  }
  const baseReview = await reviewed(candidate, 'base-review')
  await h.service.applySettingsCandidate(actor, { novelId: novel.id, candidateId: candidate.artifact.id, reviewId: baseReview, expectedAppliedId: null })
  const collection = await h.service.assembleSettings(actor, { novelId: novel.id, requestId: parseRequestId('collection'), selectedCodes: ['a1'] })
  const refs = h.service.settingsInputs(actor, novel.id, 'a1', request.researchPlanId, candidate.artifact.id)
  expect(refs.at(-1)).toEqual(candidate.artifact)
  const revisedRequest = { ...request, requestId: parseRequestId('revise'), revisionOf: candidate.artifact.id,
    output: { ...request.output, inputRefs: refs.map(ref => ({ artifactId: ref.id, sha256: ref.sha256 })), contentMarkdown: 'Mystery. Revised by the author.' } }
  const revised = await h.service.saveSettingsCandidate(actor, revisedRequest)
  expect(revised).toMatchObject({ revisionOf: candidate.artifact.id, stale: false, status: 'candidate' })
  const reviewId = await reviewed(revised, 'revised-review')
  await expect(h.service.applySettingsCandidate(actor, { novelId: novel.id, candidateId: revised.artifact.id, reviewId, expectedAppliedId: null })).rejects.toMatchObject({ code: 'revision-conflict' })
  const applied = await h.service.applySettingsCandidate(actor, { novelId: novel.id, candidateId: revised.artifact.id, reviewId, expectedAppliedId: candidate.artifact.id })
  expect(applied).toMatchObject({ status: 'applied', stale: false })
  expect(h.service.getManuscript(actor, novel.id).history.find(item => item.artifact.id === collection.artifact.id)?.stale).toBe(true)
  await h.restart()
  expect(await h.service.saveSettingsCandidate(actor, revisedRequest)).toEqual(applied)
  expect(h.service.getSettings(actor, novel.id).history).toHaveLength(2)
  expect(h.service.getSettings(actor, novel.id).applied).toEqual([applied])
  expect(h.service.getArtifact(actor, { novelId: novel.id, artifactId: candidate.artifact.id }).text).toContain('Mystery.')
  expect(() => h.service.settingsInputs(actor, novel.id, 'a1', request.researchPlanId, candidate.artifact.id)).toThrow()
  const newBrief = await h.service.saveBrief(actor, { novelId: novel.id, requestId: parseRequestId('fresh-brief'), expectedRevision: 1, text: 'A mountain mystery.' })
  const research = await h.service.startResearch(actor, { novelId: novel.id, requestId: parseRequestId('fresh-research'), briefArtifactId: newBrief.brief.id,
    questions: [{ id: 'place', kind: 'creative', question: 'Move the setting?', reason: 'The author changed the setting.' }] }, 0)
  await h.service.completeSelectedResearch(actor, { novelId: novel.id, planId: research.planId, requestId: parseRequestId('fresh-evidence'),
    findings: [{ questionId: 'place', callIds: [], selections: [], conclusion: 'A mountain mystery.', adequate: true }] }, [])
  const freshRefs = h.service.settingsInputs(actor, novel.id, 'a1', research.planId, applied.artifact.id)
  expect(freshRefs[0]).toEqual(newBrief.brief)
  const fresh = await h.service.saveSettingsCandidate(actor, { ...request, requestId: parseRequestId('fresh-revision'), revisionOf: applied.artifact.id, researchPlanId: research.planId,
    output: { ...request.output, inputRefs: freshRefs.map(ref => ({ artifactId: ref.id, sha256: ref.sha256 })) } })
  const freshReview = await reviewed(fresh, 'fresh-review')
  const latest = await h.service.applySettingsCandidate(actor, { novelId: novel.id, candidateId: fresh.artifact.id, reviewId: freshReview, expectedAppliedId: applied.artifact.id })
  expect(latest).toMatchObject({ stale: false, revisionOf: applied.artifact.id })
  expect(h.service.getSettings(actor, novel.id).history.find(item => item.artifact.id === applied.artifact.id)?.stale).toBe(true)
  await h.restart()
  expect(h.service.getSettings(actor, novel.id).applied).toEqual([latest])
})
