/** Build the standalone Web half as a DSH module-loader closure factory. */
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const sharedModules = new Set(['react', 'react/jsx-runtime'])

/**
 * Return tsdown configuration without importing any DSH source or build preset.
 * T01 has only local modules and the two shared React imports at runtime.
 * @param {string} root The independent plugin package directory.
 * @returns {Promise<import('tsdown').InlineConfig>} The single-output config.
 */
export async function clientBuildConfig(root = packageRoot) {
  const cwd = resolve(root)
  const manifest = JSON.parse(await readFile(resolve(cwd, 'package.json'), 'utf8'))
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    throw new Error('The client build requires a package.json name')
  }
  return {
    name: `${manifest.name}/client`,
    cwd,
    config: false,
    tsconfig: false,
    entry: { client: resolve(cwd, 'src/client/index.ts') },
    outDir: resolve(cwd, 'lib'),
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    clean: false,
    dts: false,
    sourcemap: false,
    exports: false,
    deps: {
      neverBundle: specifier => sharedModules.has(specifier),
      alwaysBundle: specifier => !sharedModules.has(specifier),
    },
    inputOptions: { transform: { jsx: 'react-jsx' } },
    plugins: [{
      name: 'story-client-runtime-imports',
      resolveId: {
        order: 'pre',
        handler(source, importer) {
          if (importer === undefined || source.startsWith('\0')) return null
          if (/\.css(?:\?|$)/.test(source)) {
            throw new Error(`CSS imports are outside the T01 client build: ${source}`)
          }
          if (sharedModules.has(source)) return { id: source, external: true }
          if (!source.startsWith('.') && !isAbsolute(source)) {
            throw new Error(`Unsupported client runtime import: ${source}; use Host services or an explicitly supported shared module`)
          }
          return null
        },
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      codeSplitting: false,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { build } = await import('tsdown')
  await build(await clientBuildConfig())
}
