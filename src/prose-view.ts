/**
 * Reader-facing plain-text view of a stored artifact, served to review stages so that every quote they can copy is
 * prose rather than JSON scaffolding. A chapter body becomes exactly its assembled scenes (the text its evidence is
 * checked against); another structured (JSON) artifact becomes its human-readable string values, one per line, with
 * field names, identifiers, digests and JSON punctuation removed; plain-text artifacts are served unchanged.
 */
import { assembleBody } from './body-text.ts'
import { StageOutputSchemas } from './stage-output.ts'

/** A string value that is only an identifier, digest, code or enum literal, never reader-facing prose. */
const IDENTIFIER = /^[\w.:/@+-]*$/u

function strings(value: unknown, into: string[]): void {
  if (typeof value === 'string') { if (value.trim().length > 0 && !IDENTIFIER.test(value)) into.push(value) }
  else if (Array.isArray(value)) for (const item of value) strings(item, into)
  else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) strings(item, into)
}

/** @param kind - Stored artifact kind. @param text - Exact stored text. @returns The plain-text view; deterministic for a given stored text. */
export function proseView(kind: string, text: string): string {
  if (!/^\s*[[{]/u.test(text)) return text
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return text }
  if (kind === 'body') {
    const body = StageOutputSchemas.body.safeParse(parsed)
    if (body.success) return assembleBody(body.data)
  }
  const values: string[] = []
  strings(parsed, values)
  return values.join('\n')
}
