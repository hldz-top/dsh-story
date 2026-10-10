/** With maxRepairAttempts 0, each injected settings-review violation fails the full live-prompt pipeline with its specific message (see tests/validation-repair-e2e.spec.ts). */
import { describe } from 'vitest'
import { zeroBudgetCases } from './support/validation-injections.ts'

describe('zero repair budget: settings-review stages', () => zeroBudgetCases(['settings-review-misquote', 'settings-review-missing-check', 'settings-review-style-severity', 'settings-review-blocking', 'collection-review-misquote']))
