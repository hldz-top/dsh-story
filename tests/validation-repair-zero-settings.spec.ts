/** With maxRepairAttempts 0, each injected settings violation fails the full live-prompt pipeline with its specific message (see tests/validation-repair-e2e.spec.ts). */
import { describe } from 'vitest'
import { zeroBudgetCases } from './support/validation-injections.ts'

describe('zero repair budget: settings stages', () => zeroBudgetCases(['settings-schema', 'settings-fact-count', 'settings-content-length', 'settings-dimension-code', 'settings-input-refs']))
