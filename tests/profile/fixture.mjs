/** Offline model adapter for the real DSH Web/profile acceptance flow. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'

/** @typedef {import('@deepseek-ai/dsh-llm').GenerateOptions} GenerateOptions */
/** @typedef {import('@deepseek-ai/dsh-llm').RequestMessage} RequestMessage */
/** @typedef {import('@deepseek-ai/dsh-llm').StreamChunk} StreamChunk */
/** @typedef {{ name: string, arguments: string, result: import('@deepseek-ai/dsh-llm').ToolResultMessage }} RecordedResult */

const provider = 'story-fixture'
const model = 'deterministic'
const referenceUrl = 'https://story-fixture.invalid/navigation'
const referenceMarker = 'OFFLINE_NAVIGATION_REFERENCE_V1'
const referenceBody = `${referenceMarker}\nThe lighthouse signal marks the harbor entrance. This is an offline test reference, not navigation guidance.`
const createCommand = 'T01 创建并预览'
const updateCommand = 'T01 更新并预览'
const createRequestId = 't01-web-create-original'
const updateRequestId = 't01-web-update-v2'
const writingTools = new Set(['story_create_novel', 'story_save_brief', 'story_preview', 'story_write', 'story_update', 'story_revise', 'story_get_settings', 'story_get_manuscript', 'story_read_artifact', 'story_start_research', 'story_research_results', 'story_read_research_source', 'story_complete_research', 'story_get_research', 'web_fetch', 'structured_output'])

/** @param {boolean} updated - Whether to produce the second fixed version. */
function creativeBrief(updated) {
  const rows = Array.from({ length: 5200 }, (_, index) =>
    `${String(index + 1).padStart(4, '0')} ${updated ? '旧钟慢行。' : '灯塔仍亮。'}`)
  return [
    updated ? '# T01 潮汐城档案：修订创作要求' : '# T01 潮汐城档案：初版创作要求',
    '主角林迟是修钟师，正在追查失踪航海日志。',
    updated ? '修订约束：旧钟每天慢三分钟，秘密藏在钟摆中。' : '初版约束：灯塔每晚亮起，秘密藏在透镜中。',
    '',
    ...rows,
    '',
    '末页校验标记：',
    updated ? 'T01_UPDATED_END_9C6B' : 'T01_INITIAL_END_7F3A',
  ].join('\n')
}

/** @param {unknown} value @param {string} field @returns {Record<string, unknown>} */
function record(value, field) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`T01 fixture requires an object at ${field}`)
  }
  return /** @type {Record<string, unknown>} */ (value)
}

/** @param {unknown} value @param {string} field @returns {string} */
function nonblank(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`T01 fixture requires a nonblank string at ${field}`)
  }
  return value
}

/** @param {unknown} value @returns {{ id: string, artifactId: string, revision: number }} */
function novelVersion(value) {
  const novel = record(value, 'novel')
  const brief = record(novel.brief, 'novel.brief')
  if (typeof novel.revision !== 'number' || !Number.isSafeInteger(novel.revision) || novel.revision < 1) {
    throw new Error('T01 fixture requires a positive safe integer at novel.revision')
  }
  return {
    id: nonblank(novel.id, 'novel.id'),
    artifactId: nonblank(brief.id, 'novel.brief.id'),
    revision: novel.revision,
  }
}

/** @param {RequestMessage[]} messages @returns {RecordedResult[]} */
function writingResults(messages) {
  /** @type {Map<string, { name: string, arguments: string }>} */
  const calls = new Map()
  /** @type {RecordedResult[]} */
  const results = []
  for (const message of messages) {
    if (message.role === 'tool') {
      const call = calls.get(message.toolCallId)
      if (call === undefined) throw new Error('T01 fixture cannot correlate a result with its visible tool call')
      if (writingTools.has(call.name)) results.push({ ...call, result: message })
      continue
    }
    for (const block of message.content) {
      if (block.type === 'tool-call') calls.set(block.id, block)
    }
  }
  return results
}

/** @param {RecordedResult} entry @returns {unknown} */
function resultValue(entry) {
  if (entry.result.isError === true) throw new Error(`T01 fixture tool ${entry.name} failed; the run is incomplete`)
  const content = entry.result.content
  if (content.length !== 1 || content[0]?.type !== 'text') {
    throw new Error(`T01 fixture expected one JSON text result from ${entry.name}`)
  }
  return JSON.parse(content[0].text)
}

