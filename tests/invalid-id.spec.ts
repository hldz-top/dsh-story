import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, ToolCallId, type ToolResultMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as DomainStorage from '@deepseek-ai/dsh-storage-domain'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as Present from '@deepseek-ai/dsh-tool-present'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import * as Story from '../src/index.ts'
import { WritingError, parseArtifactId, parseNovelId, parseRequestId, type Actor } from '../src/contracts.ts'
import { parseRunId } from '../src/run-store.ts'
import { parseToolNovelId, parseToolRunId } from '../src/tools.ts'
import { mountPluginRuntime } from './support/plugin-runtime.ts'
import { call, ScriptedModel, stop } from './support/model.ts'

const uuid = '00c38d7c-50d8-4a1b-93f0-188daf5a9859'
const novelMessage = 'novelId must look like novel_<uuid>'
const runMessage = 'runId must look like run_<uuid>'
const artifactId = `artifact_${uuid}`
const attemptId = `attempt_${uuid}`
const zodDump = /invalid_format|invalid_type|ZodError|"origin"|"pattern"/

/** Malformed values the tool must reject. Negative rows, then boundary rows. */
function malformed(prefix: 'novel' | 'run'): readonly (readonly [string, unknown])[] {
  const other = prefix === 'novel' ? 'run' : 'novel'
  return [
    ['garbage string', 'not-an-id'],
    ['wrong prefix', `${other}_${uuid}`],
    ['empty string', ''],
    ['non-string', 1],
    ['non-string null', null],
    ['prefix only', `${prefix}_`],
    ['wrong length', `${prefix}_${uuid.slice(0, -1)}`],
    ['uppercase', `${prefix}_${uuid.toUpperCase()}`],
    ['surrounding whitespace', ` ${prefix}_${uuid} `],
  ]
}

const novelTools = [
  'story_complete_research', 'story_get_manuscript', 'story_get_novel', 'story_get_research', 'story_get_settings',
  'story_list_research', 'story_list_runs', 'story_preview', 'story_read_artifact', 'story_read_research_source',
  'story_research_results', 'story_revise', 'story_save_brief', 'story_select_novel', 'story_settings_import',
  'story_start_research', 'story_update', 'story_write',
]
const runTools = ['story_get_run', 'story_read_run_output', 'story_resume', 'story_stop']

function novelCall(name: string, novelId: unknown): Record<string, unknown> {
  const scope = { novelId, briefArtifactId: artifactId, requestId: 'request-1', settingsRoots: ['e1'], chapterCount: 1, fromChapter: 1, throughChapter: 1 }
  switch (name) {
    case 'story_save_brief':
      return { novelId, requestId: 'request-1', expectedRevision: 1, text: '下一版。' }
    case 'story_read_artifact':
      return { novelId, artifactId, offset: 0, limit: 8 }
    case 'story_get_novel':
    case 'story_select_novel':
    case 'story_get_settings':
    case 'story_get_manuscript':
    case 'story_list_runs':
    case 'story_list_research':
      return { novelId }
    case 'story_preview':
      return { novelId, artifactId }
    case 'story_write':
    case 'story_update':
      return scope
    case 'story_revise':
      return { ...scope, baseArtifactId: artifactId, instructions: '改开场。' }
    case 'story_settings_import':
      return { novelId, requestId: 'request-1', dimensionCode: 'a1', expectedAppliedId: artifactId, output: '{}' }
    case 'story_start_research':
      return { novelId, requestId: 'request-1', briefArtifactId: artifactId, questions: [{ id: 'genre', kind: 'creative', question: '体裁？', reason: '作者决定。' }] }
    case 'story_get_research':
    case 'story_research_results':
      return { novelId, planId: artifactId }
    case 'story_read_research_source':
      return { novelId, planId: artifactId, callId: 'call-1', sourceIndex: 0, offset: 0, limit: 1 }
    case 'story_complete_research':
      return { novelId, planId: artifactId, requestId: 'request-1', findings: [{ questionId: 'genre', callIds: [], conclusion: '悬疑。', adequate: true, selections: [] }] }
    default:
      throw new Error(`unexpected novel tool ${name}`)
  }
}

function runCall(name: string, runId: unknown): Record<string, unknown> {
  switch (name) {
    case 'story_resume':
      return { runId, retryUnknown: false }
    case 'story_stop':
    case 'story_get_run':
      return { runId }
    case 'story_read_run_output':
      return { runId, attemptId, offset: 0, limit: 1 }
    default:
      throw new Error(`unexpected run tool ${name}`)
  }
}

function parameterNames(schema: { readonly parameters: Record<string, unknown> }): string[] {
  const properties = schema.parameters.properties
  return typeof properties === 'object' && properties !== null ? Object.keys(properties) : []
}

function errorText(outcome: ToolExecutionResult, label: string): string {
  expect(outcome.isError, label).toBe(true)
  if (!outcome.isError) throw new Error(`${label} succeeded`)
  expect(outcome.content, label).toEqual([{ type: 'text', text: expect.any(String) }])
  const block = outcome.content[0]
  if (block?.type !== 'text') throw new Error(`${label} has no text`)
  expect(block.text, label).not.toMatch(zodDump)
  expect(outcome.error.message, label).not.toMatch(zodDump)
  expect(block.text, label).toBe(`Error: ${outcome.error.message}`)
  return block.text
}

