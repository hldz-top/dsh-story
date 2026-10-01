import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Full writing cases await native child runs, reviewed publication and durable file readback.
  test: { include: ['tests/**/*.spec.ts'], pool: 'forks', testTimeout: 60_000, hookTimeout: 60_000 },
})
