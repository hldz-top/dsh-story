#!/usr/bin/env node
// Read-only usage for one DSH home. Never calls a model and never reads provider keys.
//
// Uncached input (the only number the 10M budget counts):
//   - OpenAI-format usage (Aliyun token plan): prompt_tokens, minus
//     prompt_tokens_details.cached_tokens when that object exists and cached_tokens
//     is a numeric token count. Missing prompt_tokens_details means there is no cache
//     info, so every prompt_token counts (conservative). A missing or non-numeric
//     prompt_tokens is a hard failure, not 0.
//   - Otherwise pi-ai's normalised inputTokens, which is already
//     prompt_tokens - cached_tokens - cache_write_tokens. A missing or non-numeric
//     inputTokens is a hard failure. A present 0 is a real zero. pi-ai treats a missing
//     cached_tokens as 0 before that subtraction, which over-counts; see the README.
//
//   node usage.mjs <home>
//   node usage.mjs --batch     JSON {"usages":[...]} on stdin, one total on stdout
import { Buffer } from 'node:buffer'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { argv, exit, stderr, stdout } from 'node:process'

function fail(message) {
  stderr.write(`usage: ${message}\n`)
  exit(1)
}

function isTokenCount(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value)
}

// First defined usage wins. null is present and means the field was explicitly empty.
function usageOf(event) {
  const candidates = [
    event?.data?.message?.usage,
    event?.data?.usage,
    event?.message?.usage,
    event?.usage,
  ]
  for (const candidate of candidates) {
    if (candidate !== undefined) return candidate
  }
  return undefined
}

function uncachedOf(usage, where) {
  if (usage === null || usage === undefined || typeof usage !== 'object' || Array.isArray(usage)) {
    fail(`${where}: usage is missing`)
  }
  let uncached
  let cacheRead = null
  let cacheKnown = false
  if (Object.prototype.hasOwnProperty.call(usage, 'prompt_tokens')
    || Object.prototype.hasOwnProperty.call(usage, 'prompt_tokens_details')) {
    if (!Object.prototype.hasOwnProperty.call(usage, 'prompt_tokens') || !isTokenCount(usage.prompt_tokens)) {
      fail(`${where}: prompt_tokens is missing or not numeric`)
    }
    const details = usage.prompt_tokens_details
    if (details === undefined || details === null) {
      uncached = usage.prompt_tokens
    } else if (typeof details !== 'object' || Array.isArray(details)
      || !Object.prototype.hasOwnProperty.call(details, 'cached_tokens')
      || !isTokenCount(details.cached_tokens)) {
      fail(`${where}: prompt_tokens_details.cached_tokens is missing or not numeric`)
    } else if (details.cached_tokens > usage.prompt_tokens) {
      fail(`${where}: cached_tokens exceeds prompt_tokens`)
    } else {
      uncached = usage.prompt_tokens - details.cached_tokens
      cacheRead = details.cached_tokens
      cacheKnown = true
    }
  } else if (!Object.prototype.hasOwnProperty.call(usage, 'inputTokens') || !isTokenCount(usage.inputTokens)) {
    fail(`${where}: inputTokens is missing or not numeric`)
  } else {
    uncached = usage.inputTokens
    if (Object.prototype.hasOwnProperty.call(usage, 'cacheReadTokens')) {
      if (!isTokenCount(usage.cacheReadTokens)) fail(`${where}: cacheReadTokens is not numeric`)
      cacheRead = usage.cacheReadTokens
      cacheKnown = true
    }
  }
  let output = null
  let outputKnown = false
  const outputKey = Object.prototype.hasOwnProperty.call(usage, 'completion_tokens')
    ? 'completion_tokens'
    : Object.prototype.hasOwnProperty.call(usage, 'outputTokens') ? 'outputTokens' : null
  if (outputKey !== null) {
    if (!isTokenCount(usage[outputKey])) fail(`${where}: ${outputKey} is not numeric`)
    output = usage[outputKey]
    outputKnown = true
  }
  return { uncached, cacheRead, cacheKnown, output, outputKnown }
}

