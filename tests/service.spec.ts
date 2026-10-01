import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { parseArtifactId, parseNovelId, parseRequestId, type Actor, type ArtifactId, type RequestId } from '../src/contracts.ts'
import type { ArtifactRecord, NovelRecord } from '../src/records.ts'
import { useStorage } from './support/storage.ts'

const limits = { maxArtifactBytes: 4096, maxReadChars: 16 }
const requestId = (value: string): RequestId => brandString<RequestId>(value)
const actor = (workspace: string, session = 'session-a'): Actor => ({
  workspace,
  sessionId: brandString<SessionId>(session),
})

it('parses opaque tool identifiers without accepting paths or blank request keys', () => {
  const uuid = '00c38d7c-50d8-4a1b-93f0-188daf5a9859'
  expect(parseNovelId(`novel_${uuid}`)).toBe(`novel_${uuid}`)
  expect(parseArtifactId(`artifact_${uuid}`)).toBe(`artifact_${uuid}`)
  expect(parseRequestId('request-1')).toBe('request-1')
  for (const value of ['../novel', '', null, `artifact_${uuid}`]) expect(() => parseNovelId(value)).toThrow()
  for (const value of ['../artifact', '', null, `novel_${uuid}`]) expect(() => parseArtifactId(value)).toThrow()
  for (const value of ['', '   ', 'x'.repeat(257), null]) expect(() => parseRequestId(value)).toThrow()
})

it('requires finite positive deployment limits before opening the writing domain', async () => {
  for (const invalid of [
    { maxArtifactBytes: 0, maxReadChars: 1 },
    { maxArtifactBytes: 1, maxReadChars: 0 },
    { maxArtifactBytes: Number.POSITIVE_INFINITY, maxReadChars: 1 },
    { maxArtifactBytes: 1, maxReadChars: 1.5 },
  ]) await expect(useStorage('json', invalid).then(() => 'opened')).rejects.toMatchObject({ code: 'invalid-input' })
})

it.each(['text', 'artifact-revision', 'rewritten-artifact', 'matching-character-count', 'matching-byte-count'] as const)('rejects persisted artifact corruption: %s', async (change) => {
  const h = await useStorage('json', limits)
  const owner = actor(join(h.root, 'author'))
  const novel = await h.service.createNovel(owner, { requestId: requestId('original'), title: '远航', brief: '原始要求。' })
  await h.service.close()
  const file = join(h.root, 'data', 'story_writing.json')
  const document: { tables: { artifacts: Record<string, ArtifactRecord>; novels: Record<string, NovelRecord> } } = JSON.parse(await readFile(file, 'utf8'))
  const artifact = document.tables.artifacts[novel.brief.id]
  const reference = document.tables.novels[novel.id]?.briefHistory[0]
  if (artifact === undefined || reference === undefined) throw new Error('Persisted fixture version is missing')
  if (change === 'text') artifact.text = '变造要求。'
  if (change === 'artifact-revision') artifact.revision = 2
  if (change === 'rewritten-artifact') {
    artifact.text = '变造后的不同文本。'
    artifact.sha256 = createHash('sha256').update(artifact.text).digest('hex')
    artifact.chars = [...artifact.text].length
    artifact.bytes = Buffer.byteLength(artifact.text, 'utf8')
  }
  if (change === 'matching-character-count') {
    artifact.chars += 1
    reference.chars = artifact.chars
  }
  if (change === 'matching-byte-count') {
    artifact.bytes += 1
    reference.bytes = artifact.bytes
  }
  const corrupted = `${JSON.stringify(document, null, 2)}\n`
  await writeFile(file, corrupted)
  await h.restart()
  const exact = { novelId: novel.id, artifactId: novel.brief.id }
  expect(() => h.service.getArtifact(owner, exact)).toThrowError(expect.objectContaining({ code: 'corrupt-artifact' }))
  expect(() => h.service.readArtifact(owner, { ...exact, offset: 0, limit: 1 })).toThrowError(expect.objectContaining({ code: 'corrupt-artifact' }))
  expect(await readFile(file, 'utf8')).toBe(corrupted)
})

