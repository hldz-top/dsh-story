/** With maxRepairAttempts 0, each injected outline violation fails the full live-prompt pipeline with its specific message (see tests/validation-repair-e2e.spec.ts). */
import { describe } from 'vitest'
import { zeroBudgetCases } from './support/validation-injections.ts'

describe('zero repair budget: outline stages', () => zeroBudgetCases(['book-chapter-count', 'book-review-target', 'outline-unknown-obligation', 'outline-chapter-number', 'outline-uncovered-obligation', 'outline-review-missing-check']))
