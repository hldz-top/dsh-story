/** The published README is the concise Chinese package page: frontmatter, shipped links, and the common tool names. */
import { readFile, stat } from 'node:fs/promises'
import { expect, it } from 'vitest'

const LICENSE_LINK = 'third_party/lieflat-less-ai-tone.LICENSE'
const UPSTREAM_LINK = 'https://github.com/larashero3-dotcom/lieflat-less-ai-tone'
const TOOLS = [
  'story_write', 'story_revise', 'story_update', 'story_resume', 'story_stop',
  'story_get_settings', 'story_get_manuscript', 'story_read_artifact', 'story_preview', 'story_settings_import',
] as const
const HEADINGS = ['# DSH Story Weaver', '## 核心功能', '## 安装与卸载', '## 常用工具', '## 本地开发', '## 致谢与开源许可'] as const

it('README frontmatter, shipped links and common tool names match the concise package page', async () => {
  const [readme, manifestText] = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ])
  const manifest = JSON.parse(manifestText) as { readonly files: readonly string[] }
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(readme)
  expect(frontmatter).not.toBeNull()
  const fields = Object.fromEntries(frontmatter![1]!.split('\n').map(line => {
    const parsed = /^([A-Za-z]+): "([^"]*)"$/.exec(line)
    expect(parsed, line).not.toBeNull()
    return [parsed![1]!, parsed![2]!]
  }))
  expect(fields).toEqual({
    description: '基于 DSH 的独立长篇小说创作、去 AI 味评审与持久化写作插件。',
    kind: 'package-bundle',
  })
  let cursor = -1
  for (const heading of HEADINGS) {
    const at = readme.indexOf(heading)
    expect(at, heading).toBeGreaterThan(cursor)
    cursor = at
  }

  const targets = [...readme.matchAll(/\]\(([^)\s]+)\)/g)].map(match => match[1]!)
  expect(targets.filter(target => /^(\.\/)?(docs|src|tests)\//.test(target))).toEqual([])
  expect(targets.filter(target => target.startsWith('https://github.com/hldz-top/dsh-story/blob/'))).toEqual([])
  expect(new Set(targets)).toEqual(new Set([LICENSE_LINK, UPSTREAM_LINK]))
  expect(manifest.files).toEqual(expect.arrayContaining(['README.md', 'third_party']))
  expect((await stat(new URL(`../${LICENSE_LINK}`, import.meta.url))).isFile()).toBe(true)

  const toolsSection = readme.slice(readme.indexOf('## 常用工具'), readme.indexOf('## 本地开发'))
  expect([...toolsSection.matchAll(/`([a-z0-9_]+)`/g)].map(match => match[1]!)).toEqual([...TOOLS])
})
