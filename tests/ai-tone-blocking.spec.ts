/** aiToneBlocking (prompt version 5): host-decided blocking of AI tone in body reviews, its stop conditions and resume rules. */
import { describe, expect, it } from 'vitest'
import { hasAiToneMarker } from '../src/ai-tone.ts'
import { AiToneReviewBlockedError, ImportReviewBlockedError, parseArtifactId } from '../src/contracts.ts'
import { buildStagePrompt, CURRENT_PROMPT_VERSION, type StagePromptKind } from '../src/stage-prompts.ts'
import * as Story from '../src/index.ts'
import type { RunExecutionLimits, WritingRun } from '../src/run-store.ts'
import { useWritingFixture, type WritingFixtureOptions, type WritingFixtureStage } from './support/writing-fixture.ts'

const base = { novelId: 'novel_00000000-0000-4000-8000-000000000000' as never, inputs: [{ artifactId: 'artifact_00000000-0000-4000-8000-000000000001' as never, sha256: '0'.repeat(64), kind: 'settings', chars: 10 }], task: '{"x":1}', requirements: ['r1'] }
const kinds: readonly StagePromptKind[] = ['settings', 'review', 'book-outline', 'chapter-outline', 'body', 'continuity']
const BLOCKING_PHRASE = 'the host itself blocks the chapter'
const ADVISORY_PHRASE = 'AI tone is never blocking'

/** @returns The parsed JSON last line of a stop message. */
function lastLine(text: string | null | undefined): Record<string, unknown> {
  const lines = (text ?? '').split('\n')
  return JSON.parse(lines.at(-1) ?? 'null') as Record<string, unknown>
}

describe('prompt version 5', () => {
  it('is the version new runs record', () => { expect(CURRENT_PROMPT_VERSION).toBe(5) })

  it('keeps every stage byte-identical to version 4 unless a body review has the switch on', () => {
    for (const kind of kinds) for (const reviewedKind of [undefined, ...kinds]) {
      const request = { ...base, kind, ...(reviewedKind === undefined ? {} : { reviewedKind }) }
      const v4 = buildStagePrompt({ ...request, promptVersion: 4 })
      expect(buildStagePrompt({ ...request, promptVersion: 5 }), `${kind}/${reviewedKind}`).toBe(v4)
      expect(buildStagePrompt({ ...request, promptVersion: 5, aiToneBlocking: false }), `${kind}/${reviewedKind}`).toBe(v4)
      // The switch is ignored before version 5, so v1-v4 resumes rebuild identical prompts whatever the deployment says.
      for (const promptVersion of [1, 2, 3, 4] as const) expect(buildStagePrompt({ ...request, promptVersion, aiToneBlocking: true })).toBe(buildStagePrompt({ ...request, promptVersion }))
      const blocking = buildStagePrompt({ ...request, promptVersion: 5, aiToneBlocking: true })
      if (kind === 'review' && reviewedKind === 'body') {
        expect(blocking).not.toBe(v4)
        expect(blocking).toContain(BLOCKING_PHRASE)
        expect(blocking).toContain('"ai-tone-"')
        expect(blocking).toContain('exact excerpt of the body')
        expect(blocking).toContain('Keep these issues advisory')
        expect(blocking).not.toContain(ADVISORY_PHRASE)
        expect(v4).toContain(ADVISORY_PHRASE)
      } else expect(blocking, `${kind}/${reviewedKind}`).toBe(v4)
    }
  })

  it('defaults the plugin switch on', () => {
    expect(new Story.Config().aiToneBlocking).toBe(true)
    expect(new Story.Config({ ...new Story.Config(), aiToneBlocking: false }).aiToneBlocking).toBe(false)
  })
})