/** @param {string} text @returns {StreamChunk[]} */
function finish(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** @param {GenerateOptions} options @param {string} id @param {string} name @param {object} args @returns {StreamChunk[]} */
function callTool(options, id, name, args) {
  if (!options.tools?.some(tool => tool.name === name)) {
    throw new Error(`T01 fixture requires the native tool ${name}; it was not offered to this request`)
  }
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** @param {GenerateOptions} options @returns {StreamChunk[]} */
function respondLegacy(options) {
  const userIndex = options.messages.findLastIndex(message => message.role === 'user' && message.source?.kind === 'user')
  const user = options.messages[userIndex]
  if (user === undefined) throw new Error('T01 fixture requires a visible user command')
  const command = user.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
  if (command !== createCommand && command !== updateCommand) {
    return finish(`离线测试模型支持“${createCommand}”“${updateCommand}”“${writingCommand}”“${revisionCommand}”“${refreshCommand}”，本次没有执行工具。`)
  }

  const results = writingResults(options.messages.slice(userIndex + 1))
  const writeTool = command === createCommand ? 'story_create_novel' : 'story_save_brief'
  if (results.length === 0) {
    if (command === createCommand) {
      return callTool(options, `t01-${user.id}-create`, writeTool, {
        requestId: createRequestId,
        title: 'T01 潮汐城档案',
        brief: creativeBrief(false),
      })
    }
    const creation = writingResults(options.messages.slice(0, userIndex)).findLast(entry =>
      entry.name === 'story_create_novel'
      && record(JSON.parse(entry.arguments), 'creation arguments').requestId === createRequestId)
    if (creation === undefined) return finish(`请先在此对话执行“${createCommand}”；本次没有更新创作要求。`)
    const original = novelVersion(resultValue(creation))
    return callTool(options, `t01-${user.id}-update`, writeTool, {
      novelId: original.id,
      requestId: updateRequestId,
      expectedRevision: original.revision,
      text: creativeBrief(true),
    })
  }

  const written = results[0]
  if (written === undefined || written.name !== writeTool || results.length > 2) {
    throw new Error('T01 fixture received an unexpected writing-tool sequence')
  }
  const novel = novelVersion(resultValue(written))
  if (results.length === 1) {
    return callTool(options, `t01-${user.id}-preview`, 'story_preview', {
      novelId: novel.id,
      artifactId: novel.artifactId,
    })
  }
  const opened = results[1]
  if (opened === undefined || opened.name !== 'story_preview') {
    throw new Error('T01 fixture expected story_preview after saving the creative brief')
  }
  const preview = record(resultValue(opened), 'preview')
  if (preview.kind !== 'story-artifact-preview' || preview.version !== 1
    || preview.novelId !== novel.id || preview.artifactId !== novel.artifactId
    || preview.revision !== novel.revision) {
    throw new Error('T01 fixture preview does not match the saved artifact version')
  }
  nonblank(preview.path, 'preview.path')
  return finish(`T01 已保存并返回版本 ${novel.revision} 的预览结果。请点击工具卡的“打开此版本”，核对末页标记。`)
}

const stageMarker = '\n\nTASK_DATA\n\n'
const writingCommand = 'T14 写作三章'
const revisionCommand = 'T14 修订设定并检查影响'
const refreshCommand = 'T14 更新三章并预览'
const artifactSchema = z.object({ id: z.string(), kind: z.string(), revision: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/), chars: z.number().int().nonnegative(), bytes: z.number().int().nonnegative() })
const chapterSchema = z.object({ chapterNumber: z.number().int().positive(), body: artifactSchema, bodyReview: artifactSchema, continuity: artifactSchema, continuityReview: artifactSchema,
  wordCount: z.number().int().min(3000).max(5000), stale: z.boolean() })
const manuscriptSchema = z.object({ novelId: z.string(), appliedChapters: z.array(chapterSchema).length(3) })
const settingsViewSchema = z.object({ novelId: z.string(), applied: z.array(z.object({ dimensionCode: z.string(), artifact: artifactSchema, revisionOf: z.string().nullable(), stale: z.boolean() })) })

/** @param {RecordedResult[]} results @param {number} index @param {string} name */
function expectedResult(results, index, name) {
  const entry = results[index]
  if (entry === undefined || entry.name !== name) throw new Error(`T14 expected ${name} at result ${index}`)
  return resultValue(entry)
}

/** @param {unknown} value */
function completedRun(value) {
  const run = record(value, 'writing run')
  if (run.status !== 'completed' || run.error !== null) throw new Error(`T14 writing run is incomplete: ${String(run.error)}`)
}

/** @param {unknown} value @param {string} novelId @param {boolean} stale */
function chapters(value, novelId, stale) {
  const manuscript = manuscriptSchema.parse(value)
  if (manuscript.novelId !== novelId || manuscript.appliedChapters.some((chapter, index) => chapter.chapterNumber !== index + 1 || chapter.stale !== stale)) throw new Error('T14 requires all three exact chapters in the expected freshness state')
  return manuscript.appliedChapters
}

/** @param {unknown} value @param {string} novelId @param {string} artifactId */
function checkedPreview(value, novelId, artifactId) {
  const preview = record(value, 'preview')
  if (preview.kind !== 'story-artifact-preview' || preview.version !== 1 || preview.novelId !== novelId || preview.artifactId !== artifactId) throw new Error('T14 preview identifies a different artifact')
  nonblank(preview.path, 'preview.path')
}

/** @param {ReturnType<typeof novelVersion>} novel @param {string} requestId */
function writingScope(novel, requestId) {
  return { novelId: novel.id, briefArtifactId: novel.artifactId, requestId, settingsRoots: ['a1'], chapterCount: 3, fromChapter: 1, throughChapter: 3 }
}

/** @param {GenerateOptions} options @param {number} userIndex @param {string} command @returns {StreamChunk[]} */
function respondWriting(options, userIndex, command) {
  const results = writingResults(options.messages.slice(userIndex + 1))
  const history = writingResults(options.messages.slice(0, userIndex))
  const user = options.messages[userIndex]
  if (user === undefined) throw new Error('T14 requires the actual user command')
  /** @param {string} name @param {object} args */
  const next = (name, args) => callTool(options, `t14-${user.id}-${results.length}`, name, args)
  if (command === writingCommand && results.length === 0) return next('story_create_novel', {
    requestId: 't14-web-create', title: 'T14 雾港航标', brief: '守灯人林澜在虚构雾港追查失踪船只。灯塔最初发出白色灯光。完成三章悬疑冒险故事，每章三千至五千字，保留航标与日志线索；航标含义以指定离线测试参考为准。',
  })
  const creation = command === writingCommand ? results[0] : history.findLast(entry => entry.name === 'story_create_novel' && record(JSON.parse(entry.arguments), 'creation').requestId === 't14-web-create')
  if (creation === undefined) return finish(`请先在此对话执行“${writingCommand}”。`)
  if (creation.name !== 'story_create_novel') throw new Error('T14 requires the recorded novel creation')
  const novel = novelVersion(resultValue(creation))
  if (command === writingCommand) {
    if (results.length === 1) return next('story_write', writingScope(novel, 't14-web-write'))
    completedRun(expectedResult(results, 1, 'story_write'))
    if (results.length === 2) return next('story_get_manuscript', { novelId: novel.id })
    const applied = chapters(expectedResult(results, 2, 'story_get_manuscript'), novel.id, false)
    const last = applied[2]
    if (last === undefined) throw new Error('T14 chapter three is missing')
    if (results.length === 3) return next('story_preview', { novelId: novel.id, artifactId: last.body.id })
    if (results.length !== 4) throw new Error('T14 writing sequence has extra results')
    checkedPreview(expectedResult(results, 3, 'story_preview'), novel.id, last.body.id)
    return finish('T14 三章均已审查并应用，每章三千至五千字；已返回第三章正文预览。请打开完整设定、全书大纲、分章大纲和正文，逐章核对版本。')
  }
  const previous = history.findLast(entry => entry.name === 'story_get_manuscript')
  if (previous === undefined) throw new Error('T14 requires the previously recorded three-chapter manuscript')
  if (command === revisionCommand) {
    const before = chapters(resultValue(previous), novel.id, false)
    if (results.length === 0) return next('story_get_settings', { novelId: novel.id })
    const original = settingsViewSchema.parse(expectedResult(results, 0, 'story_get_settings'))
    const base = original.applied.find(item => item.dimensionCode === 'a1' && !item.stale)
    if (original.novelId !== novel.id || base === undefined) throw new Error('T14 requires the current a1 setting as revision base')
    if (results.length === 1) return next('story_revise', { ...writingScope(novel, 't14-web-revise-a1'), baseArtifactId: base.artifact.id, instructions: '将灯塔的灯光设定改为蓝色；保留人物与港口设定。' })
    completedRun(expectedResult(results, 1, 'story_revise'))
    if (results.length === 2) return next('story_get_settings', { novelId: novel.id })
    const revised = settingsViewSchema.parse(expectedResult(results, 2, 'story_get_settings'))
    const current = revised.applied.find(item => item.dimensionCode === 'a1')
    if (revised.novelId !== novel.id || current === undefined || current.stale || current.revisionOf !== base.artifact.id || current.artifact.id === base.artifact.id) throw new Error('T14 revision did not adopt a new exact a1 lineage')
    if (results.length === 3) return next('story_get_manuscript', { novelId: novel.id })
    const affected = chapters(expectedResult(results, 3, 'story_get_manuscript'), novel.id, true)
    if (affected.some((chapter, index) => chapter.body.id !== before[index]?.body.id || chapter.continuity.id !== before[index]?.continuity.id)) throw new Error('T14 upstream revision unexpectedly rewrote downstream chapters')
    if (results.length !== 4) throw new Error('T14 revision sequence has extra results')
    return finish('T14 已修订 a1 设定；三章原文保持原版本，均标记为需要更新。执行更新后可核对新的完整设定、全书大纲、分章大纲和正文。')
  }
  const before = chapters(resultValue(previous), novel.id, true)
  if (results.length === 0) return next('story_update', writingScope(novel, 't14-web-update'))
  completedRun(expectedResult(results, 0, 'story_update'))
  if (results.length === 1) return next('story_get_manuscript', { novelId: novel.id })
  const applied = chapters(expectedResult(results, 1, 'story_get_manuscript'), novel.id, false)
  if (applied.some((chapter, index) => chapter.body.id === before[index]?.body.id || chapter.continuity.id === before[index]?.continuity.id)) throw new Error('T14 update did not replace every affected body and continuity version')
  const last = applied[2]
  if (last === undefined) throw new Error('T14 updated chapter three is missing')
  if (results.length === 2) return next('story_preview', { novelId: novel.id, artifactId: last.body.id })
  if (results.length !== 3) throw new Error('T14 update sequence has extra results')
  checkedPreview(expectedResult(results, 2, 'story_preview'), novel.id, last.body.id)
  return finish('T14 三章正文和连续性均已重新审查并应用，每章三千至五千字；已返回新版第三章预览，历史版本仍可读取。')
}

const sourceRefSchema = z.object({ artifactId: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), kind: z.string(), chars: z.number().int().nonnegative(), revision: z.number().int().positive().nullable() })
const necessitySchema = z.object({ mode: z.enum(['input-only', 'external-required']), reason: z.string(), questions: z.array(z.object({ id: z.string(), kind: z.enum(['internal', 'creative', 'external']), question: z.string(), reason: z.string() })), externalRequirements: z.array(z.object({ questionId: z.string(), outputDecision: z.string(), missingFact: z.string() })) })
const fixtureResearchNecessity = { mode: 'external-required', reason: 'The offline acceptance scene must match its designated navigation reference.', questions: [
  { id: 'fixture-fiction', kind: 'creative', question: '如何保持当前虚构故事的一致性？', reason: '创作决定依据当前完整设定。' },
  { id: 'fixture-reference', kind: 'external', question: 'What does the offline reference report about the lighthouse signal?', reason: 'Read the designated reference through the native web tool and retain its actual evidence.' },
], externalRequirements: [{ questionId: 'fixture-reference', outputDecision: 'Use the designated reference meaning for the lighthouse signal.', missingFact: 'The reference statement identifying the harbor entrance.' }] }
const stageDataSchema = z.object({ kind: z.enum(['research-planning', 'research', 'settings', 'review', 'book-outline', 'chapter-outline', 'body', 'continuity']), novelId: z.string(), inputs: z.array(z.unknown()),
  task: z.string().optional(), purpose: z.string().optional(), briefArtifactId: z.string().optional(), requestId: z.string().optional(), necessity: necessitySchema.optional() })
