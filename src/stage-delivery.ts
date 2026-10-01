/** Browser-safe whole-value projection for completed writing-stage deliveries. */
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** An admitted immutable artifact or a raw output rejected by stage admission. */
export type StoryStageDeliverySource =
  | { readonly kind: 'artifact'; readonly artifactId: string }
  | { readonly kind: 'rejected-output'; readonly attemptId: string }

/** One native file delivery, with its original complete document path. */
export interface StoryStageDelivery {
  readonly runId: string
  readonly source: StoryStageDeliverySource
  readonly path: string
  readonly description: string
  readonly eventSeq: number
}

/** Deliveries grouped by the actual Story tool call that owns their card. */
export interface StoryStageDeliveries {
  readonly version: 1
  readonly calls: readonly { readonly callId: string; readonly deliveries: readonly StoryStageDelivery[] }[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'story-stage-deliveries': StoryStageDeliveries
  }
  interface SessionProjectionStateMap {
    'story-stage-deliveries': StoryStageDeliveries
  }
}

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
function source(value: unknown): value is StoryStageDeliverySource {
  return (record(value, ['kind', 'artifactId']) && value.kind === 'artifact' && text(value.artifactId))
    || (record(value, ['kind', 'attemptId']) && value.kind === 'rejected-output' && text(value.attemptId))
}
function delivery(value: unknown): value is StoryStageDelivery {
  return record(value, ['runId', 'source', 'path', 'description', 'eventSeq'])
    && text(value.runId) && source(value.source) && text(value.path) && text(value.description)
    && typeof value.eventSeq === 'number' && Number.isSafeInteger(value.eventSeq) && value.eventSeq >= 0
}

/**
 * Validate a complete wire value without dropping rows or rewriting version paths.
 * @param value - Untrusted Session projection received by the Client.
 * @returns The supported projection, or undefined when any required field is malformed.
 */
export function parseStoryStageDeliveries(value: unknown): StoryStageDeliveries | undefined {
  if (!record(value, ['version', 'calls']) || value.version !== 1 || !Array.isArray(value.calls)) return undefined
  const calls: StoryStageDeliveries['calls'][number][] = []
  for (const item of value.calls as unknown[]) {
    if (!record(item, ['callId', 'deliveries']) || !text(item.callId) || !Array.isArray(item.deliveries)) return undefined
    if (calls.some(call => call.callId === item.callId)) return undefined
    const deliveries: StoryStageDelivery[] = []
    for (const entry of item.deliveries as unknown[]) {
      if (!delivery(entry)) return undefined
      deliveries.push(entry)
    }
    calls.push({ callId: item.callId, deliveries })
  }
  return { version: 1, calls }
}
