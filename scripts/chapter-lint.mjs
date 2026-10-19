#!/usr/bin/env node
// Offline, report-only chapter lint (src/chapter-lint.ts). Reads drafts; never calls a model or writes a store.
import { readFileSync } from 'node:fs'
import { argv, exit, stderr, stdout } from 'node:process'
import { chapterFromMarkdown, JsonSyntaxError, LintInputError, lintChapter, parseJson, parseLintBody, parseLintOutline, parseTypoTable, storedArtifactText } from '../src/chapter-lint.ts'

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
// Error lines name the file (and, for --store, the artifact), then the JSON position: `<file>:<line>:<column>` for syntax
// errors, `<file>: <$.field.path>` for structure and type errors.
function parse(text, label, sep = ':') {
  try { return parseJson(text) } catch (cause) {
    if (cause instanceof JsonSyntaxError) return fail(`${label}${sep}${cause.line}:${cause.column}: invalid JSON: ${cause.message}`)
    throw cause
  }
}
function check(validate, value, label) {
  try { return validate(value) } catch (cause) {
    if (cause instanceof LintInputError) return fail(`${label}: ${cause.path}: ${cause.message}`)
    throw cause
  }
}

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
      const label = raw.slice(0, split), pattern = raw.slice(split + 1)
      try { new RegExp(pattern, 'u') } catch { fail(`--anchor ${label}: invalid regular expression ${JSON.stringify(pattern)}`) }
      options.anchors.push({ label, pattern })
    } else if (arg.startsWith('-')) fail(`unknown option ${arg}`)
    else input = arg
  }

  let chapter
  if (store !== undefined) {
    if (bodyId === undefined) fail('--store needs --body-id')
    const data = parse(read(store), store)
    const artifact = (id, validate) => {
      const label = `${store}: artifact ${id}`
      return check(validate, parse(check(value => storedArtifactText(value, id), data, store), label, ': '), label)
    }
    chapter = artifact(bodyId, parseLintBody)
    if (outlineId !== undefined) options.outline = artifact(outlineId, parseLintOutline)
  } else {
    if (input === undefined) fail('missing <body.json | chapter.md>')
    const text = read(input)
    chapter = input.endsWith('.json') ? check(parseLintBody, parse(text, input), input) : chapterFromMarkdown(text)
  }
  if (outlinePath !== undefined) options.outline = check(parseLintOutline, parse(read(outlinePath), outlinePath), outlinePath)
  if (typosPath !== undefined) options.typos = check(parseTypoTable, parse(read(typosPath), typosPath), typosPath)

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
  // One line, no stack: bad arguments, unreadable files and input the lint cannot interpret (wrong structure, bad --anchor regex,
  // bad typo table) are all reported as UsageError above. Anything else is a lint defect; its engine text is not shown.
  const message = cause instanceof UsageError ? cause.message : `internal error (${cause instanceof Error ? cause.name : typeof cause}); please report the command and input`
  stderr.write(`chapter-lint: ${message.replace(/\s*\n\s*/g, ' ')}\n`)
  exit(2)
}