const stageTaskSchema = z.object({ inputRefs: z.array(z.object({ artifactId: z.string(), sha256: z.string() })), dimensionCode: z.string().optional(),
  chapterNumber: z.number().int().positive().optional(), chapterCount: z.number().int().positive().optional(), sceneIds: z.array(z.string()).optional(),
  obligations: z.array(z.object({ id: z.string(), description: z.string() })).optional(), requiredChecks: z.array(z.enum(['completeness', 'consistency', 'obligations', 'continuity', 'length', 'style'])).optional(),
  reviewed: z.object({ artifactId: z.string(), sha256: z.string() }).optional(), bodyId: z.string().optional(), revisionInstructions: z.string().optional(),
  measuredWordCount: z.number().nullable().optional(), measuredLength: z.object({ status: z.string(), blocking: z.boolean() }).nullable().optional() })
const pageSchema = z.object({ novelId: z.string(), artifactId: z.string(), kind: z.string(), revision: z.number().int().positive(), sha256: z.string(),
  offset: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative(), totalChars: z.number().int().nonnegative(), text: z.string(), eof: z.boolean() })
/** @typedef {{artifactId:string,sha256:string,kind:string,text:string}} SourceText */
/** @template T @param {T|undefined} value @param {string} field @returns {T} */
function required(value, field) { if (value === undefined) throw new Error(`T14 missing ${field}`); return value }

