/** With maxRepairAttempts 0, each injected continuity violation fails the full live-prompt pipeline with its specific message (see tests/validation-repair-e2e.spec.ts). */
import { describe } from 'vitest'
import { zeroBudgetCases } from './support/validation-injections.ts'

describe('zero repair budget: continuity stages', () => zeroBudgetCases(['continuity-misquote', 'continuity-obligation-evidence', 'continuity-incomplete', 'continuity-review-missing-check']))
