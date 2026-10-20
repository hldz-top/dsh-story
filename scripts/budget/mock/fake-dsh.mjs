#!/usr/bin/env node
// Offline stand-in for `dsh --profile headless`. No model and no network.
// Writes the files the watchdog reads: story_runs.json, one zstd session per attempt, and
// parent step_end lines on stdout. On SIGINT, in-flight calls are not logged, the run stays
// `running`, and the process exits 130.
import { Buffer } from 'node:buffer'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { zstdCompressSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import process, { env, exit, stderr, stdout } from 'node:process'

function integer(name, fallback) {
  const raw = env[name]
  const value = raw === undefined || raw === '' ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    stderr.write(`fake-dsh: ${name} must be a non-negative integer\n`)
    exit(1)
  }
  return value
}

const home = env.MOCK_HOME
if (typeof home !== 'string' || home.length === 0) {
  stderr.write('fake-dsh: MOCK_HOME is required\n')
  exit(1)
}
const calls = integer('MOCK_CALLS', 260)
const uncached = integer('MOCK_INPUT', 5200)
const cached = integer('MOCK_CACHED', 0)
const parallel = integer('MOCK_PAR', 2)
const latency = integer('MOCK_CALL_MS', 300)
const perAttempt = integer('MOCK_PER_ATTEMPT', 6)
const parentEvery = integer('MOCK_PARENT_EVERY', 40)
if (parallel < 1) {
  stderr.write('fake-dsh: MOCK_PAR must be at least 1\n')
  exit(1)
}

const usage = {
  prompt_tokens: uncached + cached,
  completion_tokens: 900,
  prompt_tokens_details: { cached_tokens: cached },
  inputTokens: uncached,
  outputTokens: 900,
  cacheReadTokens: cached,
}
const storeFile = `${home}/storages/story_runs.json`
mkdirSync(`${home}/storages`, { recursive: true })
mkdirSync(`${home}/sessions/ws-mock`, { recursive: true })
const store = existsSync(storeFile)
  ? JSON.parse(readFileSync(storeFile, 'utf8'))
  : { tables: { novels: { novel_mock: { runs: [] } } } }
const runs = store.tables.novels.novel_mock.runs
let run = env.MOCK_RESUME === '1' ? runs.findLast(item => item.status !== 'completed') : undefined
if (env.MOCK_RESUME === '1' && run === undefined) {
  stderr.write('fake-dsh: no unfinished run to resume\n')
  exit(1)
}
if (run === undefined) {
  run = { id: `run_${randomUUID().slice(0, 8)}`, status: 'running', attempts: [] }
  runs.push(run)
} else {
  run.status = 'running'
}
const save = () => {
  writeFileSync(`${storeFile}.tmp`, JSON.stringify(store))
  renameSync(`${storeFile}.tmp`, storeFile)
}
save()
const truth = {
  runId: run.id,
  resumed: env.MOCK_RESUME === '1',
  started: 0,
  completed: 0,
  child: 0,
  parent: 0,
  aborted: 0,
  inFlightAtSigint: null,
  completedAtSigint: null,
  sigintAt: null,
  exit: null,
  startedAt: Date.now(),
}
let stopping = false
const waiters = new Set()
const sleep = ms => new Promise(resolve => {
  const timer = setTimeout(() => {
    waiters.delete(wake)
    resolve(true)
  }, ms)
  const wake = () => {
    clearTimeout(timer)
    resolve(false)
  }
  waiters.add(wake)
})
process.on('SIGINT', () => {
  if (stopping) return
  stopping = true
  truth.sigintAt = Date.now()
  truth.inFlightAtSigint = truth.started - truth.completed
  truth.completedAtSigint = truth.completed
  const pending = []
  for (const wake of waiters) pending.push(wake)
  waiters.clear()
  for (const wake of pending) wake()
})
const emit = line => {
  stdout.write(`${JSON.stringify(line)}\n`)
}
async function call(kind, session) {
  if (stopping || truth.started >= calls) return false
  truth.started += 1
  const finished = await sleep(latency)
  if (!finished) {
    truth.aborted += 1
    return false
  }
  if (kind === 'child') {
    appendFileSync(session, zstdCompressSync(Buffer.from(`${JSON.stringify({
      type: 'assistant/message',
      seq: truth.completed,
      time: Date.now(),
      data: { message: { role: 'assistant', usage } },
    })}\n`)))
  } else {
    emit({ type: 'agent/step', phase: 'step_end', usage })
  }
  truth.completed += 1
  truth[kind] += 1
  if (truth.completed >= calls && run.status !== 'completed') {
    run.status = 'completed'
    save()
  }
  return true
}
let childDone = 0
async function worker() {
  while (!stopping && truth.started < calls) {
    const sid = `sess-${randomUUID()}`
    mkdirSync(`${home}/sessions/ws-mock/${sid}`, { recursive: true })
    run.attempts.push({ childSessionId: sid, request: { key: `stage/${run.attempts.length}` }, status: 'running' })
    save()
    const file = `${home}/sessions/ws-mock/${sid}/session.v4.jsonl.zstd`
    for (let index = 0; index < perAttempt; index += 1) {
      if (!(await call('child', file))) break
      childDone += 1
      if (childDone % parentEvery === 0) await call('parent')
    }
  }
}
await call('parent')
await call('parent')
await Promise.all(Array.from({ length: parallel }, () => worker()))
if (!stopping && run.status !== 'completed') {
  await call('parent')
  run.status = 'completed'
  save()
}
truth.exit = stopping ? 130 : 0
truth.endedAt = Date.now()
if (env.MOCK_TRUTH) writeFileSync(env.MOCK_TRUTH, JSON.stringify(truth, null, 1))
exit(truth.exit)
