/** Browser contributions for Story previews and live writing-stage deliveries. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { StoryPreview } from './StoryPreview.tsx'
import { StoryRun } from './StoryRun.tsx'
import { en, NS, zh } from './locales.ts'

/** Host-provided Client services used by this contribution. */
export const inject = ['slots', 'locale', 'uiSession']

/**
 * Register localized preview and live-stage cards for this plugin's Tool names.
 * @param ctx - Client context owning dictionary and slot-registration disposal.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-story: document dictionaries')
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'story_preview', locale: NS }, StoryPreview,
  ))
  for (const key of ['story_write', 'story_update', 'story_revise', 'story_resume']) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key, locale: NS }, StoryRun,
    ))
  }
}
