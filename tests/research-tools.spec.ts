import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
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
import WebRuntime from '@deepseek-ai/dsh-web'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import { expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import * as Story from '../src/index.ts'
import { mountPluginRuntime } from './support/plugin-runtime.ts'
import { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { call, ScriptedModel, stop } from './support/model.ts'
import { parseNovelId, parseArtifactId } from '../src/contracts.ts'

function lastResult(request: GenerateOptions): unknown {
  const result = request.messages.findLast((message): message is ToolResultMessage => message.role === 'tool')
  if (result?.isError !== false || result.content.length !== 1 || result.content[0]?.type !== 'text') throw new Error('Expected successful writing result')
  return JSON.parse(result.content[0].text) as unknown
}

it.each([false, true])('archives mixed native references and reopens the exact failed or insufficient preview (fetch fails: %s)', async failedFetch => {
  let novelId = ''
  let planId = ''
  let evidenceId = ''
  let observations: unknown
  const model = new ScriptedModel((request, index) => {
    if (index === 0) return call('story_create_novel', { requestId: 'mixed-novel', title: 'Lighthouse', brief: 'Investigate a navigation signal.' })
    if (index === 1) {
      const novel = z.object({ id: z.string(), brief: z.object({ id: z.string() }) }).parse(lastResult(request))
      novelId = novel.id
      return call('story_start_research', { novelId, briefArtifactId: novel.brief.id, requestId: 'mixed-plan',
        questions: [{ id: 'signal', kind: 'external', question: 'What does the signal mean?', reason: 'Navigation needs evidence.' }] })
    }
    if (index === 2) {
      planId = z.object({ planId: z.string() }).parse(lastResult(request)).planId
      return call('web_search', { queries: ['navigation signal'] }, 'mixed-search')
    }
    if (failedFetch && index === 3) return call('web_fetch', { url: 'https://example.test/signal' }, 'blocked-fetch')
    const phase = index - (failedFetch ? 1 : 0)
    if (phase === 3) return call('story_research_results', { novelId, planId })
    if (phase === 4) {
      observations = lastResult(request)
      return call('story_complete_research', { novelId, planId, requestId: 'mixed-complete', findings: [{ questionId: 'signal',
        callIds: failedFetch ? ['mixed-search', 'blocked-fetch'] : ['mixed-search'], selections: [], conclusion: 'No usable source text was retrieved.', adequate: true }] })
    }
    if (phase === 5) return call('story_get_research', { novelId, planId })
    if (phase === 6) evidenceId = z.object({ result: z.object({ id: z.string() }) }).parse(lastResult(request)).result.id
    if (phase === 6 || phase === 7) return call('story_preview', { novelId, artifactId: evidenceId }, `mixed-preview-${phase}`)
    return stop()
  })
  const root = await mkdtemp(join(tmpdir(), 'dsh-story-mixed-research-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx)
  await mountPluginRuntime(ctx, root)
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(root, 'storage') })
  await ctx.plugin(DomainStorage, { backend: 'json' })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(WebRuntime, { searchProvider: 'mixed-search-provider', fetchProvider: 'blocked-fetch-provider' })
  ctx.effect(() => ctx.web.registerSearchProvider({ id: 'mixed-search-provider', available: () => true, search: async () => ({
    sources: [{ url: 'https://example.test/signal', title: 'Signal' }, { url: '/hdd/signal.pdf#page=2', title: 'Unresolved signal' }], truncated: false,
  }) }))
  ctx.effect(() => ctx.web.registerFetchProvider({ id: 'blocked-fetch-provider', available: () => true, fetch: async () => { throw new Error('WEB_BLOCKED_URL: non-public address') } }))
  await ctx.plugin(ToolWeb, { searchMaxQueries: 4, searchMaxResults: 8, searchTimeoutMs: 5000, fetchTimeoutMs: 5000, fetchMaxOutputChars: 10000 })
  ctx.effect(() => ctx.llm.registerAdapter(['fixture'], model))
  await ctx.plugin(Story, new Story.Config())
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId(randomUUID()), { provider: 'fixture', model: 'deterministic' }, { cwd: root })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Record the actual research outcome and preview it.' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(observations).toBeDefined()
  expect(observations).toMatchObject([{ status: 'succeeded', error: null,
    sources: [{ sourceIndex: 0, url: 'https://example.test/signal', eligibility: 'empty' }],
    rejectedSources: [{ sourceIndex: 1, reference: '/hdd/signal.pdf#page=2', title: 'Unresolved signal', reason: 'unsupported-reference' }] },
  ...(failedFetch ? [{ status: 'failed', sources: [], rejectedSources: [], error: expect.stringContaining('WEB_BLOCKED_URL') }] : [])])
  expect(z.array(z.object({ rejectedSources: z.unknown() })).parse(observations)[0]?.rejectedSources).toMatchInlineSnapshot(`
    [
      {
        "reason": "unsupported-reference",
        "reference": "/hdd/signal.pdf#page=2",
        "sourceIndex": 1,
        "title": "Unresolved signal",
      },
    ]
  `)
  const actor = { workspace: root, sessionId: agent.session.id }
  const plan = ctx.story.getResearch(actor, { novelId: parseNovelId(novelId), planId: parseArtifactId(planId) })
  expect(plan.outcome).toBe(failedFetch ? 'failed' : 'insufficient')
  const saved = ctx.story.getArtifact(actor, { novelId: plan.novelId, artifactId: plan.result!.id })
  expect(JSON.parse(saved.text)).toMatchObject({ version: 3, observations })
  expect(() => ctx.story.settingsInputs(actor, plan.novelId, 'a1', plan.planId)).toThrowError(expect.objectContaining({ code: 'research-incomplete' }))
  const previewValue = lastResult(model.requests.at(-1)!)
  const preview = z.object({ path: z.string(), artifactId: z.string() }).parse(previewValue)
  expect(preview.artifactId).toBe(saved.id)
  expect(lastResult(model.requests.at(-2)!)).toEqual(previewValue)
  const markdown = await readFile(preview.path, 'utf8')
  expect(markdown).toContain(failedFetch ? 'Outcome: Research failed' : 'Outcome: Insufficient evidence')
  expect(markdown).toContain('Rejected source reference')
  expect(markdown).toContain('Original reference (not usable as evidence)\n\n/hdd/signal.pdf&#35;page=2')
  expect(markdown).not.toContain('</hdd/')
})

it('records why an invented setting needs no external research through the actual conversation loop', async () => {
  let novelId: string
  let planId: string
  let evidenceId: string
  const model = new ScriptedModel((request, index) => {
    if (index === 0) return call('story_create_novel', { requestId: 'research-novel', title: '潮汐城', brief: '虚构城市的钟楼会预报风暴。' })
    if (index === 1) {
      const novel = z.object({ id: z.string(), brief: z.object({ id: z.string() }) }).parse(lastResult(request))
      novelId = novel.id
      return call('story_start_research', { novelId, briefArtifactId: novel.brief.id, requestId: 'research-plan', questions: [{ id: 'clock', kind: 'creative', question: '钟楼如何预报风暴？', reason: '这是虚构规则，由创作决定。' }] })
    }
    if (index === 2) {
      planId = z.object({ planId: z.string() }).parse(lastResult(request)).planId
      return call('story_complete_research', { novelId, planId, requestId: 'research-complete', findings: [{ questionId: 'clock', callIds: [], selections: [], conclusion: '钟摆感应海风中的魔力。', adequate: true }] })
    }
    if (index === 3) return call('story_get_research', { novelId, planId })
    if (index === 4) evidenceId = z.object({ result: z.object({ id: z.string() }) }).parse(lastResult(request)).result.id
    if (index === 4 || index === 5) return call('story_preview', { novelId, artifactId: evidenceId }, `research-preview-${index}`)
    return stop()
  })
  const root = await mkdtemp(join(tmpdir(), 'dsh-story-research-tools-'))
  const cwd = join(root, 'workspace')
  await mkdir(cwd)
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx)
  await mountPluginRuntime(ctx, root)
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(root, 'storage') })
  await ctx.plugin(DomainStorage, { backend: 'json' })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  ctx.effect(() => ctx.llm.registerAdapter(['fixture'], model))
  await ctx.plugin(Story, new Story.Config())
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId(randomUUID()), { provider: 'fixture', model: 'deterministic' }, { cwd })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '创建这部小说，并记录钟楼规则无需外部查证。' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(7)
  expect(lastResult(model.requests[4]!)).toMatchObject({ outcome: 'not-needed', stale: false, result: { kind: 'research-evidence' }, reservedCalls: [] })
  expect(lastResult(model.requests[4]!)).toEqual(lastResult(model.requests[3]!))
  const preview = z.object({ path: z.string(), artifactId: z.string() }).parse(lastResult(model.requests[5]!))
  expect(lastResult(model.requests[6]!)).toEqual(lastResult(model.requests[5]!))
  expect(preview.artifactId).toBe(evidenceId!)
  const markdown = await readFile(preview.path, 'utf8')
  expect(markdown).toContain('钟摆感应海风中的魔力。')
  expect(markdown).toContain('Outcome: External research not needed')
})

