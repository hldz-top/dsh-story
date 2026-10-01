/** Copy owned by Story document and writing-run cards. */

/** Locale namespace registered by this Client plugin. */
export const NS = 'dsh-story'

/** Chinese dictionary and authoritative key set. */
export const zh = {
  'card.title': '小说文档',
  'card.version': '版本 {revision}',
  'card.open': '打开此版本',
  'card.inspect': '查看调用',
  'state.running': '正在准备文档预览…',
  'state.error': '文档预览失败',
  'state.valid-success': '版本文件已就绪',
  'state.invalid-result': '预览结果无效，无法打开文档。',
  'run.title': '小说写作',
  'run.state.running': '正在写作，阶段文档会陆续显示。',
  'run.state.completed': '本次写作已完成。',
  'run.state.failed': '本次写作失败，已生成的文档仍可读取。',
  'run.state.stopped': '本次写作已停止。',
  'run.state.interrupted': '本次写作已中断。',
  'run.state.invalid-result': '写作结果无效，无法确认完成状态。',
  'run.deliveries.waiting': '正在等待阶段文档记录…',
  'run.deliveries.empty': '尚无已投递的阶段文档。',
  'run.deliveries.invalid': '阶段文档记录无效，无法打开文档。',
  'run.deliveries.ready': '已提供 {count} 份完整版本文档。',
  'run.documents': '阶段文档版本',
  'run.rejected-output': '未通过校验的原始输出',
}

/** Keys consumed by Story document and writing-run cards. */
export type StoryPreviewKey = keyof typeof zh

/** English copy with the same keys as the Chinese dictionary. */
export const en: Record<StoryPreviewKey, string> = {
  'card.title': 'Novel document',
  'card.version': 'Version {revision}',
  'card.open': 'Open this version',
  'card.inspect': 'Inspect call',
  'state.running': 'Preparing document preview…',
  'state.error': 'Document preview failed',
  'state.valid-success': 'Version file ready',
  'state.invalid-result': 'Invalid preview result. The document cannot be opened.',
  'run.title': 'Novel writing',
  'run.state.running': 'Writing is in progress. Stage documents appear as they finish.',
  'run.state.completed': 'This writing request is complete.',
  'run.state.failed': 'This writing request failed. Generated documents remain readable.',
  'run.state.stopped': 'This writing request was stopped.',
  'run.state.interrupted': 'This writing request was interrupted.',
  'run.state.invalid-result': 'Invalid writing result. Completion cannot be confirmed.',
  'run.deliveries.waiting': 'Waiting for stage document records…',
  'run.deliveries.empty': 'No stage documents have been delivered yet.',
  'run.deliveries.invalid': 'Invalid stage document records. Documents cannot be opened.',
  'run.deliveries.ready': '{count} complete version documents are available.',
  'run.documents': 'Stage document versions',
  'run.rejected-output': 'Raw output that failed validation',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Story artifact preview, writing progress and version actions. */
    'dsh-story': StoryPreviewKey
  }
}