/** @param {Map<string, SourceText>} sources @param {string} id */
function readSource(sources, id) { return required(sources.get(id), `read source ${id}`) }

/** @param {SourceText} source */
function quoteSource(source) {
  const value = JSON.parse(source.text)
  switch (source.kind) {
    case 'settings-dimension': return required(z.object({ facts: z.array(z.object({ statement: z.string() })).nonempty() }).parse(value).facts[0], 'settings fact').statement
    case 'settings': {
      const collection = z.object({ dimensions: z.array(z.object({ facts: z.array(z.object({ statement: z.string() })).nonempty() })).nonempty() }).parse(value)
      return required(required(collection.dimensions[0], 'settings dimension').facts[0], 'settings fact').statement
    }
    case 'book-outline': return z.object({ ending: z.string() }).parse(value).ending
    case 'chapter-outline': return z.object({ throughLine: z.string() }).parse(value).throughLine
    case 'body': return required(z.object({ scenes: z.array(z.object({ text: z.string() })).nonempty() }).parse(value).scenes[0], 'body scene').text.slice(0, 100)
    case 'continuity': return z.object({ summary: z.string() }).parse(value).summary
    default: throw new Error(`T14 cannot quote source kind ${source.kind}`)
  }
}

/** @param {import('zod').infer<typeof stageDataSchema>} data @param {Map<string, SourceText>} sources */
function stageOutput(data, sources) {
  const task = stageTaskSchema.parse(JSON.parse(nonblank(data.task, 'stage task')))
  for (const ref of task.inputRefs) if (readSource(sources, ref.artifactId).sha256 !== ref.sha256) throw new Error('T14 output references differ from fully read inputs')
  const base = { version: 1, inputRefs: task.inputRefs }
  const revised = task.revisionInstructions !== undefined
  const blue = revised || [...sources.values()].some(source => source.kind === 'settings' && source.text.includes('蓝色'))
  const light = blue ? '蓝色' : '白色'
  const revision = revised ? `修订要求：${task.revisionInstructions}` : ''
  switch (data.kind) {
    case 'settings': return { ...base, dimensionCode: required(task.dimensionCode, 'dimensionCode'),
      facts: [{ id: 'lighthouse', statement: `虚构雾港的守灯人林澜以${light}灯光指引归航的船只。` }], contentMarkdown: `# 雾港设定\n\n林澜在雾港追查失踪航海日志。灯塔发出${light}灯光。${revision}` }
    case 'book-outline': return { ...base, contentMarkdown: `# 雾港航标\n\n林澜循${light}灯光查明失踪船只的去向。${revision}`, ending: `林澜点亮${light}航灯，护送船队返航。`,
      characterArcs: [{ character: '林澜', development: '从独自怀疑转向依据证据与同伴合作。' }], chapters: Array.from({ length: required(task.chapterCount, 'chapterCount') }, (_, index) => ({
        chapterNumber: index + 1, title: `第${index + 1}章 雾港航标`, purpose: `查明第${index + 1}处航标并记录证据。`, targetWords: 4000,
        obligations: [{ id: `signal-${index + 1}`, description: `林澜查明第${index + 1}处航标并记录证据。` }],
      })) }
    case 'chapter-outline': return { ...base, chapterNumber: required(task.chapterNumber, 'chapterNumber'), title: `第${task.chapterNumber}章 雾港航标`, targetWords: 4000,
      throughLine: `林澜沿${light}灯光核实航标并护送船只返航。${revision}`, constraints: [`灯塔发出${light}灯光。`], obligations: required(task.obligations, 'obligations'),
      scenes: [{ id: `chapter-${task.chapterNumber}-scene-1`, purpose: '在雾中确认航道并记录证据。', action: required(task.obligations, 'obligations').map(item => item.description).join(''), obligationIds: required(task.obligations, 'obligations').map(item => item.id) }] }
    case 'body': {
      const sceneIds = required(task.sceneIds, 'sceneIds')
      if (sceneIds.length === 0) throw new Error('T14 body requires planned scenes')
      const sentence = `林澜沿着潮湿的石阶走向灯塔，仔细辨认海面上的${light}灯光，确认航道安全后才向岸边的同伴发出信号。`
      return { ...base, chapterNumber: required(task.chapterNumber, 'chapterNumber'), scenes: sceneIds.map((sceneId, index) => ({ sceneId,
        text: `林澜在第${task.chapterNumber}章继续调查雾港。${index === 0 ? required(task.obligations, 'obligations').map(item => item.description).join('') : ''}${sentence.repeat(Math.floor(80 / sceneIds.length) + (index < 80 % sceneIds.length ? 1 : 0))}林澜把确认过的航标记入日志，与同伴一起守住归航的灯光。` })) }
    }
    case 'review': {
      const reviewed = required(task.reviewed, 'reviewed')
      const evidence = [{ artifactId: reviewed.artifactId, quote: quoteSource(readSource(sources, reviewed.artifactId)) }]
      return { ...base, reviewed, checks: required(task.requiredChecks, 'requiredChecks').map(category => ({ category,
        summary: category === 'length' ? `Host word count ${task.measuredWordCount}; ${task.measuredLength?.status}.` : `The exact candidate was read for ${category}.`, evidence })),
      issues: task.measuredLength?.blocking === true ? [{ id: 'fixture-length', severity: 'blocking', category: 'length', location: 'Complete chapter', message: 'Host chapter-total length is outside its required range.', evidence }] : [] }
    }
    case 'continuity': {
      const bodyId = required(task.bodyId, 'bodyId')
      const body = z.object({ chapterNumber: z.number(), scenes: z.array(z.object({ text: z.string() })).nonempty() }).parse(JSON.parse(readSource(sources, bodyId).text))
      if (body.chapterNumber !== task.chapterNumber) throw new Error('T14 continuity must use the actual current chapter body')
      const evidence = [{ artifactId: bodyId, quote: required(body.scenes[0], 'body scene').text.slice(0, 100) }]
      const prior = [...sources.values()].find(source => source.kind === 'continuity')
      const previous = prior === undefined ? null : z.object({ characters: z.array(z.object({ name: z.string(), state: z.string() })), timeline: z.array(z.object({ event: z.string() })) }).parse(JSON.parse(prior.text))
      return { ...base, chapterNumber: required(task.chapterNumber, 'chapterNumber'), summary: `第${task.chapterNumber}章结束时，林澜已核实${light}航灯并记录证据。`,
        characters: [...(previous === null ? [] : previous.characters.filter(character => character.name !== '林澜')), { name: '林澜', state: `已完成第${task.chapterNumber}处航标核查，仍在雾港守灯。` }],
        timeline: [...(previous === null || prior === undefined ? [] : previous.timeline.map(item => ({ event: item.event, evidence: [{ artifactId: prior.artifactId, quote: item.event }] }))), { event: `林澜完成第${task.chapterNumber}处航标核查。`, evidence }],
        obligations: required(task.obligations, 'obligations').map(item => ({ id: item.id, status: 'fulfilled', explanation: item.description, evidence })) }
    }
    default: throw new Error('T14 research requires its native plan workflow')
  }
}

