import { expect, it, vi } from 'vitest'
import { SettingsIncompleteError } from '../src/contracts.ts'
import { missingRequiredSettings, REQUIRED_NOVEL_SETTINGS } from '../src/settings-plan.ts'
import { openRunStore, RunStoreError } from '../src/run-store.ts'
import { StageDeliveries } from '../src/stage-deliveries.ts'
import { WritingRunner, type WritingRunnerOptions } from '../src/writing-runner.ts'
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
type Fixture = Awaited<ReturnType<typeof useWritingFixture>>
/** Models an operator restart: the run store reopens (a running run becomes interrupted) and a runner is built with the new plugin config. */
async function restart(fixture: Fixture) {
  await fixture.runner.close()
  await fixture.runs.close()
  const runs = await openRunStore(fixture.ctx.storageDomain, fixture.runs.limits)
  fixture.ctx.effect(() => () => runs.close())
  const runnerWith = (options: WritingRunnerOptions) => {
    const runner = new WritingRunner(fixture.ctx, fixture.service, runs, fixture.runner.limits, new StageDeliveries(fixture.ctx, fixture.service, runs, '.dsh-story'), options)
    fixture.ctx.effect(() => () => runner.close())
    return runner
  }
  return { runs, runnerWith }
}
/** @returns A run with only e1 (admitted before the gate or under the bypass) left in the requested state. */
async function oldRun(fixture: Fixture, state: 'stopped' | 'interrupted' | 'failed' | 'completed') {
  const run = await fixture.runs.begin(fixture.actor, runInput(fixture, ['e1']))
  if (state !== 'interrupted') await fixture.runs.finish(fixture.actor, run.id, state, state === 'completed' ? undefined : `Run ${state} before the gate.`)
  const restarted = await restart(fixture)
  const before = restarted.runs.get(fixture.actor, run.id)
  expect(before.status).toBe(state)
  return { ...restarted, run, before }
}

it('resumes a stopped run with complete settings under the gate with exactly the native work of an ungated resume', async () => {
  const resumeStopped = async (allowIncompleteSettings: boolean) => {
    const fixture = await useWritingFixture({ allowIncompleteSettings })
    const run = await fixture.runs.begin(fixture.actor, runInput(fixture, ['a4', 'a5', 'g2']))
    await fixture.runs.finish(fixture.actor, run.id, 'stopped', 'Stopped before native execution')
    const result = await fixture.run(exec => fixture.runner.resume(exec, run.id, true))
    expect(result).toMatchObject({ status: 'fulfilled', value: { id: run.id, status: 'completed' } })
    const done = fixture.runs.get(fixture.actor, run.id)
    // Parallel stages finish in any order, so compare the attempt keys as a sorted list.
    return { stages: fixture.stages.size, attempts: done.attempts.length, keys: done.attempts.map(attempt => attempt.key).sort(), runs: fixture.runs.list(fixture.actor, fixture.novel.id).length }
  }
  const gated = await resumeStopped(false)
  const ungated = await resumeStopped(true)
  expect(gated.stages).toBeGreaterThan(0)
  expect(gated).toEqual(ungated)
  expect(gated.runs).toBe(1)
}, 2 * COMPLETE.timeout)

it.each(['stopped', 'interrupted', 'failed'] as const)('refuses to resume an old e1-only %s run, leaves it unchanged with no new run, and resumes it under the operator bypass', async state => {
  const fixture = await useWritingFixture({ allowIncompleteSettings: true })
  const { runs, runnerWith, run, before } = await oldRun(fixture, state)
  const result = await fixture.run(exec => runnerWith({ allowIncompleteSettings: false }).resume(exec, run.id, true))
  expect(result.status).toBe('rejected')
  const reason = result.status === 'rejected' ? result.reason : null
  expect(reason).toBeInstanceOf(SettingsIncompleteError)
  expect(reason).toMatchObject({ name: 'SettingsIncompleteError', code: 'settings-incomplete', missing: ['a3', 'a4', 'a5', 'g1', 'g2'] })
  expect(JSON.parse(String((reason as Error).message).split('\n').at(-1) ?? '')).toEqual({ code: 'settings-incomplete', missing: ['a3', 'a4', 'a5', 'g1', 'g2'] })
  expect(String((reason as Error).message)).not.toContain('allowIncompleteSettings')
  expect(fixture.stages.size).toBe(0)
  expect(runs.get(fixture.actor, run.id)).toEqual(before)
  expect(runs.list(fixture.actor, fixture.novel.id)).toEqual([before])

  const bypassed = await fixture.run(exec => runnerWith({ allowIncompleteSettings: true }).resume(exec, run.id, true))
  expect(bypassed).toMatchObject({ status: 'fulfilled', value: { id: run.id, status: 'completed' } })
}, COMPLETE.timeout)

