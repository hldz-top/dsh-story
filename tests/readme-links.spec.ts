/** README ships in the npm package without docs/, src/ or tests/: repository links must be absolute and pinned to this version's tag. */
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

it('README links into docs/, src/ and tests/ are GitHub URLs pinned to the package version tag', async () => {
  const [readme, manifest] = await Promise.all([readFile(new URL('../README.md', import.meta.url), 'utf8'), readFile(new URL('../package.json', import.meta.url), 'utf8')])
  const tag = `v${(JSON.parse(manifest) as { version: string }).version}`
  const targets = [...readme.matchAll(/\]\(([^)\s]+)\)/g)].map(match => match[1]!)
  expect(targets.filter(target => /^(\.\/)?(docs|src|tests)\//.test(target))).toEqual([])
  const repository = targets.filter(target => target.startsWith('https://github.com/hldz-top/dsh-story/blob/'))
  expect(repository.length).toBeGreaterThan(0)
  // Prompt version 5 keeps the detector source on blob/main; every other README link stays pinned to this version's tag.
  const moving = 'https://github.com/hldz-top/dsh-story/blob/main/src/ai-tone.ts'
  expect(repository).toContain(moving)
  expect(repository.filter(target => target !== moving && !target.startsWith(`https://github.com/hldz-top/dsh-story/blob/${tag}/`))).toEqual([])
})
