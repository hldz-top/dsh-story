import { expect, it } from 'vitest'
import { SettingsIncompleteError } from '../src/contracts.ts'
import { missingRequiredSettings, REQUIRED_NOVEL_SETTINGS } from '../src/settings-plan.ts'
import type { WritingRunnerOptions } from '../src/writing-runner.ts'
import { useWritingFixture } from './support/writing-fixture.ts'

const COMPLETE = { timeout: 120_000 }
const codes = (roots: readonly string[]) => missingRequiredSettings(roots).map(dimension => dimension.code)

it('derives the required novel settings from the catalog requiredFor markers', () => {
  expect(REQUIRED_NOVEL_SETTINGS).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'e1', 'g1', 'g2'])
  expect(codes(['a4', 'a5', 'g2'])).toEqual([])
  expect(codes(['a4', 'a5', 'e1', 'g1'])).toEqual(['g2'])
  expect(codes(['e1'])).toEqual(['a3', 'a4', 'a5', 'g1', 'g2'])
  expect(codes([])).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'e1', 'g1', 'g2'])
})

it.each([
  { settingsRoots: ['a4', 'a5', 'e1', 'g1'], missing: ['g2'], message: 'Required novel settings are missing: g2 (主线). Complete the settings first: choose settingsRoots whose dependencies cover it; ["a4", "a5", "g2"] covers every required setting.\n{"code":"settings-incomplete","missing":["g2"]}' },
  { settingsRoots: ['a1'], missing: ['a2', 'a3', 'a4', 'a5', 'e1', 'g1', 'g2'], message: 'Required novel settings are missing: a2 (' },
  { settingsRoots: [], missing: ['a1', 'a2', 'a3', 'a4', 'a5', 'e1', 'g1', 'g2'], message: 'Required novel settings are missing: a1 (类型 / 题材), a2 (' },
])('blocks a new run before any stage when $settingsRoots leaves required settings out', async ({ settingsRoots, missing, message }) => {
  const fixture = await useWritingFixture({ allowIncompleteSettings: false })
  const { input } = fixture
  const result = await fixture.run(exec => fixture.runner.start(exec, { ...input, settingsRoots }))
  expect(result.status).toBe('rejected')
  const reason = result.status === 'rejected' ? result.reason : null
  expect(reason).toBeInstanceOf(SettingsIncompleteError)
  expect(reason).toMatchObject({ name: 'SettingsIncompleteError', code: 'settings-incomplete', missing })
  expect(String((reason as Error).message)).toContain(message)
  expect(JSON.parse(String((reason as Error).message).split('\n').at(-1) ?? '')).toEqual({ code: 'settings-incomplete', missing })
  expect(String((reason as Error).message)).not.toContain('allowIncompleteSettings')
  expect(fixture.runs.list(fixture.actor, fixture.novel.id)).toEqual([])
  expect(fixture.stages.size).toBe(0)
})

it('admits a run whose settings closure covers every required code with the gate on', async () => {
  const fixture = await useWritingFixture({ allowIncompleteSettings: false })
  const { input } = fixture
  const result = await fixture.run(exec => fixture.runner.start(exec, { ...input, settingsRoots: ['a4', 'a5', 'g2'], chapterCount: 1, throughChapter: 1 }))
  expect(result).toMatchObject({ status: 'fulfilled', value: { status: 'completed' } })
}, COMPLETE.timeout)

it('skips the gate only when the operator config sets allowIncompleteSettings', async () => {
  const fixture = await useWritingFixture({ allowIncompleteSettings: true })
  const result = await fixture.run(exec => fixture.runner.start(exec, { ...fixture.input, settingsRoots: ['a1'], chapterCount: 1, throughChapter: 1 }))
  expect(result).toMatchObject({ status: 'fulfilled', value: { status: 'completed' } })
}, COMPLETE.timeout)

const runInput = (fixture: Awaited<ReturnType<typeof useWritingFixture>>, settingsRoots: string[]) =>
  ({ ...fixture.input, settingsRoots, chapterCount: 1, throughChapter: 1, revision: null, executionLimits: fixture.runner.limits, serviceLimits: { ...fixture.service.limits, ...fixture.service.researchLimits } })
const setGate = (fixture: Awaited<ReturnType<typeof useWritingFixture>>, allowIncompleteSettings: boolean) => {
  // The plugin reads allowIncompleteSettings from its config at startup; swapping the runner option models an operator restart.
  ;(fixture.runner as unknown as { options: WritingRunnerOptions }).options = { allowIncompleteSettings }
}

it('resumes a stopped run with complete settings under the gate with exactly the native work of an ungated resume', async () => {
  const resumeStopped = async (allowIncompleteSettings: boolean) => {
    const fixture = await useWritingFixture({ allowIncompleteSettings })
    const run = await fixture.runs.begin(fixture.actor, runInput(fixture, ['a4', 'a5', 'g2']))
    await fixture.runs.finish(fixture.actor, run.id, 'stopped', 'Stopped before native execution')
    const result = await fixture.run(exec => fixture.runner.resume(exec, run.id, true))
    expect(result).toMatchObject({ status: 'fulfilled', value: { id: run.id, status: 'completed' } })
    const done = fixture.runs.get(fixture.actor, run.id)
    return { stages: fixture.stages.size, attempts: done.attempts.length, keys: done.attempts.map(attempt => attempt.key), runs: fixture.runs.list(fixture.actor, fixture.novel.id).length }
  }
  const gated = await resumeStopped(false)
  const ungated = await resumeStopped(true)
  expect(gated.stages).toBeGreaterThan(0)
  expect(gated).toEqual(ungated)
  expect(gated.runs).toBe(1)
}, 2 * COMPLETE.timeout)

it('refuses to resume an old e1-only run, leaves it unchanged with no new run, and resumes it under the operator bypass', async () => {
  // A run admitted before the gate existed, or under the bypass, keeps its incomplete settingsRoots.
  const fixture = await useWritingFixture({ allowIncompleteSettings: true })
  const run = await fixture.runs.begin(fixture.actor, runInput(fixture, ['e1']))
  const stopped = await fixture.runs.finish(fixture.actor, run.id, 'stopped', 'Stopped before native execution')
  setGate(fixture, false)
  const result = await fixture.run(exec => fixture.runner.resume(exec, run.id, true))
  expect(result.status).toBe('rejected')
  const reason = result.status === 'rejected' ? result.reason : null
  expect(reason).toBeInstanceOf(SettingsIncompleteError)
  expect(reason).toMatchObject({ name: 'SettingsIncompleteError', code: 'settings-incomplete', missing: ['a3', 'a4', 'a5', 'g1', 'g2'] })
  expect(JSON.parse(String((reason as Error).message).split('\n').at(-1) ?? '')).toEqual({ code: 'settings-incomplete', missing: ['a3', 'a4', 'a5', 'g1', 'g2'] })
  expect(String((reason as Error).message)).not.toContain('allowIncompleteSettings')
  expect(fixture.stages.size).toBe(0)
  expect(fixture.runs.get(fixture.actor, run.id)).toEqual(stopped)
  expect(fixture.runs.list(fixture.actor, fixture.novel.id)).toEqual([stopped])

  setGate(fixture, true)
  const bypassed = await fixture.run(exec => fixture.runner.resume(exec, run.id, true))
  expect(bypassed).toMatchObject({ status: 'fulfilled', value: { id: run.id, status: 'completed' } })
}, COMPLETE.timeout)