it('counts approved web calls before dispatch and rejects the next call at the research budget', async () => {
  let novelId: string
  let planId: string
  const fetchedUrls: string[] = []
  const model = new ScriptedModel((request, index) => {
    if (index === 0) return call('story_create_novel', { requestId: 'budget-novel', title: '潮汐城', brief: '查证潮汐对港口的影响。' })
    if (index === 1) {
      const novel = z.object({ id: z.string(), brief: z.object({ id: z.string() }) }).parse(lastResult(request))
      novelId = novel.id
      return call('story_start_research', { novelId, briefArtifactId: novel.brief.id, requestId: 'budget-plan', questions: [{ id: 'tide', kind: 'external', question: '潮汐如何影响港口？', reason: '背景需要可查证的资料。' }] })
    }
    if (index === 2) {
      planId = z.object({ planId: z.string() }).parse(lastResult(request)).planId
      return call('web_fetch', { url: 'https://example.test/first' }, 'approved-first')
    }
    if (index === 3) return call('web_fetch', { url: 'https://example.test/second' }, 'approved-second')
    if (index === 4) return call('story_get_research', { novelId, planId })
    return stop()
  })
  const root = await mkdtemp(join(tmpdir(), 'dsh-story-approved-research-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx)
  await mountPluginRuntime(ctx, root)
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(root, 'storage') })
  await ctx.plugin(DomainStorage, { backend: 'json' })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(ApprovalService, {})
  ctx.on('approval/request', async () => 'allowed-once')
  ctx.on('tools/pre-execute', async (exec, next) => exec.name === 'web_fetch' ? { kind: 'ask' } : next())
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'web_fetch', description: 'Offline body-dispatch witness for the approval and budget integration test.',
    parameters: { url: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { fetchedUrls.push(args.url); return args.url },
  })))
  ctx.effect(() => ctx.llm.registerAdapter(['fixture'], model))
  await ctx.plugin(Story, new Story.Config({ ...new Story.Config(), maxResearchCalls: 1 }))
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId(randomUUID()), { provider: 'fixture', model: 'deterministic' }, { cwd: root })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '查证港口背景，研究只允许一次检索调用。' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(6)
  expect(fetchedUrls).toEqual(['https://example.test/first'])
  const last = model.requests[4]!.messages.findLast((message): message is ToolResultMessage => message.role === 'tool')
  expect(last).toMatchObject({ isError: true })
  expect(last?.content).toMatchInlineSnapshot(`
    [
      {
        "text": "Error: Research native web call limit was reached",
        "type": "text",
      },
    ]
  `)
  expect(lastResult(model.requests[5]!)).toMatchObject({ reservedCalls: [{ callId: 'approved-first', name: 'web_fetch' }] })
})

