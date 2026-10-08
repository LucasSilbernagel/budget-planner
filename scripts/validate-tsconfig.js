#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')

const validModuleResolutions = ['node', 'classic', 'node12', 'nodenext', 'node16', 'bundler']

const minTypeScriptVersion = '5.0.0'

function getInstalledTypeScriptVersion() {
  try {
    return require('typescript/package.json').version
  } catch {
    return null
  }
}

function isVersionAtLeast(a, b) {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da > db) return true
    if (da < db) return false
  }
  return true
}

const installedTypeScriptVersion = getInstalledTypeScriptVersion()

function findTsConfigFiles(dir) {
  const results = []
  const files = fs.readdirSync(dir)

  for (const file of files) {
    const fullPath = path.join(dir, file)
    const stat = fs.statSync(fullPath)

    if (stat.isDirectory()) {
      if (file === 'node_modules' || file === '.git' || file === 'dist') {
        continue
      }
      results.push(...findTsConfigFiles(fullPath))
    } else if (file === 'tsconfig.json' || file.match(/^tsconfig\..*\.json$/)) {
      results.push(fullPath)
    }
  }

  return results
}

function validateTsConfig(filePath) {
  const errors = []
  const warnings = []

  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const config = JSON.parse(content)

    if (content.includes('\r\n')) {
      errors.push('Contains CRLF line endings (should be LF)')
    }

    if (content.includes('\t')) {
      errors.push('Contains tabs (should use spaces for indentation)')
    }

    if (!content.endsWith('\n')) {
      warnings.push('Missing trailing newline')
    }

    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimEnd() !== lines[i] && lines[i].trim() !== '') {
        errors.push(`Trailing whitespace on line ${i + 1}`)
        break
      }
    }

    const moduleResolution = config.compilerOptions?.moduleResolution
    if (moduleResolution && !validModuleResolutions.includes(moduleResolution)) {
      errors.push(
        `Invalid moduleResolution: "${moduleResolution}". Valid options: ${validModuleResolutions.join(
          ', '
        )}`
      )
    }

    if (moduleResolution === 'bundler') {
      if (!installedTypeScriptVersion) {
        warnings.push(
          `moduleResolution: "bundler" requires TypeScript ${minTypeScriptVersion}+ (installed version could not be determined)`
        )
      } else if (!isVersionAtLeast(installedTypeScriptVersion, minTypeScriptVersion)) {
        warnings.push(
          `moduleResolution: "bundler" requires TypeScript ${minTypeScriptVersion}+ (installed: ${installedTypeScriptVersion})`
        )
      }
    }

    if (!config.compilerOptions && !config.extends) {
      warnings.push('Missing compilerOptions')
    }

    if (config.extends) {
      const extendedPath = path.resolve(path.dirname(filePath), config.extends)
      if (!fs.existsSync(`${extendedPath}.json`) && !fs.existsSync(extendedPath)) {
        warnings.push(`Extended config not found: ${config.extends}`)
      }
    }

    if (!config.include && !config.files && !config.extends) {
      warnings.push('No include pattern or files specified')
    }

    // A solution-style config (with `references`) must not `include` files its referenced projects
    // own, or tsc reports TS6305. Use `"files": []`.
    if (Array.isArray(config.references) && config.references.length > 0) {
      const configDir = path.dirname(filePath)
      const includePatterns = config.include || []

      const globBaseDir = (pattern) => {
        const segments = pattern.split('/')
        const literal = []
        for (const seg of segments) {
          if (seg.includes('*') || seg.includes('?')) break
          literal.push(seg)
        }
        return path.resolve(configDir, literal.join('/'))
      }

      for (const ref of config.references) {
        if (!ref?.path) continue
        let refDir = path.resolve(configDir, ref.path)
        // `references` paths may point at a directory or directly at a tsconfig file.
        if (refDir.endsWith('.json')) {
          refDir = path.dirname(refDir)
        } else if (fs.existsSync(refDir) && fs.statSync(refDir).isFile()) {
          refDir = path.dirname(refDir)
        }

        for (const pattern of includePatterns) {
          const baseDir = globBaseDir(pattern)
          if (refDir === baseDir || refDir.startsWith(`${baseDir}${path.sep}`)) {
            errors.push(
              `include pattern "${pattern}" overlaps referenced project "${ref.path}". A config with \`references\` must not include its referenced projects’ sources directly (causes TS6305). Use \`"files": []\` and rely on \`references\`.`
            )
          }
        }
      }
    }

    if (config.compilerOptions) {
      const opts = config.compilerOptions
      if ((config.include || config.files) && !opts.rootDir) {
        if (!config.extends) {
          warnings.push(
            'Missing rootDir in compilerOptions (recommended for proper module resolution)'
          )
        } else {
          warnings.push('compilerOptions has include but no explicit rootDir (may be inherited)')
        }
      }
    }

    if (config.include && config.exclude) {
      const hasTestExcludes = config.exclude.some(
        (pattern) =>
          pattern.includes('.test.ts') ||
          pattern.includes('.test.tsx') ||
          pattern.includes('.spec.ts') ||
          pattern.includes('.spec.tsx')
      )
      if (!hasTestExcludes) {
        warnings.push('Has include but no test file excludes (recommended for consistency)')
      }
    }

    return { errors, warnings, filePath }
  } catch (error) {
    return {
      errors: [`Failed to parse ${filePath}: ${error.message}`],
      warnings: [],
      filePath,
    }
  }
}

function main() {
  console.log('🔍 Validating tsconfig files...\n')

  const tsConfigFiles = findTsConfigFiles(projectRoot)
  let hasErrors = false
  let hasWarnings = false

  for (const filePath of tsConfigFiles) {
    const relativePath = path.relative(projectRoot, filePath)
    const { errors, warnings } = validateTsConfig(filePath)

    if (errors.length > 0) {
      hasErrors = true
      console.log(`❌ ${relativePath}`)
      for (const error of errors) {
        console.log(`   Error: ${error}`)
      }
    }

    if (warnings.length > 0) {
      hasWarnings = true
      console.log(`⚠️  ${relativePath}`)
      for (const warning of warnings) {
        console.log(`   Warning: ${warning}`)
      }
    }
  }

  if (tsConfigFiles.length === 0) {
    console.log('ℹ️  No tsconfig files found')
  }

  console.log(`\n${'='.repeat(50)}`)

  if (hasErrors) {
    console.log('❌ Validation FAILED - tsconfig errors found')
    console.log(
      `\n💡 Fix the errors above and ensure all tsconfig files use TypeScript ${minTypeScriptVersion}+ compatible settings.`
    )
    process.exit(1)
  } else if (hasWarnings) {
    console.log('⚠️  Validation PASSED with warnings')
    process.exit(0)
  } else {
    console.log('✅ All tsconfig files are valid!')
    process.exit(0)
  }
}

main()
