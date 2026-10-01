/** Real isolated DSH storage providers for writing-service behavior tests. */
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as DomainPlugin from '@deepseek-ai/dsh-storage-domain'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import * as JsonPlugin from '@deepseek-ai/dsh-storage-json'
import * as SqlitePlugin from '@deepseek-ai/dsh-storage-sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'
import { openWritingService } from '../../src/service.ts'
import { parseArtifactId, type ArtifactId, type ResearchLimits, type WritingLimits } from '../../src/contracts.ts'
import type { ManuscriptLimits } from '../../src/manuscript.ts'
import { writingDomain } from '../../src/records.ts'

/** Provider variants used by the persistent public-service suite. */
export type StorageKind = 'json' | 'sqlite'
/** Finite limits shared by service fixtures; tests override only the bound under examination. */
export const testManuscriptLimits: ManuscriptLimits = { minChapterWords: 3000, maxChapterWords: 5000 }

/** Finite research limits shared by public service fixtures. */
export const testResearchLimits: ResearchLimits = { maxResearchQuestions: 8, maxResearchCalls: 4, maxResearchSources: 8, maxEvidenceChars: 4096, maxResearchLogEvents: 200 }

/**
 * Own a private medium and every Context opened against it until test completion.
 * @param backend - Real DSH storage provider.
 * @param limits - Explicit writing limits for the test fixture.
 * @param researchLimits - Explicit research bounds, or the complete service fixture defaults.
 * @param seed - Optional one-time durable fixture creation before the writing service opens.
 * @param manuscriptLimits - Explicit complete fixture chapter bounds.
 * @returns Current service, its workspace root, and an awaited restart operation.
 */
export async function useStorage(backend: StorageKind, limits: WritingLimits, researchLimits: ResearchLimits = testResearchLimits, seed?: (facility: DomainFacility, root: string) => Promise<void>, manuscriptLimits: ManuscriptLimits = testManuscriptLimits) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-story-service-'))
  let activeLimits = limits
  let activeManuscriptLimits = manuscriptLimits
  let pendingSeed = seed
  let observeArtifact: (listener: (id: ArtifactId) => void) => void
  let closeCurrent = async (): Promise<void> => {}
  onTestFinished(async () => {
    await closeCurrent()
    await rm(root, { recursive: true, force: true })
  })
  const open = async () => {
    const ctx = new Context()
    const disposers: (() => Promise<unknown>)[] = []
    closeCurrent = async () => {
      for (const dispose of disposers.splice(0).reverse()) await dispose()
    }
    observeArtifact = (listener) => {
      const remove = ctx.on('domain/changed', (change) => {
        if (change.domain === writingDomain.name && change.table === 'artifacts' && change.operation === 'put') listener(parseArtifactId(change.key))
      })
      disposers.push(async () => { remove() })
    }
    const hub = await ctx.plugin(Storage)
    disposers.push(() => hub.dispose())
    const provider = backend === 'json'
      ? await ctx.plugin(JsonPlugin, { root: join(root, 'data') })
      : await ctx.plugin(SqlitePlugin, { path: join(root, 'data.sqlite'), journalMode: 'wal' })
    disposers.push(() => provider.dispose())
    const domain = await ctx.plugin(DomainPlugin, { backend })
    disposers.push(() => domain.dispose())
    if (pendingSeed !== undefined) {
      await pendingSeed(ctx.storageDomain, root)
      pendingSeed = undefined
    }
    const service = await openWritingService(ctx.storageDomain, activeLimits, researchLimits, activeManuscriptLimits)
    disposers.push(() => service.close())
    return service
  }
  const harness = {
    root,
    service: await open(),
    onArtifactStored(listener: (id: ArtifactId) => void) { observeArtifact(listener) },
    async restart(nextLimits: WritingLimits = limits, nextManuscriptLimits: ManuscriptLimits = manuscriptLimits) {
      await closeCurrent()
      activeLimits = nextLimits
      activeManuscriptLimits = nextManuscriptLimits
      harness.service = await open()
      return harness.service
    },
  }
  return harness
}