it('leaves native web tools available to ordinary Sessions without a writing workspace', async () => {
  const model = new ScriptedModel((_request, index) => index === 0 ? call('web_fetch', { url: 'https://example.test/plain' }) : stop())
  const root = await mkdtemp(join(tmpdir(), 'dsh-story-no-workspace-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx)
  await mountPluginRuntime(ctx, root)
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(root, 'storage') })
  await ctx.plugin(DomainStorage, { backend: 'json' })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'web_fetch', description: 'Offline native web availability witness.', parameters: { url: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) { return args.url },
  })))
  ctx.effect(() => ctx.llm.registerAdapter(['fixture'], model))
  await ctx.plugin(Story, new Story.Config())
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId(randomUUID()), { provider: 'fixture', model: 'deterministic' }, {})
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Read this web reference.' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(2)
  expect(lastResult(model.requests[1]!)).toBe('https://example.test/plain')
})

it('selects and previews a later literal source through native tools without repeating retrieval', async () => {
  let novelId = ''
  let planId = ''
  let evidenceId = ''
  let sourceOffset = 0
  let indexValue: unknown
  let pageValue: unknown
  const fetched: string[] = []
  const model = new ScriptedModel((request, index) => {
    if (index === 0) return call('story_create_novel', { requestId: 'selected-novel', title: 'Last Light', brief: 'A fictional island mystery with a real navigation signal.' })
    if (index === 1) {
      const novel = z.object({ id: z.string(), brief: z.object({ id: z.string() }) }).parse(lastResult(request)); novelId = novel.id
      return call('story_start_research', { novelId, briefArtifactId: novel.brief.id, requestId: 'selected-plan', questions: [{ id: 'signal', kind: 'external', question: 'What does the signal say?', reason: 'The actual navigation fact remains unresolved.' }] })
    }
    if (index === 2) {
      planId = z.object({ planId: z.string() }).parse(lastResult(request)).planId
      return call('web_fetch', { url: 'https://example.test/error' }, 'unusable-early')
    }
    if (index === 3) return call('web_fetch', { url: 'https://example.test/source' }, 'useful-late')
    if (index === 4) return call('story_research_results', { novelId, planId })
    if (index === 5) {
      indexValue = lastResult(request)
      const observations = z.array(z.object({ sources: z.array(z.object({ bodyStart: z.number() })) })).parse(indexValue)
      sourceOffset = observations[1]!.sources[0]!.bodyStart
      return call('story_read_research_source', { novelId, planId, callId: 'useful-late', sourceIndex: 0, offset: sourceOffset, limit: 4 }, 'literal-page')
    }
    if (index === 6) {
      pageValue = lastResult(request)
      return call('story_complete_research', { novelId, planId, requestId: 'selected-complete', findings: [{ questionId: 'signal', callIds: ['useful-late'], adequate: true,
        conclusion: 'The recorded navigation message is 潮🌊归航.', selections: [{ callId: 'useful-late', sourceIndex: 0, offset: sourceOffset, limit: 4 }] }] })
    }
    if (index === 7) {
      evidenceId = z.object({ outcome: z.literal('succeeded'), result: z.object({ id: z.string() }) }).parse(lastResult(request)).result.id
      return call('story_get_research', { novelId, planId })
    }
    if (index === 8 || index === 9) return call('story_preview', { novelId, artifactId: evidenceId }, `selected-preview-${index}`)
    return stop()
  })
  const root = await mkdtemp(join(tmpdir(), 'dsh-story-selected-research-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx)
  await mountPluginRuntime(ctx, root)
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(root, 'storage') })
  await ctx.plugin(DomainStorage, { backend: 'json' })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(WebRuntime, { searchProvider: 'unused-search', fetchProvider: 'selection-fetch' })
  ctx.effect(() => ctx.web.registerFetchProvider({ id: 'selection-fetch', available: () => true, fetch: async request => {
    fetched.push(request.url)
    return { url: request.url, statusCode: request.url.endsWith('/error') ? 403 : 200,
      body: { kind: 'text', content: request.url.endsWith('/error') ? 'Security verification. '.repeat(1000) : '潮🌊归航，灯光稳定。' }, truncated: false }
  } }))
  await ctx.plugin(ToolWeb, { searchMaxQueries: 4, searchMaxResults: 8, searchTimeoutMs: 5000, fetchTimeoutMs: 5000, fetchMaxOutputChars: 30000 })
  ctx.effect(() => ctx.llm.registerAdapter(['selection-model'], model))
  await ctx.plugin(Story, new Story.Config({ ...new Story.Config(), maxReadChars: 4, maxEvidenceChars: 1024 }))
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId(randomUUID()), { provider: 'selection-model', model: 'deterministic' }, { cwd: root })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Verify and retain the exact source passage.' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(fetched).toEqual(['https://example.test/error', 'https://example.test/source'])
  expect(indexValue).toMatchObject([{ sources: [{ httpStatus: 403, eligibility: 'http-error' }] }, { sources: [{ httpStatus: 200, eligibility: 'usable' }] }])
  expect(JSON.stringify(indexValue)).not.toContain('Security verification')
  expect(pageValue).toMatchObject({ callId: 'useful-late', text: '潮🌊归航', offset: sourceOffset, nextOffset: sourceOffset + 4, eof: false, remainingReadChars: 1020 })
  expect(z.object({ httpStatus: z.number(), eligibility: z.string(), nativeTruncated: z.boolean(), text: z.string(), eof: z.boolean(), remainingReadChars: z.number() }).parse(pageValue)).toMatchInlineSnapshot(`
    {
      "eligibility": "usable",
      "eof": false,
      "httpStatus": 200,
      "nativeTruncated": false,
      "remainingReadChars": 1020,
      "text": "潮🌊归航",
    }
  `)
  const actor = { workspace: root, sessionId: agent.session.id }
  const saved = ctx.story.getArtifact(actor, { novelId: parseNovelId(novelId), artifactId: parseArtifactId(evidenceId) })
  expect(JSON.parse(saved.text)).toMatchObject({ version: 3, outcome: 'succeeded', observations: [
    { sources: [{ httpStatus: 403, retention: 'unselected', excerpts: [] }] },
    { sources: [{ retention: 'selected', excerpts: [{ offset: sourceOffset, limit: 4, text: '潮🌊归航' }] }] },
  ] })
  const preview = z.object({ path: z.string() }).parse(lastResult(model.requests.at(-1)!))
  expect(lastResult(model.requests.at(-2)!)).toEqual(lastResult(model.requests.at(-1)!))
  const markdown = await readFile(preview.path, 'utf8')
  expect(markdown).toContain('HTTP status: 403')
  expect(markdown).toContain('Retention: unselected')
  expect(markdown).toContain('characters)\n\n> 潮🌊归航\n')
  expect(markdown).not.toContain('Security verification')
})