describe('host markers and the structured stop line', () => {
  it('blocks only spans that carry a host AI-tone marker', () => {
    for (const span of ['说白了，雾港没有灯', '这不是灯，而是路标', '甲、乙、丙', '灯塔——亮了', '这意味着航道安全', '然而，雾散了']) expect(hasAiToneMarker(span), span).toBe(true)
    for (const span of ['林澜走向灯塔', '「说白了，不是灯而是路标」', '雾港的夜很长']) expect(hasAiToneMarker(span), span).toBe(false)
  })

  it('ends an AI-tone stop with reason and spans and no importItems, sharing the review-blocked union with import stops', () => {
    for (const reason of ['ai-tone', 'ai-tone-repeat', 'ai-tone-exhausted'] as const) {
      const error = new AiToneReviewBlockedError(reason, ['说白了'], 'body/1')
      expect(error.code).toBe('review-blocked')
      const line = lastLine(error.message)
      expect(line).toEqual({ code: 'review-blocked', reason, spans: ['说白了'] })
      expect(line).not.toHaveProperty('importItems')
      expect(error.message.split('\n').length).toBeGreaterThan(1)
    }
    const item = { dimensionCode: 'g2', artifactId: parseArtifactId('artifact_00000000-0000-4000-8000-000000000001'), pendingReview: true }
    expect(lastLine(new ImportReviewBlockedError([item], 'stale-import').message)).toEqual({ code: 'review-blocked', reason: 'stale-import', importItems: [item] })
    expect(lastLine(new ImportReviewBlockedError([item]).message)).toEqual({ code: 'review-blocked', importItems: [item] })
  })
})

/** Body-review issue the reviewer files for one quoted excerpt of the body (always advisory style, as admission requires). */
function aiToneIssue(id: string, artifactId: string, quote: string) {
  return { id, severity: 'advisory', category: 'style', location: 'Scene 1 narration', message: 'AI tone in narration.', evidence: [{ artifactId, quote }] }
}
const isBody = (stage: WritingFixtureStage) => stage.kind === 'body'
const isBodyReview = (stage: WritingFixtureStage) => stage.kind === 'review' && typeof stage.task?.measuredWordCount === 'number'

interface Script {
  /** Narration put in front of scene 1, by body attempt (0 = first write). */
  readonly prefix: (attempt: number) => string
  /** Quotes the body reviewer reports as AI tone, by body-review number. */
  readonly quotes: (review: number) => readonly string[]
}

