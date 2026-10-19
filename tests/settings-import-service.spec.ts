/** Author settings import at the service: provenance, store compatibility, validation and derived pending review. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { parseRequestId, type Actor, type ArtifactId } from '../src/contracts.ts'
import type { NovelRecord } from '../src/records.ts'
import { useStorage } from './support/storage.ts'

const limits = { maxArtifactBytes: 65_536, maxReadChars: 4096 }
const importer = brandString<SessionId>('importer')
const reviewer = brandString<SessionId>('reviewer')

async function adopted(backend: 'json' | 'sqlite') {
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
  const candidate = await h.service.saveSettingsCandidate(actor, { novelId: novel.id, requestId: parseRequestId('candidate'), dimensionCode: 'a1', researchPlanId: plan.planId, output, childSessionId: brandString<SessionId>('child') })
  const evidence = [{ artifactId: candidate.artifact.id, quote: 'The story is a mystery.' }]
  const reviewed = await h.service.saveSettingsReview(actor, { novelId: novel.id, candidateId: candidate.artifact.id, expectedReviewId: null, requestId: parseRequestId('review'), childSessionId: reviewer,
    output: { version: 1, reviewed: { artifactId: candidate.artifact.id, sha256: candidate.artifact.sha256 }, inputRefs, checks: ['completeness', 'consistency'].map(category => ({ category, summary: 'Met.', evidence })), issues: [] } })
  if (reviewed.review === null) throw new Error('Missing review')
  const applied = await h.service.applySettingsCandidate(actor, { novelId: novel.id, candidateId: candidate.artifact.id, reviewId: reviewed.review.id, expectedAppliedId: null })
  const text = { version: 1, dimensionCode: 'a1', inputRefs: [{ artifactId: novel.brief.id, sha256: 'f'.repeat(64) }], facts: [{ id: 'genre-import', statement: 'The story is a harbor mystery.' }], contentMarkdown: '# Genre\nHarbor mystery, by the author.' }
  const request = { novelId: novel.id, requestId: parseRequestId('import'), dimensionCode: 'a1', expectedAppliedId: applied.artifact.id, output: text, childSessionId: importer }
  return { h, actor, novel, plan, research, applied, request }
}

async function reviewCollection(h: Awaited<ReturnType<typeof adopted>>['h'], actor: Actor, novelId: Awaited<ReturnType<typeof adopted>>['novel']['id'], id: string, blocking: boolean) {
  const collection = await h.service.assembleSettings(actor, { novelId, requestId: parseRequestId(`assemble-${id}`), selectedCodes: ['a1'] })
  const evidence = [{ artifactId: collection.artifact.id, quote: 'mystery' }]
  const reviewed = await h.service.saveManuscriptReview(actor, { novelId, candidateId: collection.artifact.id, expectedReviewId: null, requestId: parseRequestId(`collection-review-${id}`), childSessionId: reviewer,
    output: { version: 1, reviewed: { artifactId: collection.artifact.id, sha256: collection.artifact.sha256 }, inputRefs: collection.inputRefs,
      checks: ['completeness', 'consistency'].map(category => ({ category, summary: 'Checked.', evidence })),
      issues: blocking ? [{ id: 'drift', category: 'consistency', severity: 'blocking', location: 'a1', message: 'Disagrees.', evidence }] : [] } })
  return { collection, reviewed }
}

async function storedDocument(h: Awaited<ReturnType<typeof adopted>>['h']) {
  await h.service.close()
  const path = join(h.root, 'data', 'story_writing.json')
  return { path, document: JSON.parse(await readFile(path, 'utf8')) as { tables: { novels: Record<string, NovelRecord> } } }
}

describe.each(['json', 'sqlite'] as const)('%s settings import', backend => {
  it('C1/B3: appends an import record replacing the head, reusing its research, never relabeling or touching the earlier record', async () => {
    const { h, actor, novel, research, applied, request } = await adopted(backend)
    const imported = await h.service.importSettings(actor, request)
    expect(imported).toMatchObject({ dimensionCode: 'a1', origin: 'import', pendingReview: true, status: 'applied', stale: false, review: null, revisionOf: applied.artifact.id, childSessionId: importer })
    expect(imported.inputRefs).toEqual([novel.brief, research.result!, applied.artifact].map(ref => ({ artifactId: ref.id, sha256: ref.sha256 })))
    const settings = h.service.getSettings(actor, novel.id)
    expect(settings.applied).toEqual([imported])
    expect(settings.history).toEqual([{ ...applied, origin: 'stage', pendingReview: false }, imported])
    const stored = JSON.parse(h.service.getArtifact(actor, { novelId: novel.id, artifactId: imported.artifact.id }).text) as { inputRefs: unknown }
    expect(stored.inputRefs).toEqual(imported.inputRefs)
    await h.restart()
    expect(h.service.getSettings(actor, novel.id)).toEqual(settings)
    expect(await h.service.importSettings(actor, request)).toEqual(imported)
    await expect(h.service.importSettings(actor, { ...request, output: { ...request.output, contentMarkdown: 'Different.' } })).rejects.toMatchObject({ code: 'request-conflict' })
    await expect(h.service.importSettings(actor, { ...request, expectedAppliedId: imported.artifact.id })).rejects.toMatchObject({ code: 'request-conflict' })
    // A second import is a new record whose lineage is the first import; research still comes from the original stage head.
    const again = await h.service.importSettings(actor, { ...request, requestId: parseRequestId('import-2'), expectedAppliedId: imported.artifact.id })
    expect(again).toMatchObject({ origin: 'import', revisionOf: imported.artifact.id, pendingReview: true })
    expect(h.service.getSettings(actor, novel.id).history.map(item => [item.origin, item.status])).toEqual([['stage', 'applied'], ['import', 'applied'], ['import', 'applied']])
  })

  it('D: refuses a stale head, a dimension without an adopted head, unavailable dimensions and invalid documents', async () => {
    const { h, actor, novel, request } = await adopted(backend)
    await expect(h.service.importSettings(actor, { ...request, expectedAppliedId: novel.brief.id })).rejects.toMatchObject({ code: 'revision-conflict' })
    await expect(h.service.importSettings(actor, { ...request, dimensionCode: 'a2', output: { ...request.output, dimensionCode: 'a2' } })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(h.service.importSettings(actor, { ...request, dimensionCode: 'zz' })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(h.service.importSettings(actor, { ...request, output: [request.output] })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(h.service.importSettings(actor, { ...request, output: { ...request.output, dimensionCode: 'a2' } })).rejects.toThrow(/Settings dimension differs/)
    await expect(h.service.importSettings(actor, { ...request, output: { ...request.output, facts: undefined } })).rejects.toThrow()
    await expect(h.service.importSettings(actor, { ...request, output: { ...request.output, facts: Array.from({ length: 11 }, (_, index) => ({ id: `f${index}`, statement: 'Label.' })) } })).rejects.toThrow(/at most 10 facts/)
    await expect(h.service.importSettings(actor, { ...request, output: { ...request.output, contentMarkdown: 'x'.repeat(70_000) } })).rejects.toThrow()
    expect(h.service.getSettings(actor, novel.id).history).toHaveLength(1)
  })

  it('E: pending until a collection containing it passes review; a blocking review keeps it pending; release survives later changes', async () => {
    const { h, actor, novel, request } = await adopted(backend)
    const first = await reviewCollection(h, actor, novel.id, 'before', false)
    await h.service.applyManuscriptCandidate(actor, { novelId: novel.id, candidateId: first.collection.artifact.id, reviewId: first.reviewed.review!.id, expectedAppliedId: null })
    const imported = await h.service.importSettings(actor, request)
    expect(imported.pendingReview).toBe(true)
    expect(() => h.service.manuscriptResearchInputs(actor, { novelId: novel.id, target: { kind: 'book-outline', chapterCount: 1 } })).toThrowError(expect.objectContaining({ code: 'revision-conflict' }))
    await reviewCollection(h, actor, novel.id, 'blocked', true)
    expect(h.service.getSettings(actor, novel.id).applied[0]?.pendingReview).toBe(true)
    const passed = await reviewCollection(h, actor, novel.id, 'passed', false)
    expect(h.service.getSettings(actor, novel.id).applied[0]?.pendingReview).toBe(false)
    await h.service.applyManuscriptCandidate(actor, { novelId: novel.id, candidateId: passed.collection.artifact.id, reviewId: passed.reviewed.review!.id, expectedAppliedId: first.collection.artifact.id })
    expect(h.service.manuscriptResearchInputs(actor, { novelId: novel.id, target: { kind: 'book-outline', chapterCount: 1 } }).map(ref => ref.kind)).toEqual(['creative-brief', 'settings'])
    await h.service.saveBrief(actor, { novelId: novel.id, requestId: parseRequestId('edit'), expectedRevision: 1, text: 'Move the harbor north.' })
    expect(h.service.getSettings(actor, novel.id).applied[0]).toMatchObject({ pendingReview: false, stale: true })
  })
})

it('B1/B3: a store written without imports reads back unchanged, and writes never add origin to existing records', async () => {
  const { h, actor, novel, request } = await adopted('json')
  const view = h.service.getSettings(actor, novel.id)
  expect(view.applied.map(item => [item.origin, item.pendingReview])).toEqual([['stage', false]])
  const before = await storedDocument(h)
  expect(Object.keys(before.document.tables.novels[novel.id]!.settingsHistory[0]!)).not.toContain('origin')
  await h.restart()
  await h.service.importSettings(actor, request)
  const after = await storedDocument(h)
  const history = after.document.tables.novels[novel.id]!.settingsHistory
  expect(Object.keys(history[0]!)).not.toContain('origin')
  expect(history[1]!.origin).toBe('import')
})

it.each(['relabel-stage', 'drop-origin', 'add-review', 'unapply'] as const)('C3: rejects a tampered import record (%s) as corrupt', async change => {
  const { h, actor, novel, request } = await adopted('json')
  await h.service.importSettings(actor, request)
  const { path, document } = await storedDocument(h)
  const history = document.tables.novels[novel.id]!.settingsHistory as (NovelRecord['settingsHistory'][number] & { origin?: string })[]
  const record = history[1]!
  if (change === 'relabel-stage') record.origin = 'stage'
  if (change === 'drop-origin') delete record.origin
  if (change === 'add-review') record.reviewHistory = history[0]!.reviewHistory
  if (change === 'unapply') record.applied = false
  await writeFile(path, JSON.stringify(document))
  await h.restart()
  expect(() => h.service.getSettings(actor, novel.id)).toThrowError(expect.objectContaining({ code: 'corrupt-artifact' }))
})

it('C3: a stage record cannot be passed off as an import', async () => {
  const { h, actor, novel } = await adopted('json')
  const { path, document } = await storedDocument(h)
  const record = document.tables.novels[novel.id]!.settingsHistory[0]! as NovelRecord['settingsHistory'][number] & { origin?: string }
  record.origin = 'import'
  await writeFile(path, JSON.stringify(document))
  await h.restart()
  expect(() => h.service.getSettings(actor, novel.id)).toThrowError(expect.objectContaining({ code: 'corrupt-artifact' }))
  void (null as ArtifactId | null)
})