it('keeps the run-state refusal for a completed run whose settings are incomplete', async () => {
  const fixture = await useWritingFixture({ allowIncompleteSettings: true })
  const { runs, runnerWith, run, before } = await oldRun(fixture, 'completed')
  const result = await fixture.run(exec => runnerWith({ allowIncompleteSettings: false }).resume(exec, run.id, true))
  expect(result.status).toBe('rejected')
  const reason = result.status === 'rejected' ? result.reason : null
  expect(reason).not.toBeInstanceOf(SettingsIncompleteError)
  expect(reason).toBeInstanceOf(RunStoreError)
  expect(reason).toMatchObject({ code: 'run-state', message: 'Completed runs cannot resume' })
  expect(runs.get(fixture.actor, run.id)).toEqual(before)
  expect(runs.list(fixture.actor, fixture.novel.id)).toEqual([before])
  expect(fixture.stages.size).toBe(0)
})

it('checks required settings before the present tool and the captured limits on write and resume', async () => {
  const fixture = await useWritingFixture({ allowIncompleteSettings: true })
  const input = runInput(fixture, ['e1'])
  // An old e1-only run whose captured research limits no longer match the deployment, so resume would also fail run-limits.
  const run = await fixture.runs.begin(fixture.actor, { ...input, serviceLimits: { ...input.serviceLimits, maxResearchCalls: input.serviceLimits.maxResearchCalls + 1 } })
  await fixture.runs.finish(fixture.actor, run.id, 'stopped', 'Run stopped before the gate.')
  const { runs, runnerWith } = await restart(fixture)
  const before = runs.get(fixture.actor, run.id)
  const gated = runnerWith({ allowIncompleteSettings: false })
  const ungated = runnerWith({ allowIncompleteSettings: true })
  const write = { ...fixture.input, settingsRoots: ['e1'] }
  const refusedFor = (missing: string[]) => ({ status: 'rejected', reason: { name: 'SettingsIncompleteError', code: 'settings-incomplete', missing } })
  const noPresent = { status: 'rejected', reason: { message: 'Writing requires the native present tool in this Agent scope' } }

  const tools = fixture.ctx.tools
  const get = tools.get.bind(tools)
  const hidden = vi.spyOn(tools, 'get').mockImplementation(((name: string, ...rest: unknown[]) => name === 'present' ? undefined : (get as (...args: unknown[]) => unknown)(name, ...rest)) as typeof tools.get)
  try {
    // Without the gate these requests fail on the missing present tool; with it they must report the settings first.
    expect(await fixture.run(exec => ungated.resume(exec, run.id, true))).toMatchObject(noPresent)
    expect(await fixture.run(exec => ungated.start(exec, write))).toMatchObject(noPresent)
    expect(await fixture.run(exec => gated.resume(exec, run.id, true))).toMatchObject(refusedFor(['a3', 'a4', 'a5', 'g1', 'g2']))
    expect(await fixture.run(exec => gated.start(exec, write))).toMatchObject(refusedFor(['a3', 'a4', 'a5', 'g1', 'g2']))
  } finally { hidden.mockRestore() }

  // With present visible, the ungated resume fails on the changed limits; the gated one still reports the settings.
  const limits = await fixture.run(exec => ungated.resume(exec, run.id, true))
  expect(limits).toMatchObject({ status: 'rejected', reason: { name: 'RunStoreError', code: 'run-limits' } })
  expect(await fixture.run(exec => gated.resume(exec, run.id, true))).toMatchObject(refusedFor(['a3', 'a4', 'a5', 'g1', 'g2']))
  expect(runs.get(fixture.actor, run.id)).toEqual(before)
  expect(runs.list(fixture.actor, fixture.novel.id)).toEqual([before])
  expect(fixture.stages.size).toBe(0)
})
