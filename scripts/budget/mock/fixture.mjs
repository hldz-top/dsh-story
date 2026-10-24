#!/usr/bin/env node
// Append one child attempt whose single assistant/message carries the given usage.
// The last argument is a JSON usage value, or ABSENT to omit the usage field.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { zstdCompressSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { argv, exit, stderr } from 'node:process'

const [home, raw] = argv.slice(2)
if (typeof home !== 'string' || typeof raw !== 'string') {
  stderr.write('usage: node fixture.mjs <home> <usage-json|ABSENT>\n')
  exit(2)
}
const storeFile = `${home}/storages/story_runs.json`
const store = JSON.parse(readFileSync(storeFile, 'utf8'))
const novels = store.tables.novels
const key = Object.keys(novels)[0] ?? 'n'
novels[key] ??= { runs: [] }
const runs = novels[key].runs
let run = runs.find(item => item.status !== 'completed')
if (run === undefined) {
  run = { id: `run_${randomUUID().slice(0, 8)}`, status: 'running', attempts: [] }
  runs.push(run)
}
const sid = `sess-${randomUUID()}`
run.attempts.push({ childSessionId: sid, request: { key: `stage/${run.attempts.length}` }, status: 'running' })
mkdirSync(`${home}/sessions/ws/${sid}`, { recursive: true })
const event = { type: 'assistant/message', data: { message: { role: 'assistant' } } }
if (raw !== 'ABSENT') event.data.message.usage = JSON.parse(raw)
appendFileSync(
  `${home}/sessions/ws/${sid}/session.v4.jsonl.zstd`,
  zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`)),
)
writeFileSync(storeFile, JSON.stringify(store))
