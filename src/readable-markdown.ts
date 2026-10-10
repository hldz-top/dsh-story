/**
 * Inert, readable Markdown for recorded text in document previews.
 *
 * Recorded prose, model findings and quoted sources are data, not document structure. They must read as ordinary
 * paragraphs in the host preview without being able to add headings, lists, links, images, raw HTML, tables, math or
 * code. Backslash escapes are not used: the host preview grammar treats `\(` and `\[` as TeX math delimiters, so every
 * syntax character is written as a numeric character reference, which CommonMark always decodes to literal text.
 *
 * Web addresses: GFM recognizes `http://`, `https://`, `www.` and e-mail literals while tokenizing the raw source, and a
 * literal recognized there would swallow the character references after it into its text and destination. These
 * triggers are therefore also encoded, so tokenizing never starts a literal. GFM's second pass then finds the address
 * in the decoded text and links it with its exact visible characters, including `&`, `#`, `_` and parentheses. Only
 * such web addresses become links; model text cannot choose a link's label or target.
 */

/**
 * Characters that start inline or block constructs anywhere in a line (CommonMark, GFM and the host's math syntax).
 * An underscore between two letters or digits can neither open nor close emphasis, so identifiers such as
 * `artifact_…` stay searchable in the raw file.
 */
const SYNTAX_CHARACTERS = /[\\`*~[\]<>&$|#]|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu
/** GFM autolink-literal triggers: the `:` of `scheme://`, the `.` after `www`, and every `@`. */
const AUTOLINK_TRIGGERS = /:(?=\/\/)|(?<=(?<![\p{L}\p{N}_])www)\.|@/giu
/** Line-start bullet-list and setext-underline markers that are inert elsewhere in a line. */
const LINE_START_MARKER = /^[-+=]/
/** Line-start ordered-list marker: up to nine digits followed by `.` or `)`. */
const ORDERED_MARKER = /^(\d{1,9})([.)])/

function reference(character: string): string {
  return `&#${character.codePointAt(0)};`
}

/**
 * @param line - One recorded line without its terminator.
 * @returns The same visible text as an inert Markdown line; leading indentation is kept as no-break spaces so it cannot
 * open an indented code block, and trailing whitespace is dropped so it cannot form a line break.
 */
function inertLine(line: string): string {
  const trimmed = line.replace(/[ \t]+$/, '')
  const indent = /^[ \t]*/.exec(trimmed)![0]
  const body = trimmed.slice(indent.length).replace(SYNTAX_CHARACTERS, reference).replace(AUTOLINK_TRIGGERS, reference)
    .replace(LINE_START_MARKER, reference)
    .replace(ORDERED_MARKER, (_match, digits: string, delimiter: string) => digits + reference(delimiter))
  return indent.replaceAll(' ', '\u00a0').replaceAll('\t', '\u00a0'.repeat(4)) + body
}

/**
 * Render recorded text as readable paragraphs. Blank lines separate paragraphs and single line breaks stay visible as
 * hard breaks, so Chinese prose keeps its original paragraphing.
 * @param text - Exact recorded text.
 * @returns Inert Markdown showing the recorded words and line breaks, or an empty string for blank input.
 */
export function readableText(text: string): string {
  const paragraphs: string[][] = [[]]
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = inertLine(raw)
    if (line === '') {
      if (paragraphs.at(-1)!.length > 0) paragraphs.push([])
      continue
    }
    paragraphs.at(-1)!.push(line)
  }
  return paragraphs.filter(lines => lines.length > 0).map(lines => lines.join('  \n')).join('\n\n')
}

/**
 * @param text - Exact quoted text, such as a cited excerpt or source material.
 * @returns The text as an inert Markdown blockquote.
 */
export function quotedText(text: string): string {
  return readableText(text).split('\n').map(line => line === '' ? '>' : `> ${line}`).join('\n')
}

/**
 * @param items - Recorded single-entry values, such as provenance lines.
 * @returns An inert Markdown bullet list with one item per entry.
 */
export function readableList(items: readonly string[]): string {
  return items.map(item => `- ${readableText(item).split('\n').map((line, index) => index === 0 || line === '' ? line : `  ${line}`).join('\n')}`).join('\n')
}

/**
 * Machine output such as a raw model response, kept verbatim. The fence is longer than any backtick run in the text, so
 * the content cannot close it early.
 * @param text - Exact text.
 * @returns The text inside a `text` code fence.
 */
export function literalTextBlock(text: string): string {
  let length = 3
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1)
  const fence = '`'.repeat(length)
  return `${fence}text\n${text}\n${fence}`
}