describe.each(['json', 'sqlite'] as const)('%s writing service', (backend) => {
  it('creates a novel whose initial creative brief is readable', async () => {
    const h = await useStorage(backend, limits)
    const owner = actor(join(h.root, 'author'))
    const novel = await h.service.createNovel(owner, {
      requestId: requestId('create-a'), title: '雾港', brief: '侦探在雾港寻找失踪的航船。',
    })
    expect(novel).toMatchObject({ title: '雾港', workspace: owner.workspace, revision: 1 })
    expect(novel.id).toMatch(/^novel_[0-9a-f-]{36}$/)
    expect(h.service.getNovel(owner, novel.id)).toEqual(novel)
    expect(h.service.getArtifact(owner, { novelId: novel.id, artifactId: novel.brief.id })).toMatchObject({
      novelId: novel.id, kind: 'creative-brief', revision: 1, text: '侦探在雾港寻找失踪的航船。',
    })
  })

  it('rejects blank creative input and invalid revisions without publishing a version', async () => {
    const h = await useStorage(backend, limits)
    const owner = actor(join(h.root, 'author'))
    for (const input of [{ title: '  ', brief: '要求。' }, { title: '小说', brief: '\n\t' }]) {
      await expect(h.service.createNovel(owner, { requestId: requestId('blank'), ...input })).rejects.toMatchObject({ code: 'invalid-input' })
    }
    expect(h.service.listNovels(owner)).toEqual([])
    const novel = await h.service.createNovel(owner, { requestId: requestId('initial'), title: '远航', brief: '原始要求。' })
    for (const input of [{ expectedRevision: 1, text: '   ' }, { expectedRevision: 0, text: '要求。' }, { expectedRevision: 1.5, text: '要求。' }, { expectedRevision: Number.POSITIVE_INFINITY, text: '要求。' }]) {
      await expect(h.service.saveBrief(owner, { novelId: novel.id, requestId: requestId('invalid'), ...input })).rejects.toMatchObject({ code: 'invalid-input' })
    }
    expect(h.service.getNovel(owner, novel.id)).toEqual(novel)
  })

  it('checks workspace ownership and exact novel membership on reads and writes', async () => {
    const h = await useStorage(backend, limits)
    const owner = actor(join(h.root, 'author'))
    const outsider = actor(join(h.root, 'outsider'))
    const novel = await h.service.createNovel(owner, { requestId: requestId('first'), title: '远航', brief: '原始要求。' })
    const another = await h.service.createNovel(owner, { requestId: requestId('second'), title: '迷雾', brief: '其他要求。' })
    const exact = { novelId: novel.id, artifactId: novel.brief.id }
    expect(() => h.service.getNovel(outsider, novel.id)).toThrowError(expect.objectContaining({ code: 'workspace-mismatch' }))
    expect(() => h.service.getArtifact(outsider, exact)).toThrowError(expect.objectContaining({ code: 'workspace-mismatch' }))
    expect(() => h.service.readArtifact(outsider, { ...exact, offset: 0, limit: 1 })).toThrowError(expect.objectContaining({ code: 'workspace-mismatch' }))
    await expect(h.service.selectNovel(outsider, novel.id)).rejects.toMatchObject({ code: 'workspace-mismatch' })
    await expect(h.service.saveBrief(outsider, { novelId: novel.id, requestId: requestId('outside'), expectedRevision: 1, text: '要求。' })).rejects.toMatchObject({ code: 'workspace-mismatch' })
    expect(() => h.service.getArtifact(owner, { novelId: another.id, artifactId: novel.brief.id })).toThrowError(expect.objectContaining({ code: 'artifact-not-found' }))
    expect(h.service.getNovel(owner, novel.id)).toEqual(novel)
    expect(h.service.getSelection(outsider)).toBeNull()
  })

  it('lists workspace novels and restores an explicitly selected novel after restart', async () => {
    const h = await useStorage(backend, limits)
    const owner = actor(join(h.root, 'author'))
    const otherSession = actor(owner.workspace, 'session-b')
    const otherWorkspace = actor(join(h.root, 'other-author'))
    expect(h.service.listNovels(owner)).toEqual([])
    const novel = await h.service.createNovel(owner, {
      requestId: requestId('create-a'), title: '雾港', brief: '调查失踪船。',
    })
    expect(h.service.getSelection(owner)).toBeNull()
    expect(await h.service.selectNovel(owner, novel.id)).toEqual(novel)
    expect(h.service.getSelection(otherSession)).toBeNull()
    expect(h.service.listNovels(otherWorkspace)).toEqual([])
    await h.restart()
    expect(h.service.getSelection(owner)).toEqual(novel)
    expect(h.service.listNovels(owner)).toEqual([novel])
    expect(h.service.getArtifact(owner, { novelId: novel.id, artifactId: novel.brief.id }).text).toBe('调查失踪船。')
  })

  it('saves a new brief while retaining the exact old version across restart', async () => {
    const h = await useStorage(backend, limits)
    const owner = actor(join(h.root, 'author'))
    const first = await h.service.createNovel(owner, {
      requestId: requestId('create-a'), title: '雾港', brief: '调查失踪船。',
    })
    const second = await h.service.saveBrief(owner, {
      novelId: first.id, requestId: requestId('brief-2'), expectedRevision: 1, text: '寻找失踪船上的妹妹。',
    })
    expect(second.revision).toBe(2)
    expect(second.brief.id).not.toBe(first.brief.id)
    expect(second.briefHistory).toEqual([first.brief, second.brief])
    await h.restart()
    expect(h.service.getNovel(owner, first.id)).toEqual(second)
    expect(h.service.getArtifact(owner, { novelId: first.id, artifactId: first.brief.id }).text).toBe('调查失踪船。')
    expect(h.service.getArtifact(owner, { novelId: first.id, artifactId: second.brief.id }).text).toBe('寻找失踪船上的妹妹。')
  })

  it('rejects stale revisions when two Sessions save the same novel concurrently', async () => {
    const h = await useStorage(backend, limits)
    const owner = actor(join(h.root, 'author'))
    const novel = await h.service.createNovel(owner, {
      requestId: requestId('create-a'), title: '雾港', brief: '初稿要求。',
    })
    const first = h.service.saveBrief(owner, {
      novelId: novel.id, requestId: requestId('edit-a'), expectedRevision: 1, text: '第一位作者的要求。',
    })
    const second = h.service.saveBrief(actor(owner.workspace, 'session-b'), {
      novelId: novel.id, requestId: requestId('edit-b'), expectedRevision: 1, text: '第二位作者的要求。',
    })
    expect(h.service.getNovel(owner, novel.id).revision).toBe(1)
    const settled = await Promise.allSettled([first, second])
    const accepted = settled.filter(result => result.status === 'fulfilled')
    const rejected = settled.filter(result => result.status === 'rejected')
    expect(accepted).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ reason: { code: 'revision-conflict' } })
    const current = h.service.getNovel(owner, novel.id)
    expect(current.revision).toBe(2)
    expect(current.briefHistory).toHaveLength(2)
    await expect(h.service.saveBrief(owner, {
      novelId: novel.id, requestId: requestId('stale-edit'), expectedRevision: 1, text: '已过期的要求。',
    })).rejects.toMatchObject({ code: 'revision-conflict' })
    expect(h.service.getNovel(owner, novel.id)).toEqual(current)
  })

  it('deduplicates concurrent creation requests and rejects conflicting retries after restart', async () => {
    const h = await useStorage(backend, limits)
    const owner = actor(join(h.root, 'author'))
    const request = { requestId: requestId('create-a'), title: '雾港', brief: '寻找失踪船。' }
    const [first, duplicate] = await Promise.all([
      h.service.createNovel(owner, request),
      h.service.createNovel(actor(owner.workspace, 'session-b'), request),
    ])
    expect(duplicate).toEqual(first)
    expect(h.service.listNovels(owner)).toEqual([first])
    await h.restart()
    expect(await h.service.createNovel(owner, request)).toEqual(first)
    await expect(h.service.createNovel(owner, { ...request, brief: '不同的创作要求。' })).rejects.toMatchObject({ code: 'request-conflict' })
    expect(h.service.listNovels(owner)).toEqual([first])
  })

  it('replays the original saved version without overwriting a later brief', async () => {
    const h = await useStorage(backend, limits)
    const owner = actor(join(h.root, 'author'))
    const creation = { requestId: requestId('create-a'), title: '雾港', brief: '初始要求。' }
    const novel = await h.service.createNovel(owner, creation)
    const request = { novelId: novel.id, requestId: requestId('brief-2'), expectedRevision: 1, text: '第二版要求。' }
    const [second, duplicate] = await Promise.all([
      h.service.saveBrief(owner, request),
      h.service.saveBrief(actor(owner.workspace, 'session-b'), request),
    ])
    expect(duplicate).toEqual(second)
    const third = await h.service.saveBrief(owner, {
      novelId: novel.id, requestId: requestId('brief-3'), expectedRevision: 2, text: '第三版要求。',
    })
    await h.restart()
    expect(await h.service.saveBrief(owner, request)).toEqual(second)
    expect(await h.service.createNovel(owner, creation)).toEqual(novel)
    expect(h.service.getNovel(owner, novel.id)).toEqual(third)
    await expect(h.service.saveBrief(owner, { ...request, text: '复用编号的不同文本。' })).rejects.toMatchObject({ code: 'request-conflict' })
    await expect(h.service.saveBrief(owner, { ...request, requestId: creation.requestId })).rejects.toMatchObject({ code: 'request-conflict' })
    expect(h.service.getNovel(owner, novel.id).briefHistory).toHaveLength(3)
  })

  it('reads exact artifact intervals without splitting Unicode characters or exceeding the limit', async () => {
    const h = await useStorage(backend, limits)
    const owner = actor(join(h.root, 'author'))
    const novel = await h.service.createNovel(owner, {
      requestId: requestId('create-a'), title: '远航', brief: '甲😀乙丙𠀀丁',
    })
    const version = { novelId: novel.id, artifactId: novel.brief.id }
    expect(h.service.readArtifact(owner, { ...version, offset: 1, limit: 2 })).toMatchObject({
      text: '😀乙', offset: 1, nextOffset: 3, totalChars: 6, eof: false,
    })
    expect(h.service.readArtifact(owner, { ...version, offset: 3, limit: 3 })).toMatchObject({
      text: '丙𠀀丁', nextOffset: 6, eof: true,
    })
    expect(h.service.readArtifact(owner, { ...version, offset: 6, limit: 1 })).toMatchObject({ text: '', nextOffset: 6, eof: true })
    for (const [offset, limit] of [[-1, 1], [7, 1], [0.5, 1], [0, 0], [0, 17], [0, Number.POSITIVE_INFINITY]] as const) {
      expect(() => h.service.readArtifact(owner, { ...version, offset, limit })).toThrowError(expect.objectContaining({ code: 'invalid-range' }))
    }
  })

  it('enforces UTF-8 artifact limits before saving and when projecting stored content', async () => {
    const h = await useStorage(backend, { maxArtifactBytes: 8, maxReadChars: 4 })
    const owner = actor(join(h.root, 'author'))
    await expect(h.service.createNovel(owner, {
      requestId: requestId('too-large'), title: '远航', brief: '甲乙丙',
    })).rejects.toMatchObject({ code: 'artifact-too-large' })
    expect(h.service.listNovels(owner)).toEqual([])
    const novel = await h.service.createNovel(owner, {
      requestId: requestId('create-a'), title: '远航', brief: '甲乙',
    })
    expect(novel.brief).toMatchObject({ chars: 2, bytes: 6 })
    await expect(h.service.saveBrief(owner, {
      novelId: novel.id, requestId: requestId('too-large-save'), expectedRevision: 1, text: '甲乙丙',
    })).rejects.toMatchObject({ code: 'artifact-too-large' })
    expect(h.service.getNovel(owner, novel.id)).toEqual(novel)
    await h.restart({ maxArtifactBytes: 4, maxReadChars: 4 })
    expect(() => h.service.getArtifact(owner, { novelId: novel.id, artifactId: novel.brief.id })).toThrowError(expect.objectContaining({ code: 'artifact-too-large' }))
  })

  it.each(['create', 'save'] as const)('does not publish a cancelled %s after its artifact becomes durable', async (operation) => {
    const h = await useStorage(backend, limits)
    const owner = actor(join(h.root, 'author'))
    const novel = await h.service.createNovel(owner, { requestId: requestId('initial'), title: '远航', brief: '原始要求。' })
    const controller = new AbortController()
    let unpublished: ArtifactId | undefined
    h.onArtifactStored((id) => { unpublished = id; controller.abort() })
    const caller = { ...owner, signal: controller.signal }
    const pending = operation === 'create'
      ? h.service.createNovel(caller, { requestId: requestId('cancelled'), title: '迷雾', brief: '新的要求。' })
      : h.service.saveBrief(caller, { novelId: novel.id, requestId: requestId('cancelled'), expectedRevision: 1, text: '新的要求。' })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(unpublished).toBeDefined()
    expect(h.service.getNovel(owner, novel.id)).toEqual(novel)
    expect(() => h.service.getArtifact(owner, { novelId: novel.id, artifactId: unpublished! })).toThrowError(expect.objectContaining({ code: 'artifact-not-found' }))
    await h.restart()
    expect(h.service.listNovels(owner)).toEqual([novel])
  })

  it('drains an in-flight save on close without publishing it or accepting new writes', async () => {
    const h = await useStorage(backend, limits)
    const owner = actor(join(h.root, 'author'))
    const novel = await h.service.createNovel(owner, { requestId: requestId('initial'), title: '远航', brief: '原始要求。' })
    let closing: Promise<void> | undefined
    let operationSettled = false
    let settledAtClose: boolean | undefined
    h.onArtifactStored(() => { closing = h.service.close().then(() => { settledAtClose = operationSettled }) })
    const pending = h.service.saveBrief(owner, {
      novelId: novel.id, requestId: requestId('interrupted'), expectedRevision: 1, text: '关闭期间的要求。',
    })
    void pending.then(() => { operationSettled = true }, () => { operationSettled = true })
    await expect(pending).rejects.toMatchObject({ code: 'closed' })
    expect(closing).toBeDefined()
    await closing
    expect(settledAtClose).toBe(true)
    await expect(h.service.createNovel(owner, { requestId: requestId('initial'), title: '远航', brief: '原始要求。' })).rejects.toMatchObject({ code: 'closed' })
    await expect(h.service.createNovel(owner, { requestId: requestId('after-close'), title: '新小说', brief: '新要求。' })).rejects.toMatchObject({ code: 'closed' })
    await expect(h.service.selectNovel(owner, novel.id)).rejects.toMatchObject({ code: 'closed' })
    await h.restart()
    expect(h.service.getNovel(owner, novel.id)).toEqual(novel)
    expect(h.service.listNovels(owner)).toEqual([novel])
  })
})