/** @param {GenerateOptions} options @param {string} prompt @returns {StreamChunk[]} */
function respondStage(options, prompt) {
  const data = stageDataSchema.parse(JSON.parse(prompt.slice(prompt.indexOf(stageMarker) + stageMarker.length)))
  const childId = nonblank(options.sessionId, 'native child Session')
  const refs = data.inputs.map(value => {
    const ref = record(value, 'stage input')
    return sourceRefSchema.parse({ artifactId: (data.kind === 'research' || data.kind === 'research-planning') ? ref.id : ref.artifactId, sha256: ref.sha256, kind: ref.kind, chars: ref.chars, revision: (data.kind === 'research' || data.kind === 'research-planning') ? ref.revision : null })
  })
  const results = writingResults(options.messages)
  /** @type {Map<string, SourceText>} */
  const sources = new Map()
  /** @param {string} name @param {object} args */
  const next = (name, args) => callTool(options, `t14-child-${results.length}`, name, args)
  for (const ref of refs) {
    let offset = 0
    let text = ''
    let eof = false
    for (const entry of results.filter(entry => entry.name === 'story_read_artifact' && record(JSON.parse(entry.arguments), 'reader arguments').artifactId === ref.artifactId)) {
      const args = record(JSON.parse(entry.arguments), 'reader arguments')
      const page = pageSchema.parse(resultValue(entry))
      if (eof || args.novelId !== data.novelId || args.offset !== offset || args.limit !== 4096 || page.novelId !== data.novelId || page.artifactId !== ref.artifactId
        || page.sha256 !== ref.sha256 || page.kind !== ref.kind || page.totalChars !== ref.chars || (ref.revision !== null && page.revision !== ref.revision)
        || page.offset !== offset || page.nextOffset !== offset + [...page.text].length || page.nextOffset > ref.chars
        || page.eof !== (page.nextOffset === ref.chars) || (!page.eof && page.nextOffset <= offset)) throw new Error('T14 reader page differs from the exact input version or interval')
      text += page.text
      offset = page.nextOffset
      eof = page.eof
    }
    if (!eof) return next('story_read_artifact', { novelId: data.novelId, artifactId: ref.artifactId, offset, limit: 4096 })
    if (createHash('sha256').update(text, 'utf8').digest('hex') !== ref.sha256) throw new Error('T14 readback digest differs from the exact source bytes')
    sources.set(ref.artifactId, { artifactId: ref.artifactId, sha256: ref.sha256, kind: ref.kind, text })
  }
  if (data.kind === 'research-planning') return next('structured_output', fixtureResearchNecessity)
  if (data.kind !== 'research') return next('structured_output', stageOutput(data, sources))
  const novelId = data.novelId
  const briefArtifactId = nonblank(data.briefArtifactId, 'research brief')
  const requestId = nonblank(data.requestId, 'research requestId')
  const steps = results.filter(entry => entry.name !== 'story_read_artifact')
  const necessity = necessitySchema.parse(data.necessity)
  if (steps.length === 0) return next('story_start_research', { novelId, briefArtifactId, requestId, questions: necessity.questions })
  const plan = z.object({ planId: z.string(), novelId: z.string(), briefArtifactId: z.string(), sessionId: z.string() }).parse(expectedResult(steps, 0, 'story_start_research'))
  if (plan.novelId !== novelId || plan.briefArtifactId !== briefArtifactId || plan.sessionId !== childId) throw new Error('T14 research plan has a different owner or brief')
  if (steps.length === 1) return next('web_fetch', { url: referenceUrl })
  const fetched = required(steps[1], 'native fetch result')
  if (fetched.name !== 'web_fetch' || fetched.result.isError === true || record(JSON.parse(fetched.arguments), 'fetch arguments').url !== referenceUrl) throw new Error('T14 native offline reference fetch failed')
  if (steps.length === 2) return next('story_research_results', { novelId, planId: plan.planId })
  const sourceSchema = z.object({ sourceIndex: z.literal(0), url: z.literal(referenceUrl), title: z.string().nullable(),
    bodyStart: z.number().int().nonnegative(), bodyEnd: z.number().int().positive(), totalChars: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    httpStatus: z.literal(200), nativeTruncated: z.literal(false), eligibility: z.literal('usable') })
  const observations = z.array(z.object({ callId: z.string(), name: z.literal('web_fetch'), input: z.object({ url: z.literal(referenceUrl) }),
    callSeq: z.number().int().nonnegative(), resultSeq: z.number().int().nonnegative(), status: z.literal('succeeded'), error: z.null(), sources: z.array(sourceSchema).length(1),
  })).length(1).parse(expectedResult(steps, 2, 'story_research_results'))
  const observation = required(observations[0], 'native reference observation')
  const evidence = required(observation.sources[0], 'native reference source')
  const nativeText = fetched.result.content.length === 1 && fetched.result.content[0]?.type === 'text' ? fetched.result.content[0].text : ''
  if (observation.callId !== fetched.result.toolCallId || observation.resultSeq <= observation.callSeq || !nativeText.includes(referenceMarker)
    || [...nativeText].length !== evidence.totalChars || createHash('sha256').update(nativeText, 'utf8').digest('hex') !== evidence.sha256
    || evidence.bodyEnd <= evidence.bodyStart || evidence.bodyEnd > evidence.totalChars) throw new Error('T14 research evidence differs from the actual complete native fetch')
  const selection = { callId: observation.callId, sourceIndex: evidence.sourceIndex, offset: evidence.bodyStart, limit: evidence.bodyEnd - evidence.bodyStart }
  if (steps.length === 3) return next('story_read_research_source', { novelId, planId: plan.planId, ...selection })
  const page = sourceSchema.extend({ callId: z.string(), offset: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative(), eof: z.boolean(), text: z.string(), remainingReadChars: z.number().int().nonnegative() }).parse(expectedResult(steps, 3, 'story_read_research_source'))
  const expectedText = [...nativeText].slice(evidence.bodyStart, evidence.bodyEnd).join('')
  if (page.callId !== observation.callId || page.sourceIndex !== evidence.sourceIndex || page.sha256 !== evidence.sha256 || page.offset !== selection.offset
    || page.nextOffset !== evidence.bodyEnd || page.text !== expectedText || !page.text.includes(referenceMarker) || page.eof !== (page.nextOffset === page.totalChars)) throw new Error('T14 source page differs from the exact recorded body')
  if (steps.length === 4) return next('story_complete_research', { novelId, planId: plan.planId, requestId,
    findings: [
      { questionId: 'fixture-fiction', callIds: [], selections: [], conclusion: `Preserve this fictional premise: ${readSource(sources, briefArtifactId).text}`, adequate: true },
      { questionId: 'fixture-reference', callIds: [observation.callId], selections: [selection], conclusion: `Offline reference evidence: ${page.text}`, adequate: true },
    ] })
  z.object({ outcome: z.literal('succeeded'), result: artifactSchema }).parse(expectedResult(steps, 4, 'story_complete_research'))
  if (steps.length === 5) return next('story_get_research', { novelId, planId: plan.planId })
  const completed = z.object({ planId: z.string(), outcome: z.literal('succeeded'), stale: z.literal(false), result: artifactSchema }).parse(expectedResult(steps, 5, 'story_get_research'))
  if (steps.length !== 6 || completed.planId !== plan.planId) throw new Error('T14 research readback does not identify its completed plan')
  return next('structured_output', { planId: plan.planId })
}

