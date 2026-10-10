/** Shared helpers for asserting how generated preview Markdown reads. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** @param markdown - Generated Markdown. @returns Its visible text: character references and hard breaks decoded. */
export function rendered(markdown: string): string {
  return markdown.replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code))).replaceAll('  \n', '\n')
}

/** Minimal mdast node shape used by the host-grammar assertions. */
export interface MdNode { readonly type: string, readonly value?: string, readonly url?: string, readonly children?: readonly MdNode[] }

/**
 * Directory holding the Markdown libraries the DSH preview parses with (mdast-util-from-markdown 2, micromark-extension-gfm 3,
 * mdast-util-gfm 3, micromark-extension-math 3, mdast-util-math 3). They are not project dependencies; the host-grammar
 * tests run only when this scratch installation exists.
 */
export const hostMarkdownDirectory = process.env.DSH_STORY_MDCHECK ?? '/tmp/mdcheck'
/** Whether {@link parseLikeHost} can run. */
export const hostMarkdownAvailable = existsSync(join(hostMarkdownDirectory, 'node_modules', 'mdast-util-from-markdown'))

/** @param markdown - Generated Markdown. @returns Its mdast tree under the preview's GFM and math grammar. */
export async function parseLikeHost(markdown: string): Promise<MdNode> {
  const load = (name: string) => import(pathToFileURL(join(hostMarkdownDirectory, 'node_modules', name, 'index.js')).href)
  const [{ fromMarkdown }, { gfm }, { gfmFromMarkdown }, { math }, { mathFromMarkdown }] = await Promise.all([
    load('mdast-util-from-markdown'), load('micromark-extension-gfm'), load('mdast-util-gfm'), load('micromark-extension-math'), load('mdast-util-math'),
  ])
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
