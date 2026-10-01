/** Research evidence admission from persisted native DSH tool results. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { formatFetchOutput } from '@deepseek-ai/dsh-tool-web'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { researchSourceIndex, type NativeResearchObservation, type NativeResearchSource } from './research-selection.ts'
import { researchSourceSchema } from './research.ts'
import { WritingError, type ResearchLimits, type ResearchRejectedSource, type ResearchView } from './contracts.ts'

const httpUrl = researchSourceSchema.shape.url
const searchInput = z.strictObject({ queries: z.array(z.string()) })
const fetchInput = z.strictObject({ url: z.string() })
const fetchMeta = z.strictObject({ url: httpUrl, statusCode: z.number().int().min(100).max(599), truncated: z.boolean() })
const searchMeta = z.strictObject({
  sources: z.array(z.strictObject({ url: z.string(), title: z.string().optional(), snippet: z.string().optional(), publishedAt: z.string().optional() })),
  truncated: z.boolean(), answer: z.string().optional(),
})

function recorded<T>(schema: z.ZodType<T>, value: unknown): T {
  try { return schema.parse(value) }
  catch (cause) { throw new WritingError('research-incomplete', 'Native web log fields cannot be verified', { cause }) }
}

function argumentsValue(text: string): unknown {
  try { return JSON.parse(text) }
  catch (cause) { throw new WritingError('research-incomplete', 'Native web call arguments are not JSON', { cause }) }
}

function nativeSource(sourceIndex: number, url: string, title: string | null, content: string, nativeTruncated: boolean, bodyStart: number, bodyEnd: number, httpStatus: number | null): NativeResearchSource {
  return { sourceIndex, url, title, content, nativeTruncated, bodyStart, bodyEnd, httpStatus,
    totalChars: [...content].length, sha256: createHash('sha256').update(content).digest('hex') }
}

/** The body excludes the exact installed formatter's display prefix and truncation suffix. */
function nativeFetchSource(meta: z.infer<typeof fetchMeta>, text: string): NativeResearchSource {
  const empty = { url: meta.url, statusCode: meta.statusCode, body: { kind: 'text' as const, content: '' }, truncated: false }
  const header = formatFetchOutput(empty, Number.MAX_SAFE_INTEGER)
  const truncatedEmpty = { ...empty, truncated: true }
  const footer = formatFetchOutput(truncatedEmpty, Number.MAX_SAFE_INTEGER).slice(header.length)
  let bodyStart = 0
  let bodyEnd = 0
  if (text.startsWith(header)) {
    if (meta.truncated && !text.endsWith(footer)) throw new WritingError('research-incomplete', 'Native truncated fetch does not match its recorded display metadata')
    bodyStart = [...header].length
    bodyEnd = [...(meta.truncated ? text.slice(0, -footer.length) : text)].length
  } else if (!meta.truncated || text.length === 0 || text !== formatFetchOutput(truncatedEmpty, text.length)) {
    throw new WritingError('research-incomplete', 'Native fetch text does not match its recorded URL and HTTP status')
  }
  return nativeSource(0, meta.url, null, text, meta.truncated, bodyStart, bodyEnd, meta.statusCode)
}

/**
 * Resolve one plan's native calls against its actual executing Session.
 * @param ctx - Host services that own Session persistence.
 * @param exec - Actual tool execution and cancellation signal.
 * @param plan - Service-owned plan and reserved native calls.
 * @param limits - Validated evidence and log-read budgets.
 * @returns Complete recorded observations, including failed calls.
 */
