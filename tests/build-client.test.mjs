import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'tsdown'
import { clientBuildConfig } from '../scripts/build-client.mjs'
import { checkClientTypes } from '../scripts/check-client-types.mjs'

async function fixture(t, entry, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-story-client-build-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src/client'), { recursive: true })
  await mkdir(join(root, 'lib'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'dsh-story', version: '0.0.0', type: 'module',
  }))
  await writeFile(join(root, 'lib/index.js'), 'export const hostSentinel = true\n')
  await writeFile(join(root, 'src/client/index.ts'), entry)
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(root, 'src/client', name), content)
  }
  return root
}

test('registers one lazy factory with the package ID and Host React identities', async t => {
  const root = await fixture(t, `
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { version } from 'react'
import { View } from './view.tsx'
export const inject = ['slots', 'locale']
export function apply(ctx: Context) { ctx.provide('story', View({ label: version })) }
`, {
    'view.tsx': `export function View({ label }: { label: string }) { return <p>{label}</p> }\n`,
  })
  await build(await clientBuildConfig(root))
  const code = await readFile(join(root, 'lib/client.js'), 'utf8')
  const registrations = []
  const window = { __ModuleLoader__: { load: handoff => registrations.push(handoff) } }
  // There is deliberately no process, module, exports, require, or React global.
  runInNewContext(code, { window }, { timeout: 1000 })
  assert.equal(registrations.length, 1)
  const registration = registrations[0]
  assert.equal(registration.id, 'dsh-story')
  assert.equal(typeof registration.factory, 'function')
  const requested = []
  const hostReact = { version: 'host-react-identity' }
  const hostJsx = { jsx: (type, props) => ({ type, props, owner: hostReact }) }
  const modules = new Map([['react', hostReact], ['react/jsx-runtime', hostJsx]])
  const exports = registration.factory(specifier => {
    requested.push(specifier)
    assert.ok(modules.has(specifier), `unexpected external ${specifier}`)
    return modules.get(specifier)
  })
  assert.deepEqual(requested.sort(), ['react', 'react/jsx-runtime'])
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(Array.from(exports.inject), ['slots', 'locale'])
  const provided = []
  exports.apply({ provide: (...args) => provided.push(args) })
  assert.equal(provided[0][0], 'story')
  assert.equal(provided[0][1].type, 'p')
  assert.equal(provided[0][1].props.children, hostReact.version)
  assert.equal(provided[0][1].owner, hostReact)
  assert.doesNotMatch(code, /@deepseek-ai\/cordis|@deepseek-ai\/dsh-client-ui-tool/)
  assert.equal(await readFile(join(root, 'lib/index.js'), 'utf8'), 'export const hostSentinel = true\n')
  assert.deepEqual((await readdir(join(root, 'lib'))).sort(), ['client.js', 'index.js'])
})

test('rejects a Node builtin instead of shipping an unavailable Host require', async t => {
  const root = await fixture(t, `export { readFileSync } from 'node:fs'\n`)
  await assert.rejects(build(await clientBuildConfig(root)), /unsupported client runtime import.*node:fs/i)
})

test('rejects a runtime DSH service import while type-only imports need no runtime package', async t => {
  const root = await fixture(t, `export { Context } from '@deepseek-ai/cordis'\n`)
  await assert.rejects(build(await clientBuildConfig(root)), /unsupported client runtime import.*@deepseek-ai\/cordis/i)
})

test('rejects CSS rather than producing an unserved sidecar or requiring a new build dependency', async t => {
  const root = await fixture(t, `import './style.css'; export const inject = ['slots']\n`, {
    'style.css': 'p { color: red; }\n',
  })
  await assert.rejects(build(await clientBuildConfig(root)), /CSS imports are outside the T01 client build/i)
})

async function typeFixture(t, blockType, optionsType = '{ line?: number }', projectionType = '{ version: 1; calls: readonly [] }') {
  const root = await fixture(t, '', {
    'StoryPreview.tsx': `import type { OwnerProps } from './owner.js'\nexport type StoryPreviewProps = OwnerProps\n`,
    'StoryRun.tsx': `import type { Projection } from './owner.js'\nexport function StoryRun({ useProjection }: { useProjection: (key: 'story-stage-deliveries') => Projection | undefined }) { return useProjection('story-stage-deliveries') }\n`,
    'owner.d.ts': `import type { MissingBlock } from 'missing-sdk-declaration'
export type Projection = ${projectionType}
export interface OwnerProps {
  block: ${blockType}
  openFile: (path: string, options?: ${optionsType}) => void
  loadImage: (id: string) => Promise<string>
  t: (key: string) => string
}
`,
  })
  await writeFile(join(root, 'tsconfig.client.json'), JSON.stringify({
    compilerOptions: { strict: true, skipLibCheck: true, types: [], noEmit: true },
    include: ['src/client/**/*.ts', 'src/client/**/*.tsx'],
  }))
  return root
}

test('the Client type gate accepts concrete public Tool-card props', async t => {
  const report = checkClientTypes(await typeFixture(t, '{ kind: string }'))
  assert.deepEqual(Object.keys(report), ['block', 'openFile', 'loadImage', 't', 'useProjection'])
})

test('the Client type gate rejects a missing SDK declaration hidden by skipLibCheck', async t => {
  const root = await typeFixture(t, 'MissingBlock')
  assert.throws(() => checkClientTypes(root), /block.*any/)
})

test('the Client type gate rejects any inside the optional file-open parameter', async t => {
  const root = await typeFixture(t, '{ kind: string }', 'MissingBlock')
  assert.throws(() => checkClientTypes(root), /openFile.options.*any/)
})

for (const type of ['MissingBlock', 'unknown']) {
  test(`the Client type gate rejects ${type} in the actual stage projection return`, async t => {
    const root = await typeFixture(t, '{ kind: string }', '{ line?: number }', type)
    assert.throws(() => checkClientTypes(root), /useProjection.*(?:any|unknown)/)
  })
}
