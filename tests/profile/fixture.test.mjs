/** The offline profile model consumes only the public, visible message history. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Llm, { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as Fixture from './fixture.mjs'
import WebRuntime from '@deepseek-ai/dsh-web'
import { formatFetchOutput } from '@deepseek-ai/dsh-tool-web'

const source = { provider: 'story-fixture', model: 'deterministic' }

async function setupContext(t) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(Llm)
  await ctx.plugin(WebRuntime, { searchProvider: 'story-fixture-search', fetchProvider: 'story-fixture-fetch' })
  await ctx.plugin(Fixture)
  return ctx
}

async function setup(t) { return (await setupContext(t)).llm }

function user(text) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function reply(llm, messages, extra = {}) {
  return Array.fromAsync(llm.stream({
    ...source,
    ...extra,
    messages,
    tools: ['story_create_novel', 'story_save_brief', 'story_preview', 'story_write', 'story_update', 'story_revise', 'story_get_settings', 'story_get_manuscript', 'story_read_artifact', 'story_start_research', 'story_research_results', 'story_read_research_source', 'story_complete_research', 'story_get_research', 'web_fetch', 'structured_output'].map(name => ({
      name, description: name, parameters: { type: 'object', properties: {} },
    })),
  }))
}

function call(chunks) {
  const chunk = chunks.find(value => value.type === 'block-end' && value.block.type === 'tool-call')
  assert.ok(chunk, 'Expected a tool call from the registered model')
  return chunk.block
}

function result(messages, block, value, isError = false) {
  messages.push(
    createAssistantMessage({ source, content: [block] }),
    createToolResultMessage({ callId: block.id, content: [{ type: 'text', text: JSON.stringify(value) }], isError }),
  )
}

function novel(text, previous) {
  const revision = previous === undefined ? 1 : previous.revision + 1
  const brief = {
    id: revision === 1 ? 'artifact_22222222-2222-4222-8222-222222222222' : 'artifact_33333333-3333-4333-8333-333333333333',
    kind: 'creative-brief',
    revision,
    sha256: createHash('sha256').update(text).digest('hex'),
    chars: Array.from(text).length,
    bytes: Buffer.byteLength(text),
  }
  return {
    id: 'novel_11111111-1111-4111-8111-111111111111',
    title: 'T01 潮汐城档案',
    workspace: '/fixture/workspace',
    revision,
    brief,
    briefHistory: [...(previous === undefined ? [] : previous.briefHistory), brief],
  }
}

function preview(saved) {
  return {
    kind: 'story-artifact-preview', version: 1,
    novelId: saved.id, artifactId: saved.brief.id, revision: saved.revision,
    title: `${saved.title} · 创作要求 · 版本 ${saved.revision}`,
    path: `/fixture/workspace/.dsh-story/${saved.id}/${saved.brief.id}.md`,
  }
}

function completed(chunks) {
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.equal(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call'), false)
}

test('registers a discoverable offline model and previews the actual creation result', async t => {
  const llm = await setup(t)
  assert.deepEqual(Fixture.inject, ['llm', 'web'])
  assert.equal((await llm.listModels('story-fixture'))[0].id, 'deterministic')
  const messages = [user('T01 创建并预览')]
  const creation = call(await reply(llm, messages))
  assert.equal(creation.name, 'story_create_novel')
  const args = JSON.parse(creation.arguments)
  assert.equal(args.requestId, 't01-web-create-original')
  assert.ok(args.brief.split('\n').length > 5000)
  assert.ok(args.brief.endsWith('T01_INITIAL_END_7F3A'))
  const saved = novel(args.brief)
  result(messages, creation, saved)
  const opening = call(await reply(llm, messages))
  assert.deepEqual(JSON.parse(opening.arguments), { novelId: saved.id, artifactId: saved.brief.id })
  result(messages, opening, preview(saved))
  completed(await reply(llm, messages))
})

test('updates the historical novel and repeats creation with the original idempotency key', async t => {
  const llm = await setup(t)
  const messages = [user('T01 创建并预览')]
  const creation = call(await reply(llm, messages))
  const createArgs = JSON.parse(creation.arguments)
  const original = novel(createArgs.brief)
  result(messages, creation, original)
  const opening = call(await reply(llm, messages))
  result(messages, opening, preview(original))
  messages.push(user('T01 更新并预览'))
  const update = call(await reply(llm, messages))
  const args = JSON.parse(update.arguments)
  assert.equal(update.name, 'story_save_brief')
  assert.equal(args.novelId, original.id)
  assert.equal(args.expectedRevision, 1)
  assert.equal(args.requestId, 't01-web-update-v2')
  assert.ok(args.text.endsWith('T01_UPDATED_END_9C6B'))
  const revised = novel(args.text, original)
  result(messages, update, revised)
  const revisedOpening = call(await reply(llm, messages))
  assert.deepEqual(JSON.parse(revisedOpening.arguments), { novelId: revised.id, artifactId: revised.brief.id })
  result(messages, revisedOpening, preview(revised))
  completed(await reply(llm, messages))
  messages.push(user('T01 创建并预览'))
  const repeated = call(await reply(llm, messages))
  assert.deepEqual(JSON.parse(repeated.arguments), createArgs)
  result(messages, repeated, original)
  const originalOpening = call(await reply(llm, messages))
  assert.deepEqual(JSON.parse(originalOpening.arguments), { novelId: original.id, artifactId: original.brief.id })
})

test('unsupported commands and update-before-create explain the available commands without tools', async t => {
  const llm = await setup(t)
  for (const command of ['其他任务', 'T01 更新并预览']) completed(await reply(llm, [user(command)]))
})

test('a failed writing tool leaves the profile model request failed', async t => {
  const llm = await setup(t)
  const messages = [user('T01 创建并预览')]
  const creation = call(await reply(llm, messages))
  result(messages, creation, { error: 'disk failure' }, true)
  const chunks = await reply(llm, messages)
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.match(JSON.stringify(chunks), /story_create_novel.*failed/)
  assert.equal(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call'), false)
})

test('missing result identities fail before the model requests document access', async t => {
  const llm = await setup(t)
  const messages = [user('T01 创建并预览')]
  const creation = call(await reply(llm, messages))
  result(messages, creation, { id: 'invented' })
  const chunks = await reply(llm, messages)
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.match(JSON.stringify(chunks), /novel.brief/)
  assert.equal(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call'), false)
})

test('T14 creates a short novel and sends the exact three-chapter writing request', async t => {
  const llm = await setup(t)
  const messages = [user('T14 写作三章')]
  const creation = call(await reply(llm, messages))
  assert.equal(creation.name, 'story_create_novel')
  const args = JSON.parse(creation.arguments)
  assert.equal(args.requestId, 't14-web-create')
  assert.ok(args.brief.length < 1000)
  const saved = novel(args.brief)
  result(messages, creation, saved)
  const writing = call(await reply(llm, messages))
  assert.equal(writing.name, 'story_write')
  assert.deepEqual(JSON.parse(writing.arguments), { novelId: saved.id, briefArtifactId: saved.brief.id, requestId: 't14-web-write', settingsRoots: ['a1'], chapterCount: 3, fromChapter: 1, throughChapter: 3 })
})

test('native settings child reads every exact source page before structured capture', async t => {
  const llm = await setup(t)
  const text = '灯塔航标记录。'.repeat(800)
  const saved = novel(text)
  const sourceRef = { artifactId: saved.brief.id, sha256: saved.brief.sha256 }
  const data = { kind: 'settings', novelId: saved.id, inputs: [{ ...sourceRef, kind: 'creative-brief', chars: saved.brief.chars }],
    task: JSON.stringify({ dimensionCode: 'a1', inputRefs: [sourceRef] }), requirements: [] }
  const messages = [user(`Native stage.\n\nTASK_DATA\n\n${JSON.stringify(data)}`)]
  let offset = 0
  while (offset < saved.brief.chars) {
    const reading = call(await reply(llm, messages, { sessionId: 'child-session' }))
    assert.equal(reading.name, 'story_read_artifact')
    const args = JSON.parse(reading.arguments)
    assert.deepEqual(args, { novelId: saved.id, artifactId: saved.brief.id, offset, limit: 4096 })
    const chunk = Array.from(text).slice(offset, offset + args.limit).join('')
    const nextOffset = offset + Array.from(chunk).length
    result(messages, reading, { novelId: saved.id, artifactId: saved.brief.id, kind: 'creative-brief', revision: 1, sha256: saved.brief.sha256,
      offset, nextOffset, totalChars: saved.brief.chars, text: chunk, eof: nextOffset === saved.brief.chars })
    offset = nextOffset
  }
  const capture = call(await reply(llm, messages, { sessionId: 'child-session' }))
  assert.equal(capture.name, 'structured_output')
  const output = JSON.parse(capture.arguments)
  assert.deepEqual(output.inputRefs, [sourceRef])
  assert.equal(output.dimensionCode, 'a1')
  assert.match(output.contentMarkdown, /白色/)
})

let artifactNumber = 100
function blob(kind, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const id = `artifact_${String(++artifactNumber).padStart(8, '0')}-2222-4222-8222-222222222222`
  return { text, value, artifact: { id, kind, revision: 1, sha256: createHash('sha256').update(text).digest('hex'), chars: [...text].length, bytes: Buffer.byteLength(text) } }
}
function ref(source) { return { artifactId: source.artifact.id, sha256: source.artifact.sha256 } }

async function stageReady(llm, kind, task, sources) {
  const novelId = 'novel_11111111-1111-4111-8111-111111111111'
  const inputs = sources.map(source => ({ ...ref(source), kind: source.artifact.kind, chars: source.artifact.chars }))
  const data = { kind, novelId, inputs, task: JSON.stringify(task), requirements: [] }
  const messages = [user(`Native stage.\n\nTASK_DATA\n\n${JSON.stringify(data)}`)]
  for (let step = 0; step < 64; step++) {
    const block = call(await reply(llm, messages, { sessionId: 'child-session' }))
    if (block.name !== 'story_read_artifact') return { block, messages, data }
    const args = JSON.parse(block.arguments)
    const source = sources.find(item => item.artifact.id === args.artifactId)
    assert.ok(source)
    assert.equal(args.limit, 4096)
    const text = [...source.text].slice(args.offset, args.offset + args.limit).join('')
    const nextOffset = args.offset + [...text].length
    result(messages, block, { novelId, artifactId: source.artifact.id, kind: source.artifact.kind, revision: source.artifact.revision, sha256: source.artifact.sha256,
      offset: args.offset, nextOffset, totalChars: source.artifact.chars, text, eof: nextOffset === source.artifact.chars })
  }
  assert.fail('Fixture exceeded the bounded source-page budget')
}

for (const kind of ['settings', 'book-outline', 'chapter-outline', 'body', 'review', 'continuity']) {
  test(`native ${kind} stage captures complete output from its fully read sources`, async t => {
    const llm = await setup(t)
    const settings = blob('settings', { dimensions: [{ facts: [{ id: 'light', statement: '灯塔发出蓝色灯光。' }] }] })
    const body = blob('body', { chapterNumber: 2, scenes: [{ sceneId: 'scene-2', text: '林澜核实第二处蓝色航灯，把安全航道记入日志。' }] })
    const sources = [settings, body]
    const task = { inputRefs: sources.map(ref), dimensionCode: 'a1', chapterNumber: 2, chapterCount: 3, sceneIds: ['scene-2'],
      obligations: [{ id: 'signal-2', description: '林澜核实第二处航标并记录证据。' }], requiredChecks: ['completeness', 'consistency', 'obligations', 'continuity', 'length', 'style'],
      reviewed: ref(body), bodyId: body.artifact.id, measuredWordCount: 4000, measuredLength: { status: 'within-range', blocking: false },
      ...(kind === 'settings' ? { revisionInstructions: '将灯塔的灯光改为蓝色。' } : {}) }
    const { block } = await stageReady(llm, kind, task, sources)
    assert.equal(block.name, 'structured_output')
    const output = JSON.parse(block.arguments)
    assert.equal(output.version, 1)
    assert.deepEqual(output.inputRefs, task.inputRefs)
    switch (kind) {
      case 'settings': assert.match(output.contentMarkdown, /蓝色.*修订要求/s); assert.equal(output.dimensionCode, 'a1'); break
      case 'book-outline': assert.equal(output.chapters.length, 3); assert.match(output.ending, /蓝色/); assert.equal(output.characterArcs[0].character, '林澜'); break
      case 'chapter-outline': assert.equal(output.targetWords, 4000); assert.deepEqual(output.obligations, task.obligations); assert.deepEqual(output.scenes[0].obligationIds, ['signal-2']); break
      case 'body': {
        const text = output.scenes.map(scene => scene.text).join('\n')
        const count = [...text.matchAll(/\p{Script=Han}/gu)].length
        assert.ok(count >= 3000 && count <= 5000, `chapter-total Han count ${count}`)
        assert.match(text, /蓝色/)
        assert.deepEqual(output.scenes.map(scene => scene.sceneId), task.sceneIds)
        break
      }
      case 'review': assert.deepEqual(output.checks.map(check => check.category), task.requiredChecks); assert.equal(output.checks[0].evidence[0].quote, body.value.scenes[0].text); assert.deepEqual(output.issues, []); break
      case 'continuity': assert.equal(output.obligations[0].status, 'fulfilled'); assert.equal(output.obligations[0].evidence[0].artifactId, body.artifact.id); assert.equal(output.timeline[0].evidence[0].quote, body.value.scenes[0].text); break
      default: assert.fail(`Unexpected kind ${kind}`)
    }
  })
}

async function fetchedResearch(t) {
  const ctx = await setupContext(t)
  const llm = ctx.llm
  const saved = novel('林澜在虚构雾港追查船只，查证离线参考中的灯塔航标说明。')
  const brief = '林澜在虚构雾港追查船只，查证离线参考中的灯塔航标说明。'
  const planningData = { kind: 'research-planning', novelId: saved.id, briefArtifactId: saved.brief.id, requestId: 'research-request', purpose: 'settings', inputs: [saved.brief], outputTarget: { kind: 'settings', dimensionCode: 'a1' } }
  const planningMessages = [user(`Native planning.\n\nTASK_DATA\n\n${JSON.stringify(planningData)}`)]
  const planningRead = call(await reply(llm, planningMessages, { sessionId: 'planning-child' }))
  assert.equal(planningRead.name, 'story_read_artifact')
  result(planningMessages, planningRead, { novelId: saved.id, artifactId: saved.brief.id, kind: saved.brief.kind, revision: 1, sha256: saved.brief.sha256, offset: 0, nextOffset: saved.brief.chars, totalChars: saved.brief.chars, text: brief, eof: true })
  const planningCapture = call(await reply(llm, planningMessages, { sessionId: 'planning-child' }))
  assert.equal(planningCapture.name, 'structured_output')
  const necessity = JSON.parse(planningCapture.arguments)
  assert.equal(necessity.mode, 'external-required')
  assert.equal(necessity.externalRequirements[0].questionId, 'fixture-reference')
  const data = { kind: 'research', novelId: saved.id, briefArtifactId: saved.brief.id, requestId: 'research-request', purpose: 'settings', inputs: [saved.brief], necessity }
  const messages = [user(`Native research.\n\nTASK_DATA\n\n${JSON.stringify(data)}`)]
  const request = () => reply(llm, messages, { sessionId: 'child-session' }).then(call)
  const reading = await request()
  assert.equal(reading.name, 'story_read_artifact')
  result(messages, reading, { novelId: saved.id, artifactId: saved.brief.id, kind: saved.brief.kind, revision: 1, sha256: saved.brief.sha256, offset: 0, nextOffset: saved.brief.chars, totalChars: saved.brief.chars, text: brief, eof: true })
  const start = await request()
  assert.equal(start.name, 'story_start_research')
  const args = JSON.parse(start.arguments)
  assert.equal(args.requestId, data.requestId)
  assert.equal(args.briefArtifactId, saved.brief.id)
  assert.deepEqual(args.questions.map(question => question.kind), ['creative', 'external'])
  assert.deepEqual(args.questions, necessity.questions)
  const plan = { planId: 'actual-plan', novelId: saved.id, briefArtifactId: saved.brief.id, sessionId: 'child-session', outcome: 'pending', stale: false, result: null }
  result(messages, start, plan)
  const fetch = await request()
  assert.equal(fetch.name, 'web_fetch')
  const input = JSON.parse(fetch.arguments)
  assert.deepEqual(input, { url: 'https://story-fixture.invalid/navigation' })
  const fetched = await ctx.web.fetch(input)
  assert.equal(fetched.statusCode, 200)
  assert.match(fetched.body.content, /OFFLINE_NAVIGATION_REFERENCE_V1/)
  const rendered = formatFetchOutput(fetched, 200000)
  messages.push(createAssistantMessage({ source, content: [fetch] }), createToolResultMessage({ callId: fetch.id, content: [{ type: 'text', text: rendered }] }))
  const observations = await request()
  assert.equal(observations.name, 'story_research_results')
  const observation = { callId: fetch.id, name: 'web_fetch', input, callSeq: 10, resultSeq: 11, status: 'succeeded', error: null,
    rejectedSources: [], sources: [{ sourceIndex: 0, url: input.url, title: null, bodyStart: [...formatFetchOutput({ ...fetched, body: { kind: 'text', content: '' } }, 200000)].length,
      bodyEnd: [...rendered].length, totalChars: [...rendered].length, sha256: createHash('sha256').update(rendered).digest('hex'), httpStatus: 200, nativeTruncated: false, eligibility: 'usable' }] }
  const sourceMetadata = observation.sources[0]
  const page = { ...sourceMetadata, callId: fetch.id, offset: sourceMetadata.bodyStart, nextOffset: sourceMetadata.bodyEnd, eof: true, text: [...rendered].slice(sourceMetadata.bodyStart, sourceMetadata.bodyEnd).join(''), remainingReadChars: 4096 - (sourceMetadata.bodyEnd - sourceMetadata.bodyStart) }
  return { ctx, llm, saved, brief, messages, request, plan, fetch, observations, observation, page }
}

test('native research child fetches offline evidence and cites the actual logged call before completion', async t => {
  const { messages, request, plan, observations, observation, fetch, brief, page } = await fetchedResearch(t)
  result(messages, observations, [observation])
  const read = await request()
  assert.equal(read.name, 'story_read_research_source')
  const range = { callId: fetch.id, sourceIndex: 0, offset: page.offset, limit: page.nextOffset - page.offset }
  assert.deepEqual(JSON.parse(read.arguments), { novelId: plan.novelId, planId: plan.planId, ...range })
  result(messages, read, page)
  const complete = await request()
  assert.equal(complete.name, 'story_complete_research')
  const completion = JSON.parse(complete.arguments)
  assert.deepEqual(completion.findings[0].callIds, [])
  assert.deepEqual(completion.findings[0].selections, [])
  assert.ok(completion.findings[0].conclusion.includes(brief))
  assert.deepEqual(completion.findings[1].callIds, [fetch.id])
  assert.ok(completion.findings[1].conclusion.includes(page.text))
  assert.deepEqual(completion.findings[1].selections, [range])
  const completedPlan = { ...plan, outcome: 'succeeded', result: blob('research-evidence', { observations: [observation] }).artifact }
  result(messages, complete, completedPlan)
  const get = await request()
  assert.equal(get.name, 'story_get_research')
  result(messages, get, completedPlan)
  const capture = await request()
  assert.equal(capture.name, 'structured_output')
  assert.deepEqual(JSON.parse(capture.arguments), { planId: plan.planId })
})

for (const defect of ['missing', 'wrong-call', 'empty-source']) {
  test(`offline research refuses ${defect} evidence before claiming completion`, async t => {
    const { llm, messages, observations, observation } = await fetchedResearch(t)
    const rows = defect === 'missing' ? [] : [{ ...observation, ...(defect === 'wrong-call' ? { callId: 'unrelated-call' } : {}),
      sources: defect === 'empty-source' ? [{ ...observation.sources[0], eligibility: 'empty', bodyEnd: observation.sources[0].bodyStart }] : observation.sources }]
    result(messages, observations, rows)
    const chunks = await reply(llm, messages, { sessionId: 'child-session' })
    assert.equal(chunks.at(-1).reason.kind, 'error')
    assert.equal(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call'), false)
  })
}

for (const defect of ['text', 'offset', 'digest']) {
  test(`offline research refuses a source page with mismatched ${defect}`, async t => {
    const { llm, messages, request, observations, observation, page } = await fetchedResearch(t)
    result(messages, observations, [observation])
    const read = await request()
    assert.equal(read.name, 'story_read_research_source')
    result(messages, read, { ...page, ...(defect === 'text' ? { text: 'Invented passage.' } : defect === 'offset' ? { offset: page.offset + 1 } : { sha256: '0'.repeat(64) }) })
    const chunks = await reply(llm, messages, { sessionId: 'child-session' })
    assert.equal(chunks.at(-1).reason.kind, 'error')
    assert.equal(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call'), false)
  })
}

test('offline web provider refuses every URL outside its fixed fixture reference', async t => {
  const ctx = await setupContext(t)
  await assert.rejects(ctx.web.fetch({ url: 'https://example.com/production' }))
})

for (const corrupt of ['metadata', 'bytes']) {
  test(`native child rejects corrupt reader ${corrupt} before structured capture`, async t => {
    const llm = await setup(t)
    const saved = novel('灯塔发出白光。')
    const input = { artifactId: saved.brief.id, sha256: saved.brief.sha256, kind: saved.brief.kind, chars: saved.brief.chars }
    const data = { kind: 'settings', novelId: saved.id, inputs: [input], task: JSON.stringify({ inputRefs: [{ artifactId: input.artifactId, sha256: input.sha256 }], dimensionCode: 'a1' }), requirements: [] }
    const messages = [user(`Native stage.\n\nTASK_DATA\n\n${JSON.stringify(data)}`)]
    const reading = call(await reply(llm, messages, { sessionId: 'child-session' }))
    result(messages, reading, { novelId: saved.id, artifactId: saved.brief.id, kind: saved.brief.kind, revision: 1, sha256: corrupt === 'metadata' ? '0'.repeat(64) : saved.brief.sha256,
      offset: 0, nextOffset: saved.brief.chars, totalChars: saved.brief.chars, text: corrupt === 'bytes' ? '灯塔发出蓝光。' : '灯塔发出白光。', eof: true })
    const chunks = await reply(llm, messages, { sessionId: 'child-session' })
    assert.equal(chunks.at(-1).reason.kind, 'error')
    assert.match(JSON.stringify(chunks), corrupt === 'metadata' ? /reader page differs/ : /readback digest differs/)
    assert.equal(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call'), false)
  })
}

function runResult(block) {
  const args = JSON.parse(block.arguments)
  const { baseArtifactId, instructions, ...request } = args
  return { ...request, id: 'run_11111111-1111-4111-8111-111111111111', mode: block.name.slice('story_'.length), revision: baseArtifactId === undefined ? null : { baseArtifactId, instructions },
    status: 'completed', error: null, startedBy: 'parent', lastResumedBy: 'parent', attempts: [], limits: { maxAttempts: 512, maxOutputBytes: 1048576 },
    executionLimits: { stageProvider: 'spawn', maxDelegationDepth: 2, maxStageRequests: 96, stageTimeoutMs: 600000, maxRepairAttempts: 2, maxParallelStages: 3, minChapterWords: 3000, maxChapterWords: 5000 } }
}
function manuscript(saved) {
  return { novelId: saved.id, history: [], heads: [], appliedChapters: [1, 2, 3].map(chapterNumber => ({ chapterNumber,
    body: blob('body', `第${chapterNumber}章正文`).artifact, bodyReview: blob('review', `第${chapterNumber}章正文审查`).artifact,
    continuity: blob('continuity', `第${chapterNumber}章连续性`).artifact, continuityReview: blob('review', `第${chapterNumber}章连续性审查`).artifact,
    wordBounds: { minChapterWords: 3000, maxChapterWords: 5000 }, wordCount: 4000, stale: false, changedInputs: [], obligations: [{ id: `signal-${chapterNumber}`, status: 'fulfilled' }],
  })) }
}
function artifactPreview(saved, artifact) { return { ...preview(saved), artifactId: artifact.id, revision: artifact.revision, path: `/fixture/${saved.id}/${artifact.id}.md` } }
function settings(saved, previous) {
  const candidate = { dimensionCode: 'a1', artifact: blob('settings-dimension', previous === undefined ? '白色灯光' : '蓝色灯光').artifact,
    inputRefs: [{ artifactId: saved.brief.id, sha256: saved.brief.sha256 }], childSessionId: 'settings-child', status: 'applied', stale: false,
    review: blob('review', '完整设定审查').artifact, revisionOf: previous === undefined ? null : previous.applied[0].artifact.id }
  return { novelId: saved.id, applied: [candidate], history: [...(previous === undefined ? [] : previous.history), candidate] }
}
async function receive(llm, messages, name, value) {
  const block = call(await reply(llm, messages))
  assert.equal(block.name, name)
  result(messages, block, typeof value === 'function' ? value(block) : value)
  return JSON.parse(block.arguments)
}
async function written(llm, transform = value => value) {
  const messages = [user('T14 写作三章')]
  let saved
  await receive(llm, messages, 'story_create_novel', block => { saved = novel(JSON.parse(block.arguments).brief); return saved })
  await receive(llm, messages, 'story_write', runResult)
  const current = transform(manuscript(saved))
  await receive(llm, messages, 'story_get_manuscript', current)
  return { messages, saved, current }
}
async function writtenAndPreviewed(llm) {
  const state = await written(llm)
  const { messages, saved, current } = state
  assert.deepEqual(await receive(llm, messages, 'story_preview', artifactPreview(saved, current.appliedChapters[2].body)), { novelId: saved.id, artifactId: current.appliedChapters[2].body.id })
  const done = await reply(llm, messages)
  completed(done)
  assert.match(JSON.stringify(done), /完整设定、全书大纲、分章大纲和正文/)
  assert.doesNotMatch(JSON.stringify(done), /打开正文与审查/)
  return state
}
async function revised(llm, state, transform = value => value) {
  const { messages, saved, current } = state
  messages.push(user('T14 修订设定并检查影响'))
  const oldSettings = settings(saved)
  await receive(llm, messages, 'story_get_settings', oldSettings)
  const reviseArgs = await receive(llm, messages, 'story_revise', runResult)
  assert.equal(reviseArgs.baseArtifactId, oldSettings.applied[0].artifact.id)
  assert.equal(reviseArgs.requestId, 't14-web-revise-a1')
  const newSettings = settings(saved, oldSettings)
  await receive(llm, messages, 'story_get_settings', newSettings)
  const affected = transform({ ...current, appliedChapters: current.appliedChapters.map(chapter => ({ ...chapter, stale: true })) })
  await receive(llm, messages, 'story_get_manuscript', affected)
  return { ...state, affected, newSettings }
}

test('T14 writes, revises the exact a1 head and refreshes all three body/continuity pairs', async t => {
  const llm = await setup(t)
  const state = await revised(llm, await writtenAndPreviewed(llm))
  const { messages, saved } = state
  const impact = await reply(llm, messages)
  completed(impact)
  assert.match(JSON.stringify(impact), /均标记为需要更新/)
  assert.doesNotMatch(JSON.stringify(impact), /修订设定预览/)
  messages.push(user('T14 更新三章并预览'))
  const updateArgs = await receive(llm, messages, 'story_update', runResult)
  assert.deepEqual(updateArgs, { novelId: saved.id, briefArtifactId: saved.brief.id, requestId: 't14-web-update', settingsRoots: ['a1'], chapterCount: 3, fromChapter: 1, throughChapter: 3 })
  const updated = manuscript(saved)
  await receive(llm, messages, 'story_get_manuscript', updated)
  assert.deepEqual(await receive(llm, messages, 'story_preview', artifactPreview(saved, updated.appliedChapters[2].body)), { novelId: saved.id, artifactId: updated.appliedChapters[2].body.id })
  completed(await reply(llm, messages))
})

for (const defect of ['missing-first-chapter', 'stale-first-chapter', 'short-first-chapter']) {
  test(`T14 refuses completion when manuscript has ${defect}`, async t => {
    const llm = await setup(t)
    const { messages } = await written(llm, current => {
      if (defect === 'missing-first-chapter') current.appliedChapters.shift()
      else if (defect === 'stale-first-chapter') current.appliedChapters[0].stale = true
      else current.appliedChapters[0].wordCount = 2999
      return current
    })
    const chunks = await reply(llm, messages)
    assert.equal(chunks.at(-1).reason.kind, 'error')
    assert.equal(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call'), false)
  })
}

test('T14 upstream revision refuses silently replaced first-chapter prose', async t => {
  const llm = await setup(t)
  const { messages } = await revised(llm, await writtenAndPreviewed(llm), current => {
    current.appliedChapters[0].body = blob('body', 'unexpected replacement').artifact
    return current
  })
  const chunks = await reply(llm, messages)
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.match(JSON.stringify(chunks), /unexpectedly rewrote downstream/)
})

for (const unchanged of ['body', 'continuity']) {
  test(`T14 update refuses an unchanged first-chapter ${unchanged}`, async t => {
    const llm = await setup(t)
    const { messages, saved, affected } = await revised(llm, await writtenAndPreviewed(llm))
    completed(await reply(llm, messages))
    messages.push(user('T14 更新三章并预览'))
    await receive(llm, messages, 'story_update', runResult)
    const updated = manuscript(saved)
    updated.appliedChapters[0][unchanged] = affected.appliedChapters[0][unchanged]
    await receive(llm, messages, 'story_get_manuscript', updated)
    const chunks = await reply(llm, messages)
    assert.equal(chunks.at(-1).reason.kind, 'error')
    assert.match(JSON.stringify(chunks), /did not replace every affected body and continuity/)
  })
}
