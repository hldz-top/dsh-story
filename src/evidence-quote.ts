/**
 * Deterministic admission of model evidence quotations.
 *
 * A quotation is admitted unchanged when it occurs in its declared source up to representation-only differences.
 * Otherwise the host repairs exactly three well-defined, deterministic defects, never wording:
 * - re-attribution: the text occurs verbatim in exactly one other admitted input, so only `artifactId` is corrected;
 * - segmentation: an ellipsis joins excerpts that each occur on their own, or the quote was copied from an artifact's raw
 *   JSON (field names and identifiers around prose values), so the citation splits into one per prose excerpt;
 * - snapping: the closest equal-length source window differs by at most max(1, 5% of the quote) edits and is unique,
 *   so the quote is replaced by those exact source characters.
 * Every repair is reported to the registered listener. Anything else stays a repairable rejection whose message names
 * the other admitted inputs holding the text, or the closest source excerpt for the model to copy. A caller may instead
 * drop such a citation when its item keeps other admitted evidence; that drop is reported as a `dropped` repair.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

/** Text cited by a model output. */
export interface QuoteCitation { readonly artifactId: string; readonly quote: string }
/** Host-verified text an admitted citation may name. */
export interface QuoteSource { readonly artifactId: string; readonly text: string }

/** One deterministic host repair applied to a model citation. */
export interface QuoteRepair {
  readonly kind: 'reattributed' | 'segmented' | 'snapped' | 'dropped'
  readonly declared: QuoteCitation
  /** Citations admitted in place of the declared one; empty for a drop. */
  readonly admitted: readonly QuoteCitation[]
  /** Total edit distance snapped across the admitted excerpts; zero for pure re-attribution or a drop. */
  readonly distance: number
  /** Output path of the evidence item, for example `checks[2]`, when the caller knows it. */
  readonly location?: string
  /** For a drop: the host rejection the citation could not satisfy. */
  readonly reason?: string
}

/** Result of admitting one citation. */
export type QuoteResolution =
  | { readonly status: 'admitted'; readonly citations: readonly QuoteCitation[]; readonly repair?: QuoteRepair }
  | { readonly status: 'rejected'; readonly hint: string }

/** Minimum comparison-key length of a quote the host may snap; shorter quotes would match by chance. */
export const MIN_SNAP_CHARS = 8
/** Minimum comparison-key length of each ellipsis-separated excerpt. */
export const MIN_SEGMENT_CHARS = 4
/** Quotes longer than this many key characters are not snapped (bounded host work). */
const MAX_SNAP_CHARS = 2000
/** Code points of the closest-excerpt hint. */
const HINT_CHARS = 160
const ELLIPSIS = /\s*(?:[\u2026\u22EF]+|\.{3,}|\u3002{3,})\s*/u

