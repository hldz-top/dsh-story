import { expect, it } from 'vitest'
import { WritingError } from '../src/contracts.ts'
import { missingRequiredSettings, REQUIRED_NOVEL_SETTINGS } from '../src/settings-plan.ts'
import { useWritingFixture } from './support/writing-fixture.ts'

const COMPLETE = { timeout: 120_000 }
const codes = (roots: readonly string[]) => missingRequiredSettings(roots).map(dimension => dimension.code)

it('derives the required novel settings from the catalog requiredFor markers', () => {
  expect(REQUIRED_NOVEL_SETTINGS).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'e1', 'g1', 'g2'])
  expect(codes(['a4', 'a5', 'g2'])).toEqual([])
  expect(codes(['a4', 'a5', 'e1', 'g1'])).toEqual(['g2'])
  expect(codes(['e1'])).toEqual(['a3', 'a4', 'a5', 'g1', 'g2'])
})

it.each([
  { settingsRoots: ['a4', 'a5', 'e1', 'g1'], message: 'Required novel settings are missing: g2 (主线). Add it to settingsRoots' },
  { settingsRoots: ['a1'], message: 'Required novel settings are missing: a2 (', },
])('blocks a new run before any stage when $settingsRoots leaves required settings out', async ({ settingsRoots, message }) => {
  const fixture = await useWritingFixture()
  const { allowIncompleteSettings: _bypass, ...input } = fixture.input
  const result = await fixture.run(exec => fixture.runner.start(exec, { ...input, settingsRoots }))
  expect(result.status).toBe('rejected')
  const reason = result.status === 'rejected' ? result.reason : null
  expect(reason).toBeInstanceOf(WritingError)
  expect(reason).toMatchObject({ code: 'settings-incomplete' })
  expect(String((reason as Error).message)).toContain(message)
  expect(fixture.runs.list(fixture.actor, fixture.novel.id)).toEqual([])
  expect(fixture.stages.size).toBe(0)
})

it('admits a run whose settings closure covers every required code without the bypass', async () => {
  const fixture = await useWritingFixture()
  const { allowIncompleteSettings: _bypass, ...input } = fixture.input
  const result = await fixture.run(exec => fixture.runner.start(exec, { ...input, settingsRoots: ['a4', 'a5', 'g2'], chapterCount: 1, throughChapter: 1 }))
  expect(result).toMatchObject({ status: 'fulfilled', value: { status: 'completed' } })
}, COMPLETE.timeout)
