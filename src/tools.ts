/** Model-facing writing operations use the calling Session's workspace. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type { Actor, NovelView } from './contracts.ts'
import { artifactKinds, parseArtifactId, parseNovelId, parseRequestId } from './contracts.ts'
import type { WritingService } from './service.ts'
import { projectArtifact } from './projection.ts'

/** Shared public metadata for an exact stored artifact version. */
export const artifactProperties = {
  id: { type: 'string', required: true },
  kind: { type: 'string', required: true, enum: artifactKinds },
  revision: { type: 'integer', required: true },
  sha256: { type: 'string', required: true },
  chars: { type: 'integer', required: true },
  bytes: { type: 'integer', required: true },
} as const

function novelValue(novel: NovelView) {
  return { ...novel, briefHistory: [...novel.briefHistory] }
}

const novelOutput = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      id: { type: 'string', required: true },
      title: { type: 'string', required: true },
      workspace: { type: 'string', required: true },
      revision: { type: 'integer', required: true },
      brief: { type: 'object', required: true, additionalProperties: false, properties: artifactProperties },
      briefHistory: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: artifactProperties } },
    },
  },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const

/**
 * Resolve the actor from the actual Session, never from model arguments.
 * @param ctx - Composed filesystem owner.
 * @param exec - Tool execution with its cancellation signal and admitted agent.
 * @returns Session identity and its canonical workspace display path.
 */
export async function writingActor(ctx: Context, exec: ToolExecution): Promise<Actor> {
  exec.signal.throwIfAborted()
  const session = exec.agent?.session
  if (session === undefined || session.header.cwd === undefined) {
    throw new Error('Writing tools require a Session workspace')
  }
  const workspace = await ctx.fs.resolve('.', { cwd: session.header.cwd, signal: exec.signal })
  return { sessionId: session.id, workspace: workspace.displayPath, signal: exec.signal }
}

/**
 * Register public novel tools; their canonical results enter the normal Session log.
 * @param ctx - Plugin scope owning the tool registrations.
 * @param service - Single writing-service owner for this host.
 * @param previewDirectory - Configured Session-relative version directory.
 */
export function registerWritingTools(ctx: Context, service: WritingService, previewDirectory: string): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'story_create_novel',
    description: 'Create a novel and save its initial creative brief. Reuse the same requestId only for the same request. Creation does not change the selected novel.',
    parameters: {
      requestId: { type: 'string', required: true },
      title: { type: 'string', required: true },
      brief: { type: 'string', required: true },
    },
    output: novelOutput,
    async execute(args, exec) {
      const actor = await writingActor(ctx, exec)
      exec.signal.throwIfAborted()
      return novelValue(await service.createNovel(actor, { ...args, requestId: parseRequestId(args.requestId) }))
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'story_save_brief',
    description: 'Save a new immutable creative-brief version. Supply the current novel revision as expectedRevision; revision conflicts require rereading before deciding another change. Reuse requestId only for the same request.',
    parameters: {
      novelId: { type: 'string', required: true },
      requestId: { type: 'string', required: true },
      expectedRevision: { type: 'integer', required: true, description: 'Positive current novel revision.' },
      text: { type: 'string', required: true },
    },
    output: novelOutput,
    async execute(args, exec) {
      return novelValue(await service.saveBrief(await writingActor(ctx, exec), {
        ...args, novelId: parseNovelId(args.novelId), requestId: parseRequestId(args.requestId),
      }))
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'story_read_artifact',
    description: `Read an exact artifact version in Unicode code-point pages. Follow nextOffset until eof. Explicit limit must be between 1 and ${service.limits.maxReadChars}.`,
    parameters: {
      novelId: { type: 'string', required: true },
      artifactId: { type: 'string', required: true },
      offset: { type: 'integer', required: true, description: 'Nonnegative Unicode code-point offset.' },
      limit: { type: 'integer', required: true, description: `Positive page length up to ${service.limits.maxReadChars} code points.` },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          novelId: { type: 'string', required: true },
          artifactId: { type: 'string', required: true },
          kind: { type: 'string', required: true, enum: artifactKinds },
          revision: { type: 'integer', required: true },
          sha256: { type: 'string', required: true },
          offset: { type: 'integer', required: true },
          nextOffset: { type: 'integer', required: true },
          totalChars: { type: 'integer', required: true },
          text: { type: 'string', required: true },
          eof: { type: 'boolean', required: true },
          view: { type: 'string', required: true, enum: ['stored', 'prose'] },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      // Review children always read the reader-facing prose view; the host decides, not the child.
      const view = service.readsProse(exec.agent?.session.id) ? 'prose' : 'stored'
      return service.readArtifact(await writingActor(ctx, exec), {
        ...args, novelId: parseNovelId(args.novelId), artifactId: parseArtifactId(args.artifactId), view,
      })
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'story_get_novel',
    description: 'Read an owned novel, its current revision and immutable creative-brief history without embedding document text.',
    parameters: { novelId: { type: 'string', required: true } },
    output: novelOutput,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return novelValue(service.getNovel(await writingActor(ctx, exec), parseNovelId(args.novelId)))
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'story_list_novels',
    description: 'List novels owned by the current Session workspace. Text remains available through exact artifact reads.',
    parameters: {},
    output: {
      schema: { type: 'array', items: novelOutput.schema },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      return service.listNovels(await writingActor(ctx, exec)).map(novelValue)
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'story_select_novel',
    description: 'Select an existing novel for this Session. Other Sessions retain their selections.',
    parameters: { novelId: { type: 'string', required: true } },
    output: novelOutput,
    async execute(args, exec) {
      return novelValue(await service.selectNovel(await writingActor(ctx, exec), parseNovelId(args.novelId)))
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'story_get_selection',
    description: 'Read the novel selected in this Session. Null means no selection; creation does not select a novel.',
    parameters: {},
    output: {
      schema: { oneOf: [novelOutput.schema, { type: 'null' }] },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const selected = service.getSelection(await writingActor(ctx, exec))
      return selected === null ? null : novelValue(selected)
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'story_preview',
    description: 'Open a complete immutable artifact version in the current Session document preview. Requires an exact novelId and artifactId from writing tool results.',
    parameters: {
      novelId: { type: 'string', required: true },
      artifactId: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, enum: ['story-artifact-preview'] },
          version: { type: 'integer', required: true, enum: [1] },
          novelId: { type: 'string', required: true },
          artifactId: { type: 'string', required: true },
          revision: { type: 'integer', required: true },
          title: { type: 'string', required: true },
          path: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args, value) => value,
    },
    async execute(args, exec) {
      const actor = await writingActor(ctx, exec)
      const novelId = parseNovelId(args.novelId)
      const novel = service.getNovel(actor, novelId)
      const artifact = service.getArtifact(actor, { novelId, artifactId: parseArtifactId(args.artifactId) })
      const imported = artifact.kind === 'settings-dimension' && service.getSettings(actor, novelId).history.some(item => item.artifact.id === artifact.id && item.origin === 'import')
      return projectArtifact(ctx, exec, actor, novel, artifact, previewDirectory, imported)
    },
  })))
}
