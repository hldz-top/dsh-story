/** With maxRepairAttempts 0, each injected body violation fails the full live-prompt pipeline with its specific message (see tests/validation-repair-e2e.spec.ts). */
import { describe } from 'vitest'
import { zeroBudgetCases } from './support/validation-injections.ts'

describe('zero repair budget: body stages', () => zeroBudgetCases(['body-scene-order', 'body-too-short', 'body-too-long', 'body-review-misquote', 'body-review-malformed']))