/** A fixture whose bodies carry scripted narration and whose body reviews report scripted AI-tone quotes. */
async function scripted(script: Script, options: WritingFixtureOptions = {}) {
  let bodies = 0
  let reviews = 0
  const bodyTasks: (string | null | undefined)[] = []
  const reviewPrompts: string[] = []
  const fixture = await useWritingFixture({ maxReadChars: 8192, ...options,
    onChildRequest(stage, request) {
      if (!isBodyReview(stage) || reviewPrompts.length > reviews) return
      reviewPrompts.push(request.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' && block.text.includes('TASK_DATA') ? [block.text] : [])).join('\n'))
    },
    intervene(stage, output) {
      if (isBody(stage)) {
        bodyTasks.push(stage.task?.validationError)
        const body = output as { scenes: { sceneId: string; text: string }[] }
        const prefix = script.prefix(bodies++)
        return { ...body, scenes: body.scenes.map((scene, index) => index === 0 ? { ...scene, text: `${prefix}${scene.text}` } : scene) }
      }
      if (isBodyReview(stage)) {
        const artifactId = stage.task?.reviewed?.artifactId ?? ''
        const review = output as { issues: object[] }
        const quotes = script.quotes(reviews++)
        return { ...review, issues: [...review.issues, ...quotes.map((quote, index) => aiToneIssue(`ai-tone-${index + 1}`, artifactId, quote))] }
      }
      return output
    } })
  return { fixture, bodyTasks, reviewPrompts, counts: () => ({ bodies, reviews }) }
}

async function write(fixture: Awaited<ReturnType<typeof useWritingFixture>>): Promise<WritingRun> {
  const outcome = await fixture.run(exec => fixture.runner.start(exec, { ...fixture.input, chapterCount: 1, throughChapter: 1 }))
  if (outcome.status === 'rejected') throw outcome.reason
  return outcome.value
}
function applied(fixture: Awaited<ReturnType<typeof useWritingFixture>>): boolean {
  return fixture.service.getManuscript(fixture.actor, fixture.novel.id).appliedChapters.some(item => item.chapterNumber === 1)
}

describe('stop conditions (aiToneBlocking on, the default)', () => {
  it('repairs a body whose review quotes AI tone, telling the writer the exact spans, then applies the clean repair', { timeout: 120_000 }, async () => {
    const { fixture, bodyTasks, reviewPrompts } = await scripted({ prefix: attempt => attempt === 0 ? '说白了，雾港的灯不是灯而是路标。' : '雾港的灯为船指路。', quotes: review => review === 0 ? ['说白了'] : [] })
    const run = await write(fixture)
    expect(run).toMatchObject({ status: 'completed', promptVersion: 5, executionLimits: { aiToneBlocking: true } })
    expect(bodyTasks).toHaveLength(2)
    expect(lastLine(bodyTasks[1])).toEqual({ code: 'review-blocked', reason: 'ai-tone', spans: ['说白了'] })
    expect(reviewPrompts[0]).toContain(BLOCKING_PHRASE)
    expect(reviewPrompts[0]).not.toContain(ADVISORY_PHRASE)
    expect(applied(fixture)).toBe(true)
  })

  it('(a) records an AI-tone issue whose quote is not a verbatim body excerpt with a marker, without blocking', { timeout: 120_000 }, async () => {
    // The first quote is in the body but carries no marker; the second is in no input at all, so admission downgrades it.
    const { fixture, bodyTasks } = await scripted({ prefix: () => '', quotes: review => review === 0 ? ['林澜在第1章继续调查雾港', '说白了这句并不存在于正文'] : [] })
    const run = await write(fixture)
    expect(run.status).toBe('completed')
    expect(bodyTasks).toHaveLength(1)
    const chapter = fixture.service.getManuscript(fixture.actor, fixture.novel.id).appliedChapters.find(item => item.chapterNumber === 1)
    const review = JSON.parse(fixture.service.getArtifact(fixture.actor, { novelId: fixture.novel.id, artifactId: chapter!.bodyReview.id }).text) as { issues: { id: string; severity: string }[] }
    expect(review.issues.filter(issue => issue.id.startsWith('ai-tone')).map(issue => issue.severity)).toEqual(['advisory', 'advisory'])
  })

  it('(b) stops for human review when a repair keeps a reported span, without spending the remaining repair attempts', { timeout: 120_000 }, async () => {
    const { fixture, counts } = await scripted({ prefix: attempt => `说白了，第${attempt}版的灯不亮。`, quotes: () => ['说白了'] }, { executionLimits: { maxRepairAttempts: 3 } })
    const run = await write(fixture)
    expect(run.status).toBe('failed')
    expect(lastLine(run.error)).toEqual({ code: 'review-blocked', reason: 'ai-tone-repeat', spans: ['说白了'] })
    expect(counts()).toEqual({ bodies: 2, reviews: 2 })
    expect(applied(fixture)).toBe(false)
  })

  it('(b) stops for human review when the repaired body is unchanged and AI tone is reported again', { timeout: 120_000 }, async () => {
    const { fixture, counts } = await scripted({ prefix: () => '说白了，这不是灯，而是路标。', quotes: review => review === 0 ? ['说白了'] : ['不是灯，而是路标'] }, { executionLimits: { maxRepairAttempts: 3 } })
    const run = await write(fixture)
    expect(run.status).toBe('failed')
    expect(lastLine(run.error)).toMatchObject({ code: 'review-blocked', reason: 'ai-tone-repeat', spans: ['不是灯，而是路标'] })
    expect(counts()).toEqual({ bodies: 2, reviews: 2 })
    expect(applied(fixture)).toBe(false)
  })

  it('(c) ends review-blocked when repair attempts run out, never applying or passing the body', { timeout: 120_000 }, async () => {
    const markers = ['说白了', '说穿了', '先说结论']
    const { fixture, counts } = await scripted({ prefix: attempt => `${markers[attempt]}，雾港的灯第${attempt}次熄灭。`, quotes: review => [markers[review]!] }, { executionLimits: { maxRepairAttempts: 2 } })
    const run = await write(fixture)
    expect(run.status).toBe('failed')
    const line = lastLine(run.error)
    expect(line).toEqual({ code: 'review-blocked', reason: 'ai-tone-exhausted', spans: ['先说结论'] })
    expect(line).not.toHaveProperty('importItems')
    expect(counts()).toEqual({ bodies: 3, reviews: 3 })
    expect(applied(fixture)).toBe(false)
    // Every body and review call is an ordinary durable attempt counted against the run's attempt budget.
    expect(fixture.runs.get(fixture.actor, run.id).attempts.filter(attempt => attempt.key.startsWith('body/1/candidate/') && !attempt.key.includes('/review') && !attempt.key.includes('/research'))).toHaveLength(3)
  })

  it('stops with reason ai-tone when no repair attempt is configured', { timeout: 120_000 }, async () => {
    const { fixture, counts } = await scripted({ prefix: () => '说白了，灯灭了。', quotes: () => ['说白了'] }, { executionLimits: { maxRepairAttempts: 0 } })
    const run = await write(fixture)
    expect(lastLine(run.error)).toEqual({ code: 'review-blocked', reason: 'ai-tone', spans: ['说白了'] })
    expect(counts().bodies).toBe(1)
    expect(applied(fixture)).toBe(false)
  })
})

describe('aiToneBlocking off on version 5 behaves like version 4', () => {
  it('keeps AI tone advisory and the version-4 review sentence', { timeout: 120_000 }, async () => {
    const { fixture, bodyTasks, reviewPrompts } = await scripted({ prefix: () => '说白了，灯灭了。', quotes: () => ['说白了'] }, { executionLimits: { aiToneBlocking: false } })
    const run = await write(fixture)
    expect(run).toMatchObject({ status: 'completed', promptVersion: 5, executionLimits: { aiToneBlocking: false } })
    expect(bodyTasks).toHaveLength(1)
    expect(reviewPrompts[0]).toContain(ADVISORY_PHRASE)
    expect(reviewPrompts[0]).not.toContain(BLOCKING_PHRASE)
  })
})

describe('resume rules', () => {
  const begin = async (fixture: Awaited<ReturnType<typeof useWritingFixture>>, executionLimits: RunExecutionLimits, promptVersion?: 1 | 2 | 3 | 4 | 5) => {
    const run = await fixture.runs.begin(fixture.actor, { ...fixture.input, chapterCount: 1, throughChapter: 1, revision: null, executionLimits,
      serviceLimits: { ...fixture.service.limits, ...fixture.service.researchLimits } }, promptVersion)
    return fixture.runs.finish(fixture.actor, run.id, 'stopped', 'Stopped before native work.')
  }

  it('(1) resumes a version-4 run without the field under a default-on config, keeping AI tone advisory and v4 prompts', { timeout: 120_000 }, async () => {
    const { fixture, bodyTasks, reviewPrompts } = await scripted({ prefix: () => '说白了，灯灭了。', quotes: () => ['说白了'] })
    const stopped = await begin(fixture, { ...fixture.runner.limits, aiToneBlocking: true }, 4)
    expect(stopped.executionLimits).not.toHaveProperty('aiToneBlocking')
    const outcome = await fixture.run(exec => fixture.runner.resume(exec, stopped.id, false))
    if (outcome.status === 'rejected') throw outcome.reason
    expect(outcome.value).toMatchObject({ status: 'completed', promptVersion: 4 })
    expect(outcome.value.executionLimits).not.toHaveProperty('aiToneBlocking')
    expect(bodyTasks).toHaveLength(1)
    expect(reviewPrompts[0]).toContain(ADVISORY_PHRASE)
    expect(reviewPrompts[0]).not.toContain(BLOCKING_PHRASE)
    expect(reviewPrompts[0]).toBe(reviewPrompts[0]!.replace(BLOCKING_PHRASE, ''))
  })

  it('(2) refuses a version-5 run whose record lacks the field instead of treating it as off', async () => {
    const fixture = await useWritingFixture()
    const stopped = await begin(fixture, fixture.runner.limits)
    expect(stopped.executionLimits.aiToneBlocking).toBe(true)
    // Simulate a damaged record: strip the field directly in storage.
    const domain = (fixture.runs as unknown as { domain: { table(name: 'novels'): { update(key: unknown, change: (current: { runs: WritingRun[] }) => object): Promise<unknown> } } }).domain
    await domain.table('novels').update(fixture.novel.id, current => ({ ...current, runs: current.runs.map(run => {
      const { aiToneBlocking: _dropped, ...executionLimits } = run.executionLimits
      return { ...run, executionLimits }
    }) }))
    const outcome = await fixture.run(exec => fixture.runner.resume(exec, stopped.id, false))
    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'corrupt-run' } })
    expect(fixture.childRequests).toEqual([])
  })

  it('(3) refuses a version-5 run whose recorded value differs from the current config, in the limit-mismatch style', async () => {
    const fixture = await useWritingFixture()
    const stopped = await begin(fixture, { ...fixture.runner.limits, aiToneBlocking: false })
    expect(stopped).toMatchObject({ promptVersion: 5, executionLimits: { aiToneBlocking: false } })
    const outcome = await fixture.run(exec => fixture.runner.resume(exec, stopped.id, false))
    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'run-limits', message: expect.stringContaining('Restore the captured writing and research limits before resuming') } })
    expect(fixture.childRequests).toEqual([])
    expect(fixture.runs.get(fixture.actor, stopped.id)).toEqual(stopped)
  })
})
