/** Browser-safe status admission for the writing tools' logged JSON results. */

/** Run fields needed to distinguish a finished request from a returned failure. */
export interface StoryRunResult {
  readonly id: string
  readonly status: 'running' | 'interrupted' | 'completed' | 'failed' | 'stopped'
  readonly error: string | null
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one logged JSON result without treating Tool transport success as run completion.
 * @param content - Native Tool result content; malformed or contradictory data is not a completed run.
 * @returns The validated run status, or undefined when no supported result is present.
 */
export function readStoryRunResult(content: unknown): StoryRunResult | undefined {
  if (!Array.isArray(content) || content.length !== 1) return undefined
  const block: unknown = content[0]
  if (!record(block) || block.type !== 'text' || typeof block.text !== 'string') return undefined
  let value: unknown
  try {
    value = JSON.parse(block.text)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
  if (!record(value) || typeof value.id !== 'string' || value.id.trim().length === 0
    || (value.error !== null && typeof value.error !== 'string')) return undefined
  switch (value.status) {
    case 'running': case 'interrupted': case 'failed': case 'stopped':
      return { id: value.id, status: value.status, error: value.error }
    case 'completed':
      return value.error === null ? { id: value.id, status: value.status, error: null } : undefined
    default: return undefined
  }
}
