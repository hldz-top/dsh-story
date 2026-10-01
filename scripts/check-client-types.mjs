/** Detect missing published SDK declarations that skipLibCheck can hide. */
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * Check public Tool-card fields and the live stage projection call against installed declarations.
 * @param {string} root Independent package directory containing tsconfig.client.json.
 * @returns {Record<string, string>} Concrete public property types for the check log.
 */
export function checkClientTypes(root = packageRoot) {
  const cwd = resolve(root)
  const config = ts.readConfigFile(resolve(cwd, 'tsconfig.client.json'), ts.sys.readFile)
  const format = diagnostics => ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file,
    getCurrentDirectory: () => cwd,
    getNewLine: () => '\n',
  })
  if (config.error !== undefined) throw new Error(format([config.error]))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, cwd)
  if (parsed.errors.length > 0) throw new Error(format(parsed.errors))
  if (parsed.options.paths !== undefined) throw new Error('The independent Client check cannot use source aliases')
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true })
  for (const file of program.getSourceFiles()) {
    const path = relative(cwd, file.fileName)
    if (!file.isDeclarationFile && (path.startsWith('../') || isAbsolute(path))) {
      throw new Error(`Client source resolved outside the independent package: ${file.fileName}`)
    }
  }
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length > 0) throw new Error(format(diagnostics))
  const source = program.getSourceFile(resolve(cwd, 'src/client/StoryPreview.tsx'))
  if (source === undefined) throw new Error('The Client program must include StoryPreview.tsx')
  const checker = program.getTypeChecker()
  const module = checker.getSymbolAtLocation(source)
  const exported = module === undefined ? undefined
    : checker.getExportsOfModule(module).find(symbol => symbol.name === 'StoryPreviewProps')
  if (exported === undefined) throw new Error('StoryPreviewProps must be exported from the Client card')
  const props = checker.getDeclaredTypeOfSymbol(exported)
  const report = {}
  const concrete = (type, label) => {
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
      const kind = type.flags & ts.TypeFlags.Any ? 'any' : 'unknown'
      throw new Error(`${label} resolved to ${kind} (${checker.typeToString(type)}); check the installed SDK declaration dependencies`)
    }
    if (type.isUnion()) for (const member of type.types) concrete(member, label)
  }
  for (const name of ['block', 'openFile', 'loadImage', 't']) {
    const symbol = props.getProperty(name)
    if (symbol === undefined) throw new Error(`StoryPreviewProps.${name} is missing`)
    const type = checker.getTypeOfSymbolAtLocation(symbol, source)
    concrete(type, name)
    report[name] = checker.typeToString(type)
    if (name === 'block') continue
    const signatures = type.getCallSignatures()
    if (signatures.length === 0) throw new Error(`StoryPreviewProps.${name} must be callable`)
    for (const signature of signatures) {
      for (const parameter of signature.getParameters()) {
        concrete(checker.getTypeOfSymbolAtLocation(parameter, source), `${name}.${parameter.name}`)
      }
      const returns = checker.getReturnTypeOfSignature(signature)
      concrete(returns, `${name}.return`)
      if (name === 'loadImage') concrete(checker.getAwaitedType(returns) ?? returns, `${name}.awaitedReturn`)
    }
  }
  const runSource = program.getSourceFile(resolve(cwd, 'src/client/StoryRun.tsx'))
  if (runSource === undefined) throw new Error('The Client program must include StoryRun.tsx')
  const projectionCalls = []
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useProjection'
      && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'story-stage-deliveries') {
      projectionCalls.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(runSource)
  if (projectionCalls.length !== 1) throw new Error('StoryRun must read its stage delivery projection through one native useProjection call')
  const projectionType = checker.getTypeAtLocation(projectionCalls[0])
  concrete(projectionType, 'useProjection.return')
  report.useProjection = checker.typeToString(projectionType)
  return report
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [name, type] of Object.entries(checkClientTypes())) console.log(`${name}: ${type}`)
  console.log('Client props resolve from installed declarations without source aliases.')
}