function expectWritingError(value: unknown, message: string): void {
  try {
    if (message === novelMessage) parseToolNovelId(value)
    else parseToolRunId(value)
    throw new Error('expected WritingError')
  } catch (error) {
    expect(error).toBeInstanceOf(WritingError)
    if (!(error instanceof WritingError)) throw error
    expect(error.code).toBe('invalid-input')
    expect(error.message).toBe(message)
    expect(error.message).not.toMatch(zodDump)
    expect(error).not.toBeInstanceOf(z.ZodError)
  }
}

async function setup(model = new ScriptedModel(() => stop())) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-story-invalid-id-'))
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
  await ctx.plugin(Present, new Present.Config())
  ctx.effect(() => ctx.llm.registerAdapter(['fixture'], model))
  await ctx.plugin(Story, new Story.Config({ ...new Story.Config(), maxArtifactBytes: 100_000, maxReadChars: 1024, previewDirectory: '.dsh-story', allowSettingsImport: true }))
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId(randomUUID()), { provider: 'fixture', model: 'deterministic' }, { cwd })
  const execute = (name: string, args: Record<string, unknown>) => ctx.tools.execute({
    callId: ToolCallId(randomUUID()), name, arguments: args, agent, signal: new AbortController().signal,
  })
  const workspace = agent.session.header.cwd
  if (workspace === undefined) throw new Error('Session has no workspace')
  const actor: Actor = { sessionId: agent.session.id, workspace: (await ctx.fs.resolve('.', { cwd: workspace })).displayPath }
  return { ctx, agent, actor, execute }
}

it('keeps valid novel and run ids and turns malformed ones into WritingError invalid-input', () => {
  const novelId = `novel_${uuid}`
  const runId = `run_${uuid}`
  expect(parseToolNovelId(novelId)).toBe(novelId)
  expect(parseToolRunId(runId)).toBe(runId)
  const generated = randomUUID()
  expect(parseToolNovelId(`novel_${generated}`)).toBe(`novel_${generated}`)
  expect(parseToolRunId(`run_${generated}`)).toBe(`run_${generated}`)
  expect(() => parseNovelId('not-an-id')).toThrow(z.ZodError)
  expect(() => parseRunId('not-an-id')).toThrow(z.ZodError)
  for (const [, value] of malformed('novel')) expectWritingError(value, novelMessage)
  for (const [, value] of malformed('run')) expectWritingError(value, runMessage)
})

it('rejects a malformed novelId or runId from every tool without a zod dump', async () => {
  const { ctx, execute } = await setup()
  const names = (key: 'novelId' | 'runId') => ctx.tools.schemas().flatMap(schema => parameterNames(schema).includes(key) ? [schema.name] : []).sort()
  expect(names('novelId')).toEqual([...novelTools].sort())
  expect(names('runId')).toEqual([...runTools].sort())
  for (const [label, value] of malformed('novel')) {
    for (const name of novelTools) {
      const text = errorText(await execute(name, novelCall(name, value)), `${name} ${label}`)
      expect(text, `${name} ${label}`).toBe(`Error: ${novelMessage}`)
    }
  }
  for (const [label, value] of malformed('run')) {
    for (const name of runTools) {
      const text = errorText(await execute(name, runCall(name, value)), `${name} ${label}`)
      expect(text, `${name} ${label}`).toBe(`Error: ${runMessage}`)
    }
  }
})

