/** Shared helpers for asserting how generated preview Markdown reads. */
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'

/** @param markdown - Generated Markdown. @returns Its visible text: character references and hard breaks decoded. */
export function rendered(markdown: string): string {
  return markdown.replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code))).replaceAll('  \n', '\n')
}

/** Minimal mdast node shape used by the host-grammar assertions. */
export interface MdNode { readonly type: string, readonly value?: string, readonly url?: string, readonly children?: readonly MdNode[] }

/**
 * Parses like the DSH 0.2.0-rc.2 settled preview (`parseGfmWithMath` in `@deepseek-ai/dsh-client-ui-primitives`), using the
 * parser versions bundled into that release. The host's extra CJK strong-emphasis and `\(`/`\[` math delimiters only
 * react to raw `*` and `\`, which readable Markdown always encodes.
 * @param markdown - Generated Markdown.
 * @returns Its mdast tree.
 */
export function parseLikeHost(markdown: string): MdNode {
  return fromMarkdown(markdown, { extensions: [gfm(), math()], mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()] }) as MdNode
}

/** @param node - Parsed tree. @returns Every node, depth first. */
export function nodes(node: MdNode): MdNode[] {
  return [node, ...(node.children ?? []).flatMap(nodes)]
}

/** @param node - Parsed tree. @returns Visible text with breaks as line feeds and blocks separated by blank lines. */
export function visibleText(node: MdNode): string {
  if (node.type === 'text') return node.value ?? ''
  if (node.type === 'break') return '\n'
  const children = (node.children ?? []).map(visibleText)
  return children.join(node.type === 'root' || node.type === 'blockquote' || node.type === 'list' ? '\n\n' : '')
}

/** @param node - Parsed tree. @returns Each link's destination and visible label. */
export function links(node: MdNode): Array<{ url: string, text: string }> {
  return nodes(node).filter(entry => entry.type === 'link').map(entry => ({ url: entry.url ?? '', text: visibleText(entry) }))
}
