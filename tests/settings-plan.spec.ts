import { describe, expect, it } from 'vitest'
import { settingsCatalog, type SettingsDimension } from '../src/settings-catalog.ts'
import { planSettings, summarizeSettingsCatalog } from '../src/settings-plan.ts'

const dimension = (code: string, dependsOn: readonly string[] = []): SettingsDimension => ({
  code, name: code, dependsOn, enabled: true, kind: 'llm_free', requiredFor: [],
})

describe('settings dependency planning', () => {
  it('orders independent branches before their shared dependent and includes shared inputs once', () => {
    const catalog = [dimension('story', ['hero', 'power']), dimension('power', ['genre']), dimension('genre'), dimension('hero', ['genre'])]
    expect(planSettings(['story', 'power'], catalog)).toEqual({
      selectedCodes: ['genre', 'hero', 'power', 'story'],
      layers: [['genre'], ['hero', 'power'], ['story']],
    })
  })
})

it.each([
  { code: 'locked', enabled: false, kind: 'llm_free' as const, reason: 'Disabled settings dimension: locked' },
  { code: 'external', enabled: true, kind: 'edit_external' as const, reason: 'External settings dimension: external' },
])('rejects $code whether selected directly or pulled in as a dependency', ({ code, enabled, kind, reason }) => {
  const blocked: SettingsDimension = { ...dimension(code), enabled, kind }
  const catalog = [blocked, dimension('consumer', [code])]
  expect(() => planSettings([code], catalog)).toThrow(reason)
  expect(() => planSettings(['consumer'], catalog)).toThrow(reason)
})

it('plans the main plot from its actual prerequisites without inserting unrelated wizard requirements', () => {
  expect(planSettings(['g2'])).toEqual({
    selectedCodes: ['a1', 'a2', 'e1', 'g1', 'g2'],
    layers: [['a1'], ['a2'], ['e1', 'g1'], ['g2']],
  })
  expect(settingsCatalog.filter((entry) => entry.requiredFor.includes('novel_writing')).map((entry) => entry.code)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'e1', 'g1', 'g2'])
  expect(() => planSettings(['e8'])).toThrow('External settings dimension: e8')
})

it.each([
  { name: 'duplicate code', catalog: [dimension('known'), dimension('known')], reason: 'Duplicate settings dimension: known' },
  { name: 'missing dependency', catalog: [dimension('known'), dimension('unused', ['missing'])], reason: 'Missing settings dependency: unused -> missing' },
  { name: 'cycle outside the selected roots', catalog: [dimension('known'), dimension('left', ['right']), dimension('right', ['left'])], reason: 'Settings dependency cycle' },
  { name: 'self dependency outside the selected roots', catalog: [dimension('known'), dimension('self', ['self'])], reason: 'Settings dependency cycle' },
])('rejects an invalid catalog: $name', ({ catalog, reason }) => {
  expect(() => planSettings(['known'], catalog)).toThrow(reason)
})

it.each([
  { roots: [], reason: 'Settings roots must not be empty' },
  { roots: ['a1', 'a1'], reason: 'Duplicate settings root: a1' },
  { roots: ['missing'], reason: 'Unknown settings dimension: missing' },
  { roots: ['A1'], reason: 'Unknown settings dimension: A1' },
])('rejects invalid requested roots: $roots', ({ roots, reason }) => {
  expect(() => planSettings(roots)).toThrow(reason)
})

it('summarizes selectable roots with the cost of their dependency closure', () => {
  const summary = summarizeSettingsCatalog()
  expect(settingsCatalog).toHaveLength(61)
  expect(summary).toHaveLength(60)
  expect(summary.some((entry) => entry.code === 'e8')).toBe(false)
  expect(summary.find((entry) => entry.code === 'g2')).toEqual({
    code: 'g2', name: '主线', dependsOn: ['a1', 'g1', 'e1'], enabled: true,
    kind: 'llm_free', requiredFor: ['script_writing', 'novel_writing'],
    pullsIn: ['a1', 'a2', 'e1', 'g1'], closureSize: 5,
  })
  expect(() => summarizeSettingsCatalog([
    { ...dimension('disabled', ['missing']), enabled: false },
  ])).toThrow('Missing settings dependency: disabled -> missing')
})

it('keeps every direct dependency in an earlier layer across the complete selectable catalog', () => {
  const requested = settingsCatalog.filter((entry) => entry.kind !== 'edit_external').map((entry) => entry.code)
  const plan = planSettings(requested)
  expect(plan.selectedCodes).toHaveLength(60)
  expect(new Set(plan.layers.flat()).size).toBe(60)
  const layerOf = new Map(plan.layers.flatMap((layer, index) => layer.map((code) => [code, index] as const)))
  for (const dimension of settingsCatalog.filter((entry) => entry.kind !== 'edit_external')) {
    const layer = layerOf.get(dimension.code)
    if (layer === undefined) throw new Error(`Selected dimension has no layer: ${dimension.code}`)
    for (const dependency of dimension.dependsOn) {
      const prerequisite = layerOf.get(dependency)
      if (prerequisite === undefined) throw new Error(`Dependency has no layer: ${dependency}`)
      expect(prerequisite).toBeLessThan(layer)
    }
  }
})

it('returns the same sorted plan for reordered immutable inputs', () => {
  const catalog = Object.freeze([dimension('story', ['hero', 'power']), dimension('hero', ['genre']), dimension('genre'), dimension('power', ['genre'])])
  const roots = Object.freeze(['power', 'story'])
  expect(planSettings(roots, catalog)).toEqual({
    selectedCodes: ['genre', 'hero', 'power', 'story'],
    layers: [['genre'], ['hero', 'power'], ['story']],
  })
  expect(roots).toEqual(['power', 'story'])
  expect(catalog.map((entry) => entry.code)).toEqual(['story', 'hero', 'genre', 'power'])
})

it('excludes unavailable roots from summaries but rejects unavailable prerequisites', () => {
  const disabled = { ...dimension('disabled'), enabled: false }
  expect(summarizeSettingsCatalog([disabled, dimension('available')])).toEqual([
    { ...dimension('available'), pullsIn: [], closureSize: 1 },
  ])
  expect(() => summarizeSettingsCatalog([disabled, dimension('dependent', ['disabled'])])).toThrow('Disabled settings dimension: disabled')
})
