/** Real isolated DSH providers used by run-store persistence tests. */
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as Domains from '@deepseek-ai/dsh-storage-domain'
import * as Json from '@deepseek-ai/dsh-storage-json'
import * as Sqlite from '@deepseek-ai/dsh-storage-sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'
import { openRunStore, type RunStore, type RunStoreLimits } from '../../src/run-store.ts'

/** Awaited ownership of one private provider directory and every reopened store. */
export interface RunStorageFixture {
  readonly root: string
  store: RunStore
  restart(limits?: RunStoreLimits): Promise<RunStore>
  onStored(listener: (table: string, key: string) => void): void
}

/** @param backend - Installed real provider. @param limits - Explicit deployment bounds. @returns An isolated store with awaited restart and teardown. */
export async function useRunStorage(backend: 'json' | 'sqlite', limits: RunStoreLimits): Promise<RunStorageFixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-story-runs-'))
  let disposeCurrent = async (): Promise<void> => {}
  let observe: RunStorageFixture['onStored'] = () => { throw new Error('Store not open') }
  onTestFinished(async () => {
    await disposeCurrent()
    await rm(root, { recursive: true, force: true })
  })
  const open = async (bounds: RunStoreLimits): Promise<RunStore> => {
    const ctx = new Context()
    const disposers: (() => Promise<unknown>)[] = []
    disposeCurrent = async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() }
    const storage = await ctx.plugin(Storage)
    disposers.push(() => storage.dispose())
    const provider = backend === 'json'
      ? await ctx.plugin(Json, { root: join(root, 'data') })
      : await ctx.plugin(Sqlite, { path: join(root, 'data.sqlite'), journalMode: 'wal' })
    disposers.push(() => provider.dispose())
    const domain = await ctx.plugin(Domains, { backend })
    disposers.push(() => domain.dispose())
    observe = listener => {
      const remove = ctx.on('domain/changed', event => {
        if (event.domain === 'story_runs' && event.operation === 'put') listener(event.table, event.key)
      })
      disposers.push(async () => { remove() })
    }
    const store = await openRunStore(ctx.storageDomain, bounds)
    disposers.push(() => store.close())
    return store
  }
  const fixture: RunStorageFixture = {
    root,
    store: await open(limits),
    onStored(listener) { observe(listener) },
    async restart(nextLimits = limits) {
      await disposeCurrent()
      fixture.store = await open(nextLimits)
      return fixture.store
    },
  }
  return fixture
}