function normalizeUnit(value: string): string {
  return value.normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u300C\u300D\u300E\u300F]/gu, '"')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63]/gu, '-')
    .replace(/[\u3002\uFF61]/gu, '.')
    .replace(/[\u3001\uFF64]/gu, ',')
    .replace(/[*`]/gu, '')
    .replace(/\s+/gu, '')
}

/** Comparison key of a text with, per key character, the inclusive code-point span of the original it came from. */
interface MappedKey { readonly chars: readonly string[]; readonly start: readonly number[]; readonly end: readonly number[]; readonly points: readonly string[] }

function mappedKey(text: string): MappedKey {
  const points = [...text]
  const chars: string[] = [], start: number[] = [], end: number[] = []
  for (let index = 0; index < points.length; index++) {
    let unit = points[index]!
    let span = 1
    const next = points[index + 1]
    // A JSON string escape read as raw text is a representation of one character (or of a line break, which is whitespace).
    if (unit === '\\' && next !== undefined) {
      if (next === '"' || next === '\\' || next === '/') { unit = next; span = 2 }
      else if (next === 'n' || next === 'r' || next === 't') { index++; continue }
    }
    for (const char of normalizeUnit(unit)) { chars.push(char); start.push(index); end.push(index + span - 1) }
    index += span - 1
  }
  return { chars, start, end, points }
}

/**
 * Comparison key for quotation membership. It discards only representation differences a faithful copy can introduce:
 * Unicode compatibility forms (full-width/half-width, NFKC), whitespace and line breaks, JSON string escapes, typographic
 * versus straight quote marks (including CJK corner brackets), dash variants, ideographic full stop and comma, and
 * Markdown emphasis/code markers. Wording and order stay exact, so an added, dropped or reworded character still differs.
 */
export function evidenceQuoteKey(value: string): string {
  return mappedKey(value).chars.join('')
}

function jsonStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') into.push(value)
  else if (Array.isArray(value)) for (const item of value) jsonStrings(item, into)
  else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) jsonStrings(item, into)
}

/** Stored structured artifacts are JSON, which the model reads with escapes; each decoded string value is its own unit so no match spans two fields. */
function decodedStrings(text: string): readonly string[] | null {
  if (!/^\s*[[{]/u.test(text)) return null
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return null }
  const strings: string[] = []
  jsonStrings(parsed, strings)
  return strings
}

const unitCache = new Map<string, { exact: readonly string[]; fuzzy: readonly MappedKey[] }>()

function units(text: string) {
  const cached = unitCache.get(text)
  if (cached !== undefined) return cached
  const decoded = decodedStrings(text)
  const raw = mappedKey(text)
  const fuzzy = decoded === null ? [raw] : decoded.map(mappedKey)
  const value = { exact: [raw.chars.join(''), ...(decoded === null ? [] : fuzzy.map(unit => unit.chars.join('')))], fuzzy }
  if (unitCache.size > 64) unitCache.clear()
  unitCache.set(text, value)
  return value
}

/** @param quote - Model-cited excerpt. @param text - Host-verified source text. @returns Whether the excerpt occurs in the source up to representation-only differences. */
export function evidenceQuoteOccurs(quote: string, text: string): boolean {
  if (text.includes(quote)) return true
  const key = evidenceQuoteKey(quote)
  return key.length > 0 && units(text).exact.some(source => source.includes(key))
}

/** Levenshtein distance of `quote` against `source[offset, offset + quote.length)`, or `limit + 1` once it must exceed `limit`. */
function boundedDistance(quote: readonly string[], source: readonly string[], offset: number, limit: number, rows: [Int32Array, Int32Array]): number {
  const length = quote.length
  const over = limit + 1
  let [previous, current] = rows
  previous.fill(over)
  for (let column = 0; column <= Math.min(length, limit); column++) previous[column] = column
  for (let row = 1; row <= length; row++) {
    current.fill(over)
    const low = Math.max(0, row - limit), high = Math.min(length, row + limit)
    if (low === 0) current[0] = row
    let best = low === 0 ? row : over
    for (let column = Math.max(1, low); column <= high; column++) {
      const substitute = previous[column - 1]! + (quote[row - 1] === source[offset + column - 1] ? 0 : 1)
      const value = Math.min(over, previous[column]! + 1, current[column - 1]! + 1, substitute)
      current[column] = value
      if (value < best) best = value
    }
    if (best > limit) return over
    ;[previous, current] = [current, previous]
  }
  return previous[length]!
}

interface NearMatch { readonly source: QuoteSource; readonly quote: string; readonly distance: number }

/** @returns The unique closest window within the edit bound, `ambiguous` when distinct windows tie, or null. */
function nearMatch(quote: string, sources: readonly QuoteSource[]): NearMatch | 'ambiguous' | null {
  const key = [...evidenceQuoteKey(quote)]
  if (key.length < MIN_SNAP_CHARS || key.length > MAX_SNAP_CHARS) return null
  const limit = Math.max(1, Math.floor(key.length * 0.05))
  const rows: [Int32Array, Int32Array] = [new Int32Array(key.length + 1), new Int32Array(key.length + 1)]
  let best: Array<{ source: QuoteSource; unit: MappedKey; offset: number; distance: number }> = []
  for (const source of sources) {
    for (const unit of units(source.text).fuzzy) {
      for (let offset = 0; offset + key.length <= unit.chars.length; offset++) {
        const distance = boundedDistance(key, unit.chars, offset, limit, rows)
        if (distance > limit) continue
        if (best.length === 0 || distance < best[0]!.distance) best = [{ source, unit, offset, distance }]
        else if (distance === best[0]!.distance) best.push({ source, unit, offset, distance })
      }
    }
  }
  if (best.length === 0) return null
  // Windows a few characters apart in one unit are the same location seen through an insertion or deletion; distinct locations must agree on text.
  const locations: Array<{ source: QuoteSource; quote: string; unit: MappedKey; offset: number }> = []
  for (const match of best) {
    const text = match.unit.points.slice(match.unit.start[match.offset], match.unit.end[match.offset + key.length - 1]! + 1).join('')
    const near = locations.find(location => location.unit === match.unit && Math.abs(location.offset - match.offset) <= limit)
    if (near !== undefined) continue
    if (locations.some(location => evidenceQuoteKey(location.quote) === evidenceQuoteKey(text) && location.source.artifactId === match.source.artifactId)) continue
    locations.push({ source: match.source, quote: text, unit: match.unit, offset: match.offset })
  }
  if (locations.length !== 1) return 'ambiguous'
  const [location] = locations
  if (location!.quote.trim().length === 0 || !evidenceQuoteOccurs(location!.quote, location!.source.text)) return null
  return { source: location!.source, quote: location!.quote, distance: best[0]!.distance }
}

/** @returns The source window sharing the most character bigrams with the quote, for a repair hint. */
function closestExcerpt(quote: string, sources: readonly QuoteSource[]): { artifactId: string; excerpt: string } | null {
  const key = [...evidenceQuoteKey(quote)]
  if (key.length < 2) return null
  const bigrams = new Set<string>()
  for (let index = 0; index + 1 < key.length; index++) bigrams.add(key[index]! + key[index + 1]!)
  let best: { artifactId: string; excerpt: string; score: number } | null = null
  for (const source of sources) {
    for (const unit of units(source.text).fuzzy) {
      const width = Math.min(key.length, unit.chars.length)
      if (width < 2) continue
      const prefix = new Int32Array(unit.chars.length)
      for (let index = 0; index + 1 < unit.chars.length; index++) prefix[index + 1] = prefix[index]! + (bigrams.has(unit.chars[index]! + unit.chars[index + 1]!) ? 1 : 0)
      for (let offset = 0; offset + width <= unit.chars.length; offset++) {
        const score = prefix[offset + width - 1]! - prefix[offset]!
        if (best !== null && score <= best.score) continue
        const points = unit.points.slice(unit.start[offset], unit.end[offset + width - 1]! + 1)
        best = { artifactId: source.artifactId, score, excerpt: points.length <= HINT_CHARS ? points.join('') : `${points.slice(0, HINT_CHARS).join('')}…` }
      }
    }
  }
  if (best === null || best.score < Math.max(2, Math.ceil((key.length - 1) * 0.3))) return null
  return { artifactId: best.artifactId, excerpt: best.excerpt }
}

/**
 * A quote copied from the raw JSON of a structured artifact (for example `{"sceneId":"s1","text":"他回到终端上…"}`)
 * carries field names and identifiers the reader never sees. Returns its prose string values (keys and bare identifiers
 * dropped, escapes decoded, a trailing cut-off literal kept), or null when the quote is not such a fragment.
 */
function jsonFragmentValues(quote: string): string[] | null {
  if (!/"\s*:\s*["[{]/u.test(quote)) return null
  const values: string[] = []
  for (const match of quote.matchAll(/"((?:[^"\\]|\\.)*)(?:"|$)(\s*:)?/gu)) {
    if (match[2] !== undefined) continue
    let value: string
    try { value = JSON.parse(`"${match[1]!.replace(/\\$/u, '')}"`) as string } catch { return null }
    if (/^[\w.:-]*$/u.test(value) || evidenceQuoteKey(value).length < MIN_SEGMENT_CHARS) continue
    values.push(value)
  }
  return values.length === 0 ? null : values
}

type Single = { readonly citation: QuoteCitation; readonly kind: 'exact' | 'reattributed' | 'snapped'; readonly distance: number } | { readonly holders: readonly string[] }

function resolveSingle(quote: string, declared: QuoteSource | undefined, admitted: readonly QuoteSource[]): Single {
  if (declared !== undefined && evidenceQuoteOccurs(quote, declared.text)) return { citation: { artifactId: declared.artifactId, quote }, kind: 'exact', distance: 0 }
  const holders = admitted.filter(source => source !== declared && evidenceQuoteOccurs(quote, source.text)).map(source => source.artifactId)
  if (holders.length === 1) return { citation: { artifactId: holders[0]!, quote }, kind: 'reattributed', distance: 0 }
  if (holders.length > 1) return { holders }
  const own = declared === undefined ? null : nearMatch(quote, [declared])
  const near = own ?? nearMatch(quote, admitted.filter(source => source !== declared))
  if (near === null || near === 'ambiguous') return { holders: [] }
  return { citation: { artifactId: near.source.artifactId, quote: near.quote }, kind: 'snapped', distance: near.distance }
}

/**
 * @param citation - Model citation. @param sources - Host-verified texts. @param admitted - Artifact IDs the stage may cite.
 * @returns The admitted citation(s), possibly host-repaired, or a rejection hint naming where to copy from.
 */
export function resolveEvidenceQuote(citation: QuoteCitation, sources: readonly QuoteSource[], admitted: readonly string[]): QuoteResolution {
  const allowed = sources.filter(source => admitted.includes(source.artifactId))
  const declared = allowed.find(source => source.artifactId === citation.artifactId)
  const single = resolveSingle(citation.quote, declared, allowed)
  if ('citation' in single) {
    if (single.kind === 'exact') return { status: 'admitted', citations: [single.citation] }
    return { status: 'admitted', citations: [single.citation], repair: { kind: single.kind, declared: citation, admitted: [single.citation], distance: single.distance } }
  }
  const segments = citation.quote.split(ELLIPSIS).filter(segment => segment.trim().length > 0)
  if (single.holders.length === 0 && segments.length >= 2 && segments.every(segment => evidenceQuoteKey(segment).length >= MIN_SEGMENT_CHARS)) {
    const parts = segments.map(segment => resolveSingle(segment, declared, allowed))
    if (parts.every(part => 'citation' in part)) {
      const citations: QuoteCitation[] = []
      let distance = 0
      for (const part of parts) {
        if (!('citation' in part)) continue
        distance += part.distance
        if (!citations.some(item => item.artifactId === part.citation.artifactId && item.quote === part.citation.quote)) citations.push(part.citation)
      }
      return { status: 'admitted', citations, repair: { kind: 'segmented', declared: citation, admitted: citations, distance } }
    }
  }
  const values = jsonFragmentValues(citation.quote)
  if (single.holders.length === 0 && values !== null) {
    const parts = values.map(value => resolveSingle(value, declared, allowed))
    if (parts.every(part => 'citation' in part)) {
      const citations: QuoteCitation[] = []
      let distance = 0
      for (const part of parts) {
        if (!('citation' in part)) continue
        distance += part.distance
        if (!citations.some(item => item.artifactId === part.citation.artifactId && item.quote === part.citation.quote)) citations.push(part.citation)
      }
      return { status: 'admitted', citations, repair: { kind: 'segmented', declared: citation, admitted: citations, distance } }
    }
  }
  if (single.holders.length > 1) {
    return { status: 'rejected', hint: ` This exact text does occur in several admitted inputs: ${single.holders.join(', ')}; keep the quote and set artifactId to the one input that supports this point.` }
  }
  const closest = closestExcerpt(citation.quote, declared === undefined ? allowed : [declared, ...allowed.filter(source => source !== declared)])
  return { status: 'rejected', hint: closest === null ? '' : ` Closest source text, in ${closest.artifactId}: ${JSON.stringify(closest.excerpt)} — copy a contiguous part of it exactly (with that artifactId) or cite a different passage.` }
}

/** Receives each host repair; the plugin logs them. */
export type QuoteRepairListener = (repair: QuoteRepair) => void
const listeners = new Set<QuoteRepairListener>()

/** @param listener - Observer of host quote repairs. @returns A function removing it. */
export function onQuoteRepair(listener: QuoteRepairListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const scopes = new AsyncLocalStorage<QuoteRepair[]>()

/**
 * Run an admission and collect the repairs it reports, so a caller can persist them with the stage that produced them.
 * Scoped by async context, so concurrent admissions never see each other's repairs.
 * @param run - The admission to observe. @returns Its result, or its error, together with the repairs reported meanwhile.
 */
export async function collectQuoteRepairs<T>(run: () => Promise<T> | T): Promise<{ readonly result: PromiseSettledResult<T>; readonly repairs: readonly QuoteRepair[] }> {
  const repairs: QuoteRepair[] = []
  const result = await scopes.run(repairs, async () => {
    try { return { status: 'fulfilled', value: await run() } as const } catch (reason) { return { status: 'rejected', reason } as const }
  })
  return { result, repairs }
}

/** @param repair - A repair just applied during admission. */
export function reportQuoteRepair(repair: QuoteRepair): void {
  scopes.getStore()?.push(repair)
  for (const listener of listeners) {
    try { listener(repair) } catch { /* observers never change admission */ }
  }
}
