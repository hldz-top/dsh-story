/** The single repairable error type for host rejection of a model-produced stage value. */
import type { z } from 'zod'

/**
 * A captured model value violates a host admission rule (schema, count, length, budget, quotation, cross-reference or order).
 * The message is shown verbatim to the replacement attempt as `validationError`, so it names the offending item and the
 * actual versus allowed value. The writing runner repairs exactly this type within `maxRepairAttempts`; every other error
 * (provider failure, refusal, truncation, cancellation, store conflict, corrupt or stale state) remains fatal to the stage.
 */
export class StageValidationRejection extends Error {
  /** @param message - The specific requirement a replacement output must satisfy. */
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'StageValidationRejection' }
}

/** Code points of model-supplied values echoed in a rejection message. */
const ECHO_CHARS = 80

/** @param value - Any model-supplied value. @returns A bounded JSON rendering for a rejection message. */
export function echo(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value)
  const chars = [...text]
  return chars.length <= ECHO_CHARS ? text : `${chars.slice(0, ECHO_CHARS).join('')}…`
}

/** @param error - Zod failure of a model value. @param label - What the value was meant to be. @returns A specific, bounded summary of each failing path. */
export function schemaRejection(error: z.ZodError, label: string): StageValidationRejection {
  const issues = error.issues.slice(0, 8).map(issue => `${issue.path.length === 0 ? '(root)' : issue.path.join('.')}: ${issue.message}`)
  const more = error.issues.length > 8 ? `; and ${error.issues.length - 8} more` : ''
  return new StageValidationRejection(`${label} does not match its output schema: ${issues.join('; ')}${more}`, { cause: error })
}

/** @param schema - Model output schema. @param value - Captured model value. @param label - Stage output name for the message. @returns The parsed value; a mismatch is a repairable rejection. */
export function parseModelOutput<T extends z.ZodType>(schema: T, value: unknown, label: string): z.output<T> {
  const result = schema.safeParse(value)
  if (!result.success) throw schemaRejection(result.error, label)
  return result.data
}

/**
 * @param text - Serialized model-produced artifact. @param maxBytes - Configured artifact byte limit. @param label - Stage output name.
 * Rejects an oversized model artifact before storage so the replacement attempt can shorten it.
 */
export function checkModelArtifactBytes(text: string, maxBytes: number, label: string): void {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > maxBytes) throw new StageValidationRejection(`${label} is ${bytes} UTF-8 bytes; at most ${maxBytes} are allowed. Return a shorter complete value.`)
}