it('still runs every id-taking tool when the novelId or runId is valid', async () => {
  const { ctx, actor, execute } = await setup()
  const brief = '守塔人找到了失踪日志。'
  const created = await ctx.story.createNovel(actor, { requestId: parseRequestId('create-id'), title: '潮汐城', brief })
  const novelId = created.id
  const read = async (name: string, args: Record<string, unknown>) => {
    const outcome = await execute(name, args)
    if (outcome.isError) throw new Error(`${name} failed: ${outcome.error.message}`)
    return outcome.value
  }
  const refused = async (name: string, args: Record<string, unknown>) => errorText(await execute(name, args), name)
  expect(await read('story_get_novel', { novelId })).toMatchObject({ id: novelId, title: '潮汐城', revision: 1 })
  expect(await read('story_select_novel', { novelId })).toMatchObject({ id: novelId })
  expect(await read('story_read_artifact', { novelId, artifactId: created.brief.id, offset: 0, limit: 1024 })).toMatchObject({ text: brief, eof: true, view: 'stored' })
  expect(await read('story_preview', { novelId, artifactId: created.brief.id })).toMatchObject({ kind: 'story-artifact-preview', novelId, artifactId: created.brief.id })
  expect(await read('story_get_settings', { novelId })).toEqual({ novelId, applied: [], history: [] })
  expect(await read('story_get_manuscript', { novelId })).toEqual({ novelId, history: [], heads: [], appliedChapters: [] })
  expect(await read('story_list_runs', { novelId })).toEqual([])
  expect(await read('story_list_research', { novelId })).toEqual([])
  const scope = { novelId, briefArtifactId: created.brief.id, requestId: 'write-id', settingsRoots: ['e1'], chapterCount: 1, fromChapter: 1, throughChapter: 1 }
  for (const name of ['story_write', 'story_update'] as const) {
    const text = await refused(name, scope)
    expect(text).toContain('settings-incomplete')
    expect(text).not.toContain(novelMessage)
  }
  const revised = await refused('story_revise', { ...scope, requestId: 'revise-id', baseArtifactId: created.brief.id, instructions: '改开场。' })
  expect(revised).toContain('settings-incomplete')
  expect(revised).not.toContain(novelMessage)
  const imported = await refused('story_settings_import', { novelId, requestId: 'import-id', dimensionCode: 'missing', expectedAppliedId: created.brief.id, output: '{}' })
  expect(imported).toContain('Settings dimension is not available for import')
  expect(imported).not.toContain(novelMessage)
  const saved = z.object({ id: z.string(), revision: z.number(), brief: z.object({ id: z.string() }) }).parse(await read('story_save_brief', { novelId, requestId: 'save-id', expectedRevision: created.revision, text: '第二版创作要求。' }))
  expect(saved).toMatchObject({ id: novelId, revision: 2 })
  const question = { id: 'genre', kind: 'creative', question: '体裁？', reason: '作者决定。' }
  const plan = z.object({ planId: z.string() }).parse(await read('story_start_research', { novelId, requestId: 'research-id', briefArtifactId: saved.brief.id, questions: [question] }))
  expect(await read('story_get_research', { novelId, planId: plan.planId })).toMatchObject({ novelId, planId: plan.planId })
  expect(await read('story_list_research', { novelId })).toMatchObject([{ planId: plan.planId }])
  expect(await read('story_research_results', { novelId, planId: plan.planId })).toEqual([])
  const source = await refused('story_read_research_source', { novelId, planId: plan.planId, callId: 'call-1', sourceIndex: 0, offset: 0, limit: 1 })
  expect(source).not.toContain(novelMessage)
  expect(await read('story_complete_research', { novelId, planId: plan.planId, requestId: 'complete-id', findings: [{ questionId: 'genre', callIds: [], conclusion: '悬疑。', adequate: true, selections: [] }] })).toMatchObject({ novelId, planId: plan.planId, outcome: 'not-needed' })
  const runner = ctx.storyRunner
  const service = ctx.story
  const run = await runner.runs.begin(actor, {
    novelId, briefArtifactId: parseArtifactId(saved.brief.id), requestId: parseRequestId('run-id'), settingsRoots: ['a1'],
    chapterCount: 1, fromChapter: 1, throughChapter: 1, mode: 'write', revision: null, executionLimits: runner.limits,
    serviceLimits: { ...service.limits, ...service.researchLimits },
  })
  const completed = await runner.runs.finish(actor, run.id, 'completed')
  expect(await read('story_get_run', { runId: completed.id })).toMatchObject({ id: completed.id, status: 'completed' })
  expect(await read('story_stop', { runId: completed.id })).toMatchObject({ id: completed.id, status: 'completed' })
  expect(await read('story_list_runs', { novelId })).toMatchObject([{ id: completed.id }])
  const page = await refused('story_read_run_output', { runId: completed.id, attemptId, offset: 0, limit: 1 })
  expect(page).toContain('Attempt does not belong to this run')
  expect(page).not.toContain(runMessage)
  const resume = await refused('story_resume', { runId: completed.id, retryUnknown: false })
  expect(resume).toContain('Completed runs cannot resume')
  expect(resume).not.toContain(runMessage)
})

it('records the friendly id error in the model-visible tool result', async () => {
  const model = new ScriptedModel((_request, index) => {
    if (index === 0) return call('story_get_novel', { novelId: 'not-an-id' })
    if (index === 1) return call('story_resume', { runId: 'not-a-run', retryUnknown: false })
    if (index === 2) return call('story_select_novel', { novelId: 1 }, 'select-number')
    if (index === 3) return call('story_get_run', { runId: ` ${`run_${uuid}`} ` }, 'get-padded')
    return stop()
  })
  const { agent } = await setup(model)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '读取不存在的标识。' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const request = model.requests.at(-1)
  if (request === undefined) throw new Error('The loop did not record a model request')
  const results = request.messages.filter((message): message is ToolResultMessage => message.role === 'tool')
  const texts = results.flatMap(result => result.content.flatMap(block => block.type === 'text' ? [block.text] : []))
  expect(texts).toEqual([
    `Error: ${novelMessage}`,
    `Error: ${runMessage}`,
    `Error: ${novelMessage}`,
    `Error: ${runMessage}`,
  ])
  expect(texts.join('\n')).not.toMatch(zodDump)
  const logged = agent.session.snapshotEvents().flatMap(event => event.type === 'tool/result'
    ? event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : [])
    : [])
  expect(logged).toEqual(texts)
})
