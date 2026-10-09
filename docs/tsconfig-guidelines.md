# TypeScript Configuration Guidelines

This document outlines the standards and best practices for `tsconfig.json` files in the Longhand Budget monorepo. Following these guidelines ensures consistency, maintainability, and prevents common linter/formatter issues.

## General Rules

### Formatting (Biome Compliance)

All `tsconfig.json` files must adhere to the project's Biome configuration:

- **Indentation**: tabs
- **Line endings**: LF (Unix-style, no CRLF)
- **Trailing newlines**: Files must end with a newline character
- **No trailing whitespace**: Lines must not have trailing spaces

The Biome configuration is defined in `biome.json` at the repository root:

```json
{
  "formatter": {
    "indentStyle": "tab",
    "lineEnding": "lf"
  }
}
```

### JSON Validity

- All `tsconfig.json` files must be valid JSON
- Use double quotes for all strings and property names
- No trailing commas (while JSON5 supports them, we use strict JSON)

## Configuration Standards

### Base Configuration (Root)

The root `tsconfig.json` holds the shared compiler options and lists every workspace as a project reference. It compiles nothing itself (`"files": []`). Abridged:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "rootDir": ".",
    "paths": { "@budget-planner/core": ["./packages/core/src"] },
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "files": [],
  "references": [
    { "path": "./apps/web" },
    { "path": "./packages/db" },
    { "path": "./packages/config" },
    { "path": "./packages/core" }
  ]
}
```

**Required fields for root config:**
- `rootDir`: Must be set to "."
- `strict`: Must be `true`
- `esModuleInterop`: Must be `true`
- `skipLibCheck`: Must be `true` (for monorepo performance)

### Package Configurations

Each package (`packages/*`) extends the root configuration and add package-specific settings:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": [
    "node_modules",
    "dist",
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx"
  ]
}
```

**Required fields for package configs:**
- `extends`: Must extend the appropriate base config
- `outDir`: Must be set to "./dist"
- `rootDir`: Must be set to "./src" (or appropriate source directory)
- `include`: Must include source files
- `exclude`: Must exclude `node_modules`, `dist`, and test files
- `composite`: Must be `true` (for project references)

### Application Configurations

`apps/web/tsconfig.json` is itself a solution file (`"files": []`) referencing four configs, all run by `pnpm --filter web type-check`:

- `tsconfig.app.json` - application source (shown below)
- `tsconfig.vitest.json` - unit tests
- `tsconfig.e2e.json` - Playwright specs
- `tsconfig.node.json` - Node-side `*.mjs` entry and script files (type-checked only where a file opts in with `// @ts-check`) plus `vite.config.ts`; targets ES2023 with `nodenext` resolution

`tsconfig.app.json`, abridged:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src/**/*"],
  "exclude": [
    "node_modules",
    "dist",
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx"
  ]
}
```

## Consistency Checks

### Exclude Patterns

All configs with an `include` field must have consistent `exclude` patterns:

```json
"exclude": [
  "node_modules",
  "dist",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx"
]
```

This ensures test files are never type-checked as part of the regular build.

### Compiler Options Inheritance

Child configs inherit compiler options from their parent via the `extends` field. However, certain options should be explicitly set in child configs:

- `outDir`: Should be set to the package's output directory
- `rootDir`: Should be set to the package's source directory
- `composite`: Should be `true` for packages that are referenced by others
- Package-specific options (e.g., `jsx` for React apps)

### Module Resolution

All configs use `moduleResolution: "bundler"` which requires TypeScript 5.0+. The project uses TypeScript ^5.3.3. `tsconfig.node.json` is the exception: it uses `nodenext`.

## Validation

Run the validation script to check all tsconfig files:

```bash
pnpm validate:tsconfig
```

CI and `pnpm lint` run it. It checks for:
- Valid JSON syntax
- Valid `extends` references
- Presence of required fields
- Compatible TypeScript settings

## Common Issues and Fixes

### Issue 1: Missing rootDir

**Symptom**: TypeScript may have trouble resolving modules.

**Fix**: Add `"rootDir": "."` to the root config or appropriate source directory to child configs.

### Issue 2: Inconsistent exclude patterns

**Symptom**: Test files may be type-checked when they shouldn't be.

**Fix**: Ensure all configs with `include` also have test file excludes:
```json
"exclude": [
  "node_modules",
  "dist",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx"
]
```

### Issue 3: Formatting violations

**Symptom**: Biome linter reports formatting issues.

**Fix**: Run `pnpm lint:fix` or `pnpm biome check . --write` to auto-format files.