/** @param {GenerateOptions} options @returns {StreamChunk[]} */
function respond(options) {
  const prompts = options.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' && block.text.includes(stageMarker) ? [block.text] : []))
  if (prompts.length > 1) throw new Error('T14 native child has multiple task prompts')
  if (prompts[0] !== undefined) return respondStage(options, prompts[0])
  const index = options.messages.findLastIndex(message => message.role === 'user' && message.source?.kind === 'user')
  const user = options.messages[index]
  const command = user?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
  if (command === writingCommand || command === revisionCommand || command === refreshCommand) return respondWriting(options, index, command)
  return respondLegacy(options)
}

class StoryFixtureModel extends LlmAdapter {
  /** @override @param {string} requestedProvider */
  listModels(requestedProvider) {
    return this.resolveModel(requestedProvider, model).then(info => [info])
  }

  /** @override @param {string} requestedProvider @param {string} requestedModel */
  resolveModel(requestedProvider, requestedModel) {
    if (requestedProvider !== provider || requestedModel !== model) {
      throw new Error('T01 fixture only supports story-fixture/deterministic')
    }
    return Promise.resolve({ provider, id: model, name: 'Story offline writing fixture', context: { contextWindow: 262144 } })
  }

  /** @override @param {GenerateOptions} options @returns {AsyncIterable<StreamChunk>} */
  async * stream(options) {
    await this.resolveModel(options.provider, options.model)
    if (options.purpose !== undefined) throw new Error(`T01 fixture does not support auxiliary requests: ${options.purpose}`)
    options.signal?.throwIfAborted()
    for (const chunk of respond(options)) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

/** Test-only Cordis plugin identity. */
export const name = 'story-web-fixture'

/** The existing Host LLM and web registries own offline route and provider lifetimes. */
export const inject = ['llm', 'web']

/**
 * Register the offline route for the lifetime of this test entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Isolated test profile context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.llm.registerAdapter([provider], new StoryFixtureModel()))
  ctx.effect(() => ctx.web.registerSearchProvider({ id: 'story-fixture-search', available: () => true, search: async () => ({ sources: [], truncated: false }) }))
  ctx.effect(() => ctx.web.registerFetchProvider({ id: 'story-fixture-fetch', available: () => true, fetch: async (request, signal) => {
    signal?.throwIfAborted()
    if (request.url !== referenceUrl) throw new Error('The offline fixture does not serve this URL')
    return { url: request.url, statusCode: 200, body: { kind: 'text', content: referenceBody }, truncated: false }
  } }))
}
