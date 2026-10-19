#!/usr/bin/env node
// Offline, report-only chapter lint (src/chapter-lint.ts). Reads drafts; never calls a model or writes a store.
import { readFileSync } from 'node:fs'
import { argv, exit, stderr, stdout } from 'node:process'
import { chapterFromMarkdown, lintChapter } from '../src/chapter-lint.ts'

const USAGE = `Usage:
  node scripts/chapter-lint.mjs <body.json | chapter.md> [--outline outline.json] [--typos table.json] [--anchor 标签=正则]... [--json]
  node scripts/chapter-lint.mjs --store $DSH_HOME/storages/story_writing.json --body-id artifact_… [--outline-id artifact_…] [...]
  node scripts/chapter-lint.mjs --help
Input files must be UTF-8. Exit code: 0 after a report (findings never fail it); 2 for bad arguments or invalid input.
`

class UsageError extends Error {}
function fail(message) { throw new UsageError(message) }

function read(path) {
  let bytes
  try { bytes = readFileSync(path) } catch (cause) { return fail(`cannot read ${path}: ${cause.message}`) }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return fail(`${path} is not valid UTF-8`) }
}
function parse(text, label) { try { return JSON.parse(text) } catch { return fail(`${label} is not JSON`) } }

function main(args) {
  const options = { anchors: [] }
  let input, store, bodyId, outlineId, outlinePath, typosPath, json = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    const value = () => args[++index] ?? fail(`${arg} needs a value`)
    if (arg === '--help' || arg === '-h') { stdout.write(USAGE); return }
    else if (arg === '--outline') outlinePath = value()
    else if (arg === '--typos') typosPath = value()
    else if (arg === '--store') store = value()
    else if (arg === '--body-id') bodyId = value()
    else if (arg === '--outline-id') outlineId = value()
    else if (arg === '--json') json = true
    else if (arg === '--anchor') {
      const raw = value()
      const split = raw.indexOf('=')
      if (split <= 0) fail('--anchor expects 标签=正则')
      options.anchors.push({ label: raw.slice(0, split), pattern: raw.slice(split + 1) })
    } else if (arg.startsWith('-')) fail(`unknown option ${arg}`)
    else input = arg
  }

  let chapter
  if (store !== undefined) {
    const artifacts = parse(read(store), store).tables?.artifacts ?? fail(`${store} has no artifacts table`)
    const text = id => artifacts[id]?.text ?? fail(`artifact ${id} not found in ${store}`)
    if (bodyId === undefined) fail('--store needs --body-id')
    chapter = parse(text(bodyId), bodyId)
    if (outlineId !== undefined) options.outline = parse(text(outlineId), outlineId)
  } else {
    if (input === undefined) fail('missing <body.json | chapter.md>')
    const text = read(input)
    chapter = input.endsWith('.json') ? parse(text, input) : chapterFromMarkdown(text)
  }
  if (outlinePath !== undefined) options.outline = parse(read(outlinePath), outlinePath)
  if (typosPath !== undefined) options.typos = parse(read(typosPath), typosPath)

  const report = lintChapter(chapter, options)
  if (json) stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else {
    const lines = [`chars ${report.chars}（码点，含标点与空白，不含标题）`, `【】独立行 ${report.panels.count} 条（名义 ${report.panels.nominal ?? '-'}，上限 ${report.panels.max ?? '-'}）`]
    for (const line of report.panels.lines) lines.push(`  #${line.index} ${line.percent}% ${line.text}`)
    for (const scene of report.positions.scenes) lines.push(`scene ${scene.sceneId} ${scene.offset} / ${scene.percent}%`)
    for (const anchor of report.positions.anchors) lines.push(`anchor ${anchor.label} ${anchor.match === null ? '未找到' : `${anchor.match.offset} / ${anchor.match.percent}%「${anchor.match.text}」`}`)
    for (const item of report.literals.required) lines.push(`literal ${item.literal} ×${item.occurrences.length}`)
    lines.push(`findings ${report.findings.length}`)
    for (const finding of report.findings) lines.push(`  [${finding.severity}] ${finding.code} ${finding.message}`)
    stdout.write(`${lines.join('\n')}\n`)
  }
}

try {
  main(argv.slice(2))
} catch (cause) {
  // One line, no stack: bad arguments, unreadable files and input the lint cannot interpret (wrong structure, bad --anchor regex, bad typo table).
  const message = cause instanceof UsageError ? cause.message : `invalid input: ${cause instanceof Error ? cause.message : String(cause)}`
  stderr.write(`chapter-lint: ${message.replace(/\s*\n\s*/g, ' ')}\n`)
  exit(2)
}
