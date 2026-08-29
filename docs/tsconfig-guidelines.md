# TypeScript Configuration Guidelines

This document outlines the standards and best practices for `tsconfig.json` files in the Longhand Budget monorepo. Following these guidelines ensures consistency, maintainability, and prevents common linter/formatter issues.

## General Rules

### Formatting (Biome Compliance)

All `tsconfig.json` files must adhere to the project's Biome configuration:

- **Indentation**: 2 spaces (no tabs)
- **Line endings**: LF (Unix-style, no CRLF)
- **Trailing newlines**: Files must end with a newline character
- **No trailing whitespace**: Lines must not have trailing spaces

The Biome configuration is defined in `biome.json` at the repository root:

```json
{
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
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

The root `tsconfig.json` serves as the base configuration for the entire monorepo:

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "baseUrl": ".",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["apps/**/*", "packages/**/*"],
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

**Required fields for root config:**
- `rootDir`: Must be set to "." for proper module resolution
- `baseUrl`: Must be set to "." for path aliases
- `strict`: Must be `true`
- `esModuleInterop`: Must be `true`
- `skipLibCheck`: Must be `true` (for monorepo performance)

### Package Configurations

Each package (`packages/*`) should extend the root configuration and add package-specific settings:

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

Application configs (e.g., `apps/web/tsconfig.json`) follow similar rules to package configs:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
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

All configs use `moduleResolution: "bundler"` which requires TypeScript 5.0+. This is compatible with the project's TypeScript version (5.3.3).

## Validation

Run the validation script to check all tsconfig files:

```bash
npm run validate:tsconfig
# or
node scripts/validate-tsconfig.js
```

This script checks for:
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

**Fix**: Run `pnpm lint:fix` or `pnpm biome check . --apply` to auto-format files.

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-06-20 | Added tsconfig guidelines document | Vibe |
| 2026-06-20 | Added rootDir to root tsconfig.json | Vibe |
| 2026-06-20 | Standardized exclude patterns across all configs | Vibe |