async function nativeResearchLog(ctx: Context, exec: ToolExecution, plan: ResearchView, limits: ResearchLimits): Promise<NativeResearchObservation[]> {
  exec.signal.throwIfAborted()
  const session = exec.agent?.session
  if (session === undefined || session.id !== plan.sessionId) throw new WritingError('session-mismatch', 'Research evidence belongs to the plan Session')
  if (exec.parent !== undefined) throw new WritingError('research-incomplete', 'Research evidence requires native tool calls')
  const length = session.seq - plan.startSeq
  if (!Number.isSafeInteger(plan.startSeq) || plan.startSeq < 0 || length < 0) throw new WritingError('research-incomplete', 'Research log start is outside the executing Session')
  if (length > limits.maxResearchLogEvents || plan.reservedCalls.length > limits.maxResearchCalls) throw new WritingError('research-budget', 'Research log or call count exceeds the configured limit')
  if (!await ctx.sessions.flush(session)) throw new WritingError('research-incomplete', 'Research requires durable Session persistence')
  exec.signal.throwIfAborted()
  const handle = await ctx.sessionPersistence.open(session.id, 'read', { signal: exec.signal })
  try {
    const { events } = await handle.read(plan.startSeq, length, { signal: exec.signal })
    exec.signal.throwIfAborted()
    if (events.length !== length) throw new WritingError('research-incomplete', 'Research log is missing events after its durability checkpoint')
    const reserved = new Map(plan.reservedCalls.map(call => [call.callId, call.name]))
    if (reserved.size !== plan.reservedCalls.length) throw new WritingError('research-incomplete', 'Research call reservations are ambiguous')
    const calls = new Map<ToolCallId, SessionEvent<'tool/call'>>()
    const observations = new Map<ToolCallId, NativeResearchObservation>()
    for (const event of events) {
      exec.signal.throwIfAborted()
      if (event.type === 'tool/call' && reserved.has(event.data.callId)) {
        if (calls.has(event.data.callId) || reserved.get(event.data.callId) !== event.data.name) throw new WritingError('research-incomplete', 'Research call identity is duplicated or differs from its reservation')
        calls.set(event.data.callId, event)
      }
      if (event.type !== 'tool/result' || event.surfaceOp !== 'append') continue
      const result = event.data.message
      if (!reserved.has(result.toolCallId)) continue
      const call = calls.get(result.toolCallId)
      if (call === undefined || observations.has(result.toolCallId)
        || event.data.message.source.callId !== result.toolCallId || event.seq <= call.seq
        || event.data.turn !== call.data.turn || event.data.step !== call.data.step
        || !event.sourceEventSeqs?.includes(call.seq)) {
        throw new WritingError('research-incomplete', 'Research result does not identify exactly one preceding native call')
      }
      const name = reserved.get(result.toolCallId)!
      const input = name === 'web_search' ? recorded(searchInput, argumentsValue(call.data.arguments)) : recorded(fetchInput, argumentsValue(call.data.arguments))
      if (result.isError === true) {
        const error = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
        if (error.trim().length === 0) throw new WritingError('research-incomplete', 'Failed native web call has no recorded error text')
        observations.set(result.toolCallId, { callId: result.toolCallId, name, input,
          callSeq: call.seq, resultSeq: event.seq, status: 'failed', error, sources: [], rejectedSources: [] })
        continue
      }
      let sources: NativeResearchSource[]
      const rejectedSources: ResearchRejectedSource[] = []
      if (name === 'web_search') {
        const meta = recorded(searchMeta, event.data.meta)
        sources = []
        for (const [sourceIndex, source] of meta.sources.entries()) {
          if (httpUrl.safeParse(source.url).success) sources.push(nativeSource(sourceIndex, source.url, source.title ?? null, source.snippet ?? '', meta.truncated, 0, [...(source.snippet ?? '')].length, null))
          else rejectedSources.push({ sourceIndex, reference: source.url, title: source.title ?? null, reason: 'unsupported-reference' })
        }
      } else {
        const meta = recorded(fetchMeta, event.data.meta)
        if (result.content.length !== 1 || result.content[0]?.type !== 'text') throw new WritingError('research-incomplete', 'Native fetch has no complete recorded text result')
        sources = [nativeFetchSource(meta, result.content[0].text)]
      }
      observations.set(result.toolCallId, { callId: result.toolCallId, name, input,
        callSeq: call.seq, resultSeq: event.seq, status: 'succeeded', error: null, sources, rejectedSources })
    }
    if (plan.reservedCalls.some(call => !observations.has(call.callId))) throw new WritingError('research-incomplete', 'A reserved native web call has no complete logged result')
    return [...observations.values()]
  } finally {
    await handle.close()
    exec.signal.throwIfAborted()
  }
}

/** @param ctx - Native Session owner. @param exec - Owning native execution. @param plan - Exact plan and reservations. @param limits - Finite log, source and metadata bounds. @returns Complete recorded sources, ordered by reservation, without allocating excerpts. */
export async function collectResearchSources(ctx: Context, exec: ToolExecution, plan: ResearchView, limits: ResearchLimits): Promise<NativeResearchObservation[]> {
  const native = await nativeResearchLog(ctx, exec, plan, limits)
  researchSourceIndex(native, limits)
  return plan.reservedCalls.map(call => native.find(observation => observation.callId === call.callId)!)
}
