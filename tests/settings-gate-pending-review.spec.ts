/** T4: a resume refused by the required-settings gate also names selected imports awaiting review (importItems); the two codes stay separate. */
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { ImportRefusedError, SettingsIncompleteError, parseRequestId } from '../src/contracts.ts'
import { StageDeliveries } from '../src/stage-deliveries.ts'
import { WritingRunner, type WritingRunnerOptions } from '../src/writing-runner.ts'
import { useWritingFixture } from './support/writing-fixture.ts'

const SLOW = 240_000
type Fixture = Awaited<ReturnType<typeof useWritingFixture>>

const lastLine = (cause: unknown) => JSON.parse(String((cause as Error).message).split('\n').at(-1) ?? '') as Record<string, unknown>
const runInput = (fixture: Fixture, settingsRoots: string[]) =>
  ({ ...fixture.input, requestId: parseRequestId(`old-${randomUUID()}`), settingsRoots, chapterCount: 1, throughChapter: 1, mode: 'update' as const, revision: null, executionLimits: fixture.runner.limits, serviceLimits: { ...fixture.service.limits, ...fixture.service.researchLimits } })

/** Settings heads for `roots` written under the bypass, so every selected dimension can be imported over. */
async function written(roots: readonly string[]) {
  const fixture = await useWritingFixture({ allowIncompleteSettings: true })
  const result = await fixture.run(exec => fixture.runner.start(exec, { ...fixture.input, settingsRoots: [...roots], chapterCount: 1, throughChapter: 1 }))
  if (result.status !== 'fulfilled' || result.value.status !== 'completed') throw new Error(`Setup run did not complete: ${JSON.stringify(result)}`)
  return fixture
}

function runnerWith(fixture: Fixture, options: WritingRunnerOptions) {
  const runner = new WritingRunner(fixture.ctx, fixture.service, fixture.runs, fixture.runner.limits, new StageDeliveries(fixture.ctx, fixture.service, fixture.runs, '.dsh-story'), options)
  fixture.ctx.effect(() => () => runner.close())
  return runner
}

/** A stopped run over `roots` (admitted under the bypass), and optionally an author import of `code` made after it stopped. */
async function stoppedRun(fixture: Fixture, roots: string[], ...codes: string[]) {
  const run = await fixture.runs.begin(fixture.actor, runInput(fixture, roots))
  await fixture.runs.finish(fixture.actor, run.id, 'stopped', 'Stopped by the author.')
  let imported = null
  for (const code of codes) imported = await importOne(fixture, code)
  return { run, imported }
}

async function importOne(fixture: Fixture, code: string) {
  const current = fixture.service.getSettings(fixture.actor, fixture.novel.id).applied.find(item => item.dimensionCode === code)
  if (current === undefined) throw new Error(`No ${code} head`)
  const text = JSON.parse(fixture.service.getArtifact(fixture.actor, { novelId: fixture.novel.id, artifactId: current.artifact.id }).text) as Record<string, unknown>
  const output = { ...text, inputRefs: [], contentMarkdown: `# 作者导入 ${code}\n\n待复核`, facts: [{ id: `import-${code}`, statement: '本书是一部发生在虚构雾港的悬疑冒险小说。待复核' }] }
  const imported = await fixture.run(exec => fixture.runner.importSettings(exec, { novelId: fixture.novel.id, requestId: parseRequestId(`import-${code}`), dimensionCode: code, expectedAppliedId: current.artifact.id, output }))
  if (imported.status !== 'fulfilled') throw new Error(String(imported.reason))
  expect(imported.value).toMatchObject({ origin: 'import', pendingReview: true })
  return imported.value
}

