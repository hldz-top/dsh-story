/** With maxRepairAttempts 0, each injected research violation fails the full live-prompt pipeline with its specific message (see tests/validation-repair-e2e.spec.ts). */
import { describe } from 'vitest'
import { zeroBudgetCases } from './support/validation-injections.ts'

describe('zero repair budget: research stages', () => zeroBudgetCases(['planning-question-count', 'planning-schema', 'planning-scope', 'planning-duplicate-id', 'research-schema', 'research-unknown-plan']))
