/** Stage files remain accessible in the owning writing Tool card while native work continues. */
import type { CSSProperties, ReactElement } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { parseStoryStageDeliveries } from '../stage-delivery.ts'
import { readStoryRunResult } from './run-result.ts'
import type { NS } from './locales.ts'

/** Native Tool identity, Session projection subscription, file opener and localized controls. */
export type StoryRunProps = ToolCallOwnerProps & PropsLocale<typeof NS> & {
  readonly useProjection: UseProjection
}

const cardStyle: CSSProperties = {
  display: 'grid', gap: 8, padding: 12, borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-1)', fontSize: 13, minWidth: 0,
}
const secondaryStyle: CSSProperties = { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }
const actionStyle: CSSProperties = {
  border: 'none', padding: '4px 0', background: 'transparent', color: 'var(--dsw-alias-link)',
  font: 'inherit', cursor: 'pointer', textAlign: 'left', justifySelf: 'start',
}

/**
 * Subscribe to accumulated host deliveries before the owning Tool settles.
 * @param props - Actual call identity and native Session services; only a click opens a recorded path.
 * @returns Live stage-version actions, preserved on run failure, interruption and stop.
 */
export function StoryRun({ callId, toolName, block, useProjection, openFile, inspect, t }: StoryRunProps): ReactElement {
  const value = useProjection('story-stage-deliveries')
  const projection = value === undefined ? undefined : parseStoryStageDeliveries(value)
  const deliveries = projection?.calls.find(call => call.callId === callId)?.deliveries
  const settled = 'kind' in block
  const result = settled && !block.isError ? readStoryRunResult(block.content) : undefined
  const state = !settled ? 'running' : block.isError ? 'failed' : result === undefined ? 'invalid-result' : result.status
  const deliveryState = value === undefined ? 'waiting' : projection === undefined ? 'invalid'
    : deliveries === undefined || deliveries.length === 0 ? 'empty' : 'ready'

  return <div data-tool={toolName} data-state={state} style={cardStyle}>
    <strong>{t('run.title')}</strong>
    <div role="status" aria-live="polite" style={secondaryStyle}>{t(`run.state.${state}`)}</div>
    <div role="status" aria-live="polite" style={secondaryStyle}>
      {t(`run.deliveries.${deliveryState}`, { count: deliveries?.length ?? 0 })}
    </div>
    {deliveries !== undefined && deliveries.length > 0 && <ol aria-label={t('run.documents')}
      style={{ display: 'grid', gap: 12, margin: 0, paddingInlineStart: 20 }}>
      {deliveries.map(delivery => <li key={`${delivery.eventSeq}:${delivery.source.kind === 'artifact' ? delivery.source.artifactId : delivery.source.attemptId}`}
        data-event-seq={delivery.eventSeq} data-source={delivery.source.kind}>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <div style={{ overflowWrap: 'anywhere' }}>{delivery.description}</div>
          {delivery.source.kind === 'rejected-output' && <div style={secondaryStyle}>{t('run.rejected-output')}</div>}
          <code style={{ ...secondaryStyle, overflowWrap: 'anywhere' }}>{delivery.path}</code>
          <button type="button" data-open-stage={true} style={actionStyle}
            onClick={() => openFile(delivery.path)}>{t('card.open')}</button>
        </div>
      </li>)}
    </ol>}
    {inspect !== undefined && <button type="button" style={actionStyle} onClick={inspect}>{t('card.inspect')}</button>}
  </div>
}
