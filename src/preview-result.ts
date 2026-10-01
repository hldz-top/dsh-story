/** Browser-safe persisted result fields shared by the preview tool and its card. */

/** One immutable artifact version projected to a Session-accessible Markdown file. */
export interface StoryArtifactPreview {
  /** Identifies the preview result, independently of the artifact's writing stage. */
  readonly kind: 'story-artifact-preview'
  /** Wire format understood by this parser. */
  readonly version: 1
  /** Novel that owns this artifact. */
  readonly novelId: string
  /** Immutable artifact identity recorded by the writing service. */
  readonly artifactId: string
  /** Positive safe integer assigned to this artifact version. */
  readonly revision: number
  /** Host-produced title for this exact version. */
  readonly title: string
  /** Persisted file path passed unchanged to the Session's file opener. */
  readonly path: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonblankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Validate the fields consumed by a preview card without normalizing identities or paths.
 * @param value - Persisted presentation metadata or parsed JSON tool output.
 * @returns Validated version fields, or undefined for an unsupported or malformed result.
 */
export function parseStoryArtifactPreview(value: unknown): StoryArtifactPreview | undefined {
  if (!isRecord(value)
    || value.kind !== 'story-artifact-preview'
    || value.version !== 1
    || !isNonblankString(value.novelId)
    || !isNonblankString(value.artifactId)
    || typeof value.revision !== 'number'
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || !isNonblankString(value.title)
    || !isNonblankString(value.path)) return undefined

  return {
    kind: value.kind,
    version: value.version,
    novelId: value.novelId,
    artifactId: value.artifactId,
    revision: value.revision,
    title: value.title,
    path: value.path,
  }
}

/**
 * Read metadata, or one JSON text block when nested tool dispatch supplies no metadata.
 * Malformed metadata is authoritative failure; text cannot replace it.
 * @param meta - Recorded tool presentation metadata; undefined means absent.
 * @param content - Recorded tool content blocks.
 * @returns Validated preview fields, or undefined when no single valid result exists.
 */
export function readStoryArtifactPreview(meta: unknown, content: unknown): StoryArtifactPreview | undefined {
  if (meta !== undefined) return parseStoryArtifactPreview(meta)
  if (!Array.isArray(content) || content.length !== 1) return undefined
  const block: unknown = content[0]
  if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') return undefined

  let result: unknown
  try {
    result = JSON.parse(block.text)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
  return parseStoryArtifactPreview(result)
}
