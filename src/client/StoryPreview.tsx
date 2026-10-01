/** A version-specific document preview using the owning Session's file opener. */
import type { CSSProperties, ReactElement } from 'react'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { readStoryArtifactPreview } from '../preview-result.ts'
import type { NS } from './locales.ts'

/** Public Tool owner data and the card's injected translation function. */
export type StoryPreviewProps = ToolCallOwnerProps & PropsLocale<typeof NS>

const cardStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-1)',
  fontSize: 13,
  minWidth: 0,
}
const secondaryStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
}
const actionStyle: CSSProperties = {
  border: 'none',
  padding: '4px 0',
  background: 'transparent',
  color: 'var(--dsw-alias-link)',
  font: 'inherit',
  cursor: 'pointer',
}

/**
 * Render recorded preview status and expose a file action only for a valid success.
 * @param props - Recorded Tool owner data, Session file opener and localized copy.
 * @returns A document card retaining the optional trajectory inspection action.
 */
export function StoryPreview({ block, openFile, inspect, t }: StoryPreviewProps): ReactElement {
  const settled = 'kind' in block
  const preview = settled && !block.isError
    ? readStoryArtifactPreview(block.meta, block.content)
    : undefined
  const state = !settled ? 'running'
    : block.isError ? 'error'
      : preview === undefined ? 'invalid-result' : 'valid-success'

  return <div data-tool="story_preview" data-state={state} style={cardStyle}>
    <strong>{t('card.title')}</strong>
    <div role="status" style={secondaryStyle}>{t(`state.${state}`)}</div>
    {preview !== undefined && <>
      <div style={{ overflowWrap: 'anywhere' }}>{preview.title}</div>
      <div style={secondaryStyle}>{t('card.version', { revision: preview.revision })}</div>
      <code style={{ ...secondaryStyle, overflowWrap: 'anywhere' }}>{preview.path}</code>
    </>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      {preview !== undefined && <button type="button" style={actionStyle}
        onClick={() => openFile(preview.path)}>{t('card.open')}</button>}
      {inspect !== undefined && <button type="button" style={actionStyle}
        onClick={inspect}>{t('card.inspect')}</button>}
    </div>
  </div>
}
