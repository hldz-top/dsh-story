import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, type GenerateOptions, type ToolResultMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as DomainStorage from '@deepseek-ai/dsh-storage-domain'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import * as Story from '../src/index.ts'
import { mountPluginRuntime } from './support/plugin-runtime.ts'
import { parseStoryArtifactPreview } from '../src/preview-result.ts'
import { call, ScriptedModel, stop } from './support/model.ts'

async function setup(model: ScriptedModel) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-story-tools-'))
  const cwd = join(root, 'novel-workspace')
  await mkdir(cwd)
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await mountAgentLoopTestDependencies(ctx)
  await mountPluginRuntime(ctx, root)
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(root, 'storage') })
  await ctx.plugin(DomainStorage, { backend: 'json' })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  ctx.effect(() => ctx.llm.registerAdapter(['fixture'], model))
  await ctx.plugin(Story, new Story.Config({ ...new Story.Config(), maxArtifactBytes: 100_000, maxReadChars: 1024, previewDirectory: '.dsh-story' }))
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId(randomUUID()), { provider: 'fixture', model: 'deterministic' }, { cwd })
  return { ctx, agent, root, cwd }
}

function results(request: GenerateOptions): ToolResultMessage[] {
  return request.messages.filter((message): message is ToolResultMessage => message.role === 'tool')
}

function resultValue(request: GenerateOptions): unknown {
  const result = results(request).at(-1)
  if (result?.isError !== false || result.content.length !== 1 || result.content[0]?.type !== 'text') {
    throw new Error('Expected one successful JSON tool result')
  }
  return JSON.parse(result.content[0].text) as unknown
}

it('creates a novel through the real AgentLoop and records the complete tool result', async () => {
  const model = new ScriptedModel((_request, index) => index === 0
    ? call('story_create_novel', { requestId: 'create-tide', title: '潮汐城', brief: '修钟师在暴风雨前找到一份失踪日志。' })
    : stop())
  const { agent } = await setup(model)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '创建潮汐城小说并保存创作要求。' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(2)
  const saved = results(model.requests[1]!).at(-1)
  expect(saved?.isError).toBe(false)
  expect(saved?.content).toHaveLength(1)
  expect(saved?.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('潮汐城') })
})

it('projects the exact artifact under the Session workspace and returns a stable preview link', async () => {
  const brief = '潮汐城的修钟师追查一艘无人归来的船。\n'.repeat(700) + '末页标记：钟声归来。'
  const model = new ScriptedModel((request, index) => {
    if (index === 0) return call('story_create_novel', { requestId: 'preview-tide', title: '潮汐城', brief })
    if (index === 1) {
      const novel = z.object({ id: z.string(), brief: z.object({ id: z.string() }) }).parse(resultValue(request))
      return call('story_preview', { novelId: novel.id, artifactId: novel.brief.id })
    }
    return stop()
  })
  const { agent, cwd } = await setup(model)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '保存创作要求，并打开其完整版本。' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(3)
  const preview = parseStoryArtifactPreview(resultValue(model.requests[2]!))
  expect(preview).toMatchObject({ kind: 'story-artifact-preview', version: 1, revision: 1 })
  expect(preview!.path.startsWith(join(cwd, '.dsh-story') + '/')).toBe(true)
  expect(await readFile(preview!.path, 'utf8')).toBe(brief)
  const recorded = agent.session.snapshotEvents().findLast(event => event.type === 'tool/result')
  expect(recorded?.data.meta).toEqual(preview)
})

it('reopens an existing exact preview without rewriting or creating another source version', async () => {
  let novel: { id: string; brief: { id: string } }
  const model = new ScriptedModel((request, index) => {
    if (index === 0) return call('story_create_novel', { requestId: 'reopen-tide', title: '潮汐城', brief: '同一份创作要求。' })
    if (index === 1) novel = z.object({ id: z.string(), brief: z.object({ id: z.string() }) }).parse(resultValue(request))
    if (index === 1 || index === 2) return call('story_preview', { novelId: novel.id, artifactId: novel.brief.id }, `preview-${index}`)
    return stop()
  })
  const { agent } = await setup(model)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '两次查看同一版本。' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(4)
  expect(resultValue(model.requests[3]!)).toEqual(resultValue(model.requests[2]!))
})

it('selects a novel explicitly and returns that selection through the real tool loop', async () => {
  const model = new ScriptedModel((request, index) => {
    if (index === 0) return call('story_create_novel', { requestId: 'select-tide', title: '潮汐城', brief: '修钟师寻找失踪日志。' })
    if (index === 1) {
      const novel = z.object({ id: z.string() }).parse(resultValue(request))
      return call('story_select_novel', { novelId: novel.id })
    }
    if (index === 2) return call('story_get_selection', {})
    return stop()
  })
  const { agent } = await setup(model)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '创建并选择潮汐城。' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(4)
  expect(resultValue(model.requests[3]!)).toEqual(resultValue(model.requests[2]!))
})

it('saves a new brief while reading the exact earlier version in Unicode pages', async () => {
  const original = '潮🌊汐城钟楼'
  let novel: { id: string; revision: number; brief: { id: string } }
  const model = new ScriptedModel((request, index) => {
    if (index === 0) return call('story_create_novel', { requestId: 'versioned', title: '潮汐城', brief: original })
    if (index === 1) {
      novel = z.object({ id: z.string(), revision: z.number(), brief: z.object({ id: z.string() }) }).parse(resultValue(request))
      return call('story_save_brief', { novelId: novel.id, requestId: 'revision-2', expectedRevision: novel.revision, text: '第二版创作要求。' })
    }
    if (index === 2) return call('story_read_artifact', { novelId: novel.id, artifactId: novel.brief.id, offset: 0, limit: 2 }, 'read-first')
    if (index === 3) {
      const page = z.object({ nextOffset: z.number() }).parse(resultValue(request))
      return call('story_read_artifact', { novelId: novel.id, artifactId: novel.brief.id, offset: page.nextOffset, limit: 1024 }, 'read-rest')
    }
    if (index === 4) return call('story_get_novel', { novelId: novel.id })
    if (index === 5) return call('story_list_novels', {})
    return stop()
  })
  const { agent } = await setup(model)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '修改创作要求，再分段读取初版。' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(7)
  const revised = resultValue(model.requests[2]!)
  expect(revised).toMatchObject({ revision: 2, briefHistory: [{ revision: 1 }, { revision: 2 }] })
  expect(resultValue(model.requests[3]!)).toMatchObject({ text: '潮🌊', offset: 0, nextOffset: 2, eof: false, revision: 1 })
  expect(resultValue(model.requests[3]!)).toMatchInlineSnapshot({
    novelId: expect.any(String), artifactId: expect.any(String),
  }, `
    {
      "artifactId": Any<String>,
      "eof": false,
      "kind": "creative-brief",
      "nextOffset": 2,
      "novelId": Any<String>,
      "offset": 0,
      "revision": 1,
      "sha256": "349ee448ecb2fe2abe0233480858ff4be7f1d43c9a89db2b7e326d4952749250",
      "text": "潮🌊",
      "totalChars": 6,
      "view": "stored",
    }
  `)
  expect(resultValue(model.requests[4]!)).toMatchObject({ text: '汐城钟楼', offset: 2, nextOffset: 6, eof: true, revision: 1 })
  expect(resultValue(model.requests[5]!)).toEqual(revised)
  expect(resultValue(model.requests[6]!)).toEqual([revised])
})
