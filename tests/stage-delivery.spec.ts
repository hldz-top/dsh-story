import { expect, it } from 'vitest'
import { parseStoryStageDeliveries } from '../src/stage-delivery.ts'

const delivery = {
  runId: 'run_88888888-8888-4888-8888-888888888888',
  source: { kind: 'artifact', artifactId: '11111111-1111-4111-8111-111111111111' },
  path: '/workspace/.dsh-story/novel/version.md', description: 'Chapter 2 body · v3', eventSeq: 12,
}
const wire = { version: 1, calls: [{ callId: 'writing-call', deliveries: [delivery] }] }

it('reads complete artifact and rejected-output deliveries without changing their paths or identities', () => {
  const value = { ...wire, calls: [{ callId: 'writing-call', deliveries: [delivery, {
    ...delivery, source: { kind: 'rejected-output', attemptId: 'attempt_22222222-2222-4222-8222-222222222222' },
    path: '/workspace/.dsh-story/rejected/raw.md', description: 'Rejected chapter body output', eventSeq: 15,
  }] }] }
  expect(parseStoryStageDeliveries(value)).toEqual(value)
  expect(parseStoryStageDeliveries({ version: 1, calls: [] })).toEqual({ version: 1, calls: [] })
})

it.each([
  { ...wire, version: 2 },
  { ...wire, calls: [wire.calls[0], wire.calls[0]] },
  { ...wire, unknown: true },
  { ...wire, calls: [{ callId: ' ', deliveries: [delivery] }] },
  { ...wire, calls: [{ callId: 'writing-call', deliveries: [{ ...delivery, path: '' }] }] },
  { ...wire, calls: [{ callId: 'writing-call', deliveries: [{ ...delivery, description: '' }] }] },
  { ...wire, calls: [{ callId: 'writing-call', deliveries: [{ ...delivery, eventSeq: -1 }] }] },
  { ...wire, calls: [{ callId: 'writing-call', deliveries: [{ ...delivery, source: { kind: 'artifact' } }] }] },
  { ...wire, calls: [{ callId: 'writing-call', deliveries: [{ ...delivery, source: { kind: 'artifact', artifactId: 'id', attemptId: 'id' } }] }] },
])('refuses a malformed whole projection rather than omitting invalid deliveries: %j', value => {
  expect(parseStoryStageDeliveries(value)).toBeUndefined()
})
