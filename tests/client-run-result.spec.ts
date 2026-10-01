/** Writing cards derive settled status from the logged Tool result, not transport success. */
import { expect, test } from 'vitest'
import { readStoryRunResult } from '../src/client/run-result.ts'

function content(value: unknown) { return [{ type: 'text', text: JSON.stringify(value) }] }
const result = { id: 'run_11111111-1111-4111-8111-111111111111', status: 'completed', error: null }

test.each(['running', 'interrupted', 'completed', 'failed', 'stopped'] as const)('reads the exact %s run status', status => {
  const error = status === 'failed' ? 'Stage failed' : null
  expect(readStoryRunResult(content({ ...result, status, error }))).toEqual({ id: result.id, status, error })
})

test.each([
  undefined, [], [{ type: 'text', text: '{' }], [{ type: 'image', text: JSON.stringify(result) }],
  [...content(result), ...content(result)], content(null), content([]), content({ ...result, status: 'success' }),
  content({ ...result, id: ' ' }), content({ ...result, error: 1 }), content({ ...result, error: 'Incomplete stage' }),
])('refuses malformed or contradictory run result %j', value => {
  expect(readStoryRunResult(value)).toBeUndefined()
})