function sumUsages(usages, whereOf) {
  let input = 0
  let cache = 0
  let output = 0
  let cacheKnown = true
  let outputKnown = true
  for (let index = 0; index < usages.length; index += 1) {
    const row = uncachedOf(usages[index], whereOf(index))
    input += row.uncached
    if (!row.cacheKnown) cacheKnown = false
    else cache += row.cacheRead
    if (!row.outputKnown) outputKnown = false
    else output += row.output
  }
  return {
    steps: usages.length,
    input,
    cacheRead: cacheKnown ? cache : null,
    output: outputKnown ? output : null,
  }
}

function frames(bytes) {
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const at = []
  for (let index = bytes.indexOf(magic); index >= 0; index = bytes.indexOf(magic, index + 1)) at.push(index)
  let text = ''
  for (let index = 0; index < at.length; index += 1) {
    const slice = bytes.subarray(at[index], at[index + 1] ?? bytes.length)
    try {
      text += zstdDecompressSync(slice).toString('utf8')
    } catch (cause) {
      if (index === at.length - 1) continue
      fail(`session frame ${index} failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  return text.split('\n').filter(line => line.length > 0)
}

function eventsOf(file) {
  const parsed = []
  for (const line of frames(readFileSync(file))) {
    try {
      parsed.push(JSON.parse(line))
    } catch (cause) {
      fail(`${file}: invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  return parsed
}

function readHome(home) {
  const storePath = `${home}/storages/story_runs.json`
  if (!existsSync(storePath)) fail(`missing ${storePath}`)
  let store
  try {
    store = JSON.parse(readFileSync(storePath, 'utf8'))
  } catch (cause) {
    fail(`${storePath}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  const novels = store?.tables?.novels
  if (novels === null || typeof novels !== 'object' || Array.isArray(novels)) {
    fail(`${storePath}: missing tables.novels`)
  }
  const sessions = `${home}/sessions`
  const dirs = new Map()
  if (existsSync(sessions)) {
    for (const workspace of readdirSync(sessions)) {
      const workspacePath = `${sessions}/${workspace}`
      for (const id of readdirSync(workspacePath)) dirs.set(id, `${workspacePath}/${id}`)
    }
  }
  const usages = []
  for (const novel of Object.values(novels)) {
    if (!Array.isArray(novel?.runs)) fail('novel.runs is missing')
    for (const run of novel.runs) {
      if (typeof run?.id !== 'string' || typeof run?.status !== 'string') fail('run is missing id or status')
      if (!Array.isArray(run.attempts)) fail(`${run.id}: attempts is missing`)
      stdout.write(`RUN ${run.id} ${run.status}\n`)
      for (const attempt of run.attempts) {
        const id = attempt?.childSessionId
        if (typeof id !== 'string' || id.length === 0) fail(`${run.id}: attempt is missing childSessionId`)
        const dir = dirs.get(id)
        if (dir === undefined) continue
        const file = `${dir}/session.v4.jsonl.zstd`
        if (!existsSync(file)) continue
        for (const event of eventsOf(file)) {
          if (event?.type !== 'assistant/message') continue
          const usage = usageOf(event)
          if (usage === undefined) fail(`${file}: assistant message has no usage`)
          usages.push(usage)
        }
      }
    }
  }
  const total = sumUsages(usages, index => `assistant/message[${index}]`)
  stdout.write(`TOTAL ${JSON.stringify(total)}\n`)
}

function readBatch() {
  let body
  try {
    body = JSON.parse(readFileSync(0, 'utf8'))
  } catch (cause) {
    fail(`batch JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!Array.isArray(body?.usages)) fail('batch JSON needs a usages array')
  const total = sumUsages(body.usages, index => `usages[${index}]`)
  stdout.write(`${JSON.stringify(total)}\n`)
}

const mode = argv[2]
if (mode === '--batch') readBatch()
else if (typeof mode === 'string' && mode.length > 0 && !mode.startsWith('--')) readHome(mode)
else fail('usage: node usage.mjs <home> | node usage.mjs --batch')
