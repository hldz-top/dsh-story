/** Pure settings dependency planning; generation and persistence belong to writing stages. */
import { settingsCatalog, type SettingsDimension } from './settings-catalog.ts'

/** Selected dimensions and the prerequisite order in which they can be generated. */
export interface SettingsPlan {
  /** The selected roots and their transitive prerequisites, sorted by code. */
  readonly selectedCodes: readonly string[]
  /** Prerequisite layers, with sorted independent codes inside each layer. */
  readonly layers: readonly (readonly string[])[]
}

/** A selectable dimension with the dependencies it would add to a writing request. */
export interface SettingsCatalogSummary extends SettingsDimension {
  /** Transitive prerequisites, sorted by code and excluding this dimension. */
  readonly pullsIn: readonly string[]
  /** Number of distinct dimensions including this root and all its prerequisites. */
  readonly closureSize: number
}

function indexCatalog(catalog: readonly SettingsDimension[]): { dimensions: Map<string, SettingsDimension>; layers: string[][] } {
  const dimensions = new Map<string, SettingsDimension>()
  for (const dimension of catalog) {
    if (dimensions.has(dimension.code)) throw new Error(`Duplicate settings dimension: ${dimension.code}`)
    dimensions.set(dimension.code, dimension)
  }
  for (const dimension of catalog) {
    for (const dependency of dimension.dependsOn) {
      if (!dimensions.has(dependency)) throw new Error(`Missing settings dependency: ${dimension.code} -> ${dependency}`)
    }
  }
  const remaining = new Map(dimensions)
  const layers: string[][] = []
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((dimension) => dimension.dependsOn.every((dependency) => !remaining.has(dependency)))
      .map((dimension) => dimension.code).sort()
    if (ready.length === 0) throw new Error(`Settings dependency cycle: ${[...remaining.keys()].sort().join(', ')}`)
    layers.push(ready)
    for (const code of ready) remaining.delete(code)
  }
  return { dimensions, layers }
}

function selectPlan(roots: readonly string[], indexed: ReturnType<typeof indexCatalog>): SettingsPlan {
  const selected = new Set<string>()
  const visit = (code: string): void => {
    if (selected.has(code)) return
    const dimension = indexed.dimensions.get(code)
    if (dimension === undefined) throw new Error(`Unknown settings dimension: ${code}`)
    if (!dimension.enabled) throw new Error(`Disabled settings dimension: ${code}`)
    if (dimension.kind === 'edit_external') throw new Error(`External settings dimension: ${code}`)
    selected.add(code)
    for (const dependency of dimension.dependsOn) visit(dependency)
  }
  for (const root of roots) visit(root)
  return {
    selectedCodes: [...selected].sort(),
    layers: indexed.layers.map((layer) => layer.filter((code) => selected.has(code))).filter((layer) => layer.length > 0),
  }
}

/**
 * Expands requested roots without implicitly selecting wizard-required dimensions.
 * @param roots Nonempty, unique canonical lowercase codes selected for this request.
 * @param catalog Available dimensions and their direct prerequisites.
 * @returns The dependency closure and deterministic generation layers.
 * @throws If roots are invalid, the catalog has duplicate codes, missing dependencies or cycles,
 * or the selected closure contains an unknown, disabled or external dimension.
 */
export function planSettings(roots: readonly string[], catalog: readonly SettingsDimension[] = settingsCatalog): SettingsPlan {
  if (roots.length === 0) throw new Error('Settings roots must not be empty')
  const requested = new Set<string>()
  for (const code of roots) {
    if (requested.has(code)) throw new Error(`Duplicate settings root: ${code}`)
    requested.add(code)
  }
  return selectPlan(roots, indexCatalog(catalog))
}

/**
 * Describes each available root without selecting or generating it.
 * @param catalog Dimensions whose prerequisites must resolve in this catalog.
 * @returns Entries sorted by code, excluding disabled and external roots.
 * @throws If the catalog is invalid or a selectable root has a disabled or external prerequisite.
 */
export function summarizeSettingsCatalog(catalog: readonly SettingsDimension[] = settingsCatalog): readonly SettingsCatalogSummary[] {
  const indexed = indexCatalog(catalog)
  return [...indexed.dimensions.values()]
    .filter((dimension) => dimension.enabled && dimension.kind !== 'edit_external')
    .sort((left, right) => left.code < right.code ? -1 : left.code > right.code ? 1 : 0)
    .map((dimension) => {
      const plan = selectPlan([dimension.code], indexed)
      return {
        ...dimension,
        dependsOn: [...dimension.dependsOn],
        requiredFor: [...dimension.requiredFor],
        pullsIn: plan.selectedCodes.filter((code) => code !== dimension.code),
        closureSize: plan.selectedCodes.length,
      }
    })
}