it('T4 both: a resume missing required settings with a pending import reports settings-incomplete carrying importItems, and changes nothing', async () => {
  const fixture = await written(['a4', 'a5', 'g2'])
  // g2 is pending too but outside the e1-only run's settingsRoots closure, so neither error names it.
  const { run, imported } = await stoppedRun(fixture, ['e1'], 'g2', 'e1')
  expect(fixture.service.getSettings(fixture.actor, fixture.novel.id).applied.filter(entry => entry.pendingReview).map(entry => entry.dimensionCode).sort()).toEqual(['e1', 'g2'])
  const before = fixture.runs.get(fixture.actor, run.id)
  const stages = fixture.stages.size
  const item = { dimensionCode: 'e1', artifactId: imported!.artifact.id, pendingReview: true }

  const result = await fixture.run(exec => runnerWith(fixture, { allowIncompleteSettings: false }).resume(exec, run.id, false))
  expect(result.status).toBe('rejected')
  const reason = result.status === 'rejected' ? result.reason : null
  expect(reason).toBeInstanceOf(SettingsIncompleteError)
  expect(reason).not.toBeInstanceOf(ImportRefusedError)
  expect(reason).toMatchObject({ name: 'SettingsIncompleteError', code: 'settings-incomplete', missing: ['a3', 'a4', 'a5', 'g1', 'g2'], importItems: [item] })
  expect(lastLine(reason)).toEqual({ code: 'settings-incomplete', missing: ['a3', 'a4', 'a5', 'g1', 'g2'], runId: run.id, importItems: [item] })
  // The items use exactly the key and format of the import-refused line.
  const bypassed = await fixture.run(exec => runnerWith(fixture, { allowIncompleteSettings: true }).resume(exec, run.id, false))
  expect(bypassed.status).toBe('rejected')
  const refused = bypassed.status === 'rejected' ? bypassed.reason : null
  expect(refused).toBeInstanceOf(ImportRefusedError)
  expect(lastLine(refused)).toEqual({ code: 'import-refused', reason: 'pending-review', runId: run.id, importItems: [item] })
  expect(lastLine(reason).importItems).toEqual(lastLine(refused).importItems)

  const message = String((reason as Error).message)
  expect(message).toContain('Required novel settings are missing: a3 (')
  expect(message).toContain(`Imported settings also await a consistency review (e1); run ${run.id} cannot resume. Stop it if needed and start a new story_update to review them.`)
  expect(String((refused as Error).message)).toContain(`(e1); run ${run.id} cannot resume. Stop it if needed and start a new story_update to review them`)
  expect(message).not.toContain('allowIncompleteSettings')
  expect(fixture.runs.get(fixture.actor, run.id)).toEqual(before)
  expect(fixture.stages.size).toBe(stages)
}, SLOW)

it('T4 settings only: without a pending import the settings-incomplete line has no importItems field', async () => {
  const fixture = await written(['e1'])
  const { run } = await stoppedRun(fixture, ['e1'])
  const result = await fixture.run(exec => runnerWith(fixture, { allowIncompleteSettings: false }).resume(exec, run.id, false))
  const reason = result.status === 'rejected' ? result.reason : null
  expect(reason).toBeInstanceOf(SettingsIncompleteError)
  expect(reason).toMatchObject({ missing: ['a3', 'a4', 'a5', 'g1', 'g2'], importItems: [] })
  expect(lastLine(reason)).toEqual({ code: 'settings-incomplete', missing: ['a3', 'a4', 'a5', 'g1', 'g2'] })
  expect(String((reason as Error).message)).not.toContain('Imported settings also await')
}, SLOW)

it('T4 new request: a write refused by the gate never carries importItems, because a new story_update is what reviews imports', async () => {
  const fixture = await written(['e1'])
  await stoppedRun(fixture, ['e1'], 'e1')
  const result = await fixture.run(exec => runnerWith(fixture, { allowIncompleteSettings: false }).start(exec, { ...fixture.input, requestId: parseRequestId('new-e1'), settingsRoots: ['e1'], chapterCount: 1, throughChapter: 1, mode: 'update' }))
  const reason = result.status === 'rejected' ? result.reason : null
  expect(reason).toBeInstanceOf(SettingsIncompleteError)
  expect(lastLine(reason)).toEqual({ code: 'settings-incomplete', missing: ['a3', 'a4', 'a5', 'g1', 'g2'] })
}, SLOW)

it('T4 pending only (OPT1): complete settings with a pending import still refuse the resume with import-refused/pending-review', async () => {
  const fixture = await written(['a4', 'a5', 'g2'])
  const { run, imported } = await stoppedRun(fixture, ['a4', 'a5', 'g2'], 'e1')
  const before = fixture.runs.get(fixture.actor, run.id)
  const result = await fixture.run(exec => runnerWith(fixture, { allowIncompleteSettings: false }).resume(exec, run.id, false))
  const reason = result.status === 'rejected' ? result.reason : null
  expect(reason).toBeInstanceOf(ImportRefusedError)
  expect(reason).not.toBeInstanceOf(SettingsIncompleteError)
  expect(lastLine(reason)).toEqual({ code: 'import-refused', reason: 'pending-review', runId: run.id, importItems: [{ dimensionCode: 'e1', artifactId: imported!.artifact.id, pendingReview: true }] })
  expect(fixture.runs.get(fixture.actor, run.id)).toEqual(before)
}, SLOW)
