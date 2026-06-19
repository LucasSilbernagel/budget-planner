# TypeScript Configuration Guide

## Overview

This project uses **TypeScript 5.3.3+** with **ES modules** and **bundler module resolution**. The `moduleResolution: "bundler"` setting is a TypeScript 5.0+ feature designed for modern bundlers like Vite, esbuild, and webpack.

## Why `moduleResolution: "bundler"`?

The `bundler` module resolution strategy:
- Is optimized for modern bundlers (Vite, esbuild, webpack 5+)
- Resolves import paths according to Node.js ESM resolution rules
- Works seamlessly with ES modules (`"type": "module"` in package.json)
- Enables proper path aliasing and module resolution in monorepo setups

**Important**: This requires TypeScript 5.0 or later. Attempting to use this with TypeScript 4.x will result in error `TS6046`.

## Project Structure

```
budget-planner/
├── tsconfig.json                    # Root config - base for all packages
├── apps/
│   └── web/
│       ├── tsconfig.json           # Web app config (extends root)
│       └── package.json           # Has typescript ^5.3.3 dependency
└── packages/
    ├── core/
    │   ├── tsconfig.json           # Core package config (extends ../tsconfig.json)
    │   └── package.json           # Has typescript ^5.3.3 dependency
    ├── db/
    │   ├── tsconfig.json           # DB package config (extends ../tsconfig.json)
    │   └── package.json           # Has typescript ^5.3.3 dependency
    ├── config/
    │   ├── tsconfig.json           # Config package config (extends ../tsconfig.json)
    │   └── package.json           # Has typescript ^5.3.3 dependency
    └── tsconfig.json               # Packages base config (extends ../../tsconfig.json)
```

## Configuration Files

### Root tsconfig.json
- Base configuration for the entire monorepo
- Defines path aliases for package imports
- Uses `moduleResolution: "bundler"`
- Includes strict type-checking options

### Package tsconfig.json files
- Extend the root configuration
- Set package-specific options (jsx, outDir, etc.)
- Use `composite: true` for project references
- Include/exclude appropriate source files

## Common Issues & Solutions

### Issue: "Argument for '--moduleResolution' option must be: 'node', 'classic', 'node12', 'nodenext'"

**Cause**: TypeScript version is < 5.0.0

**Solution**:
1. Ensure you're using Node.js 18+ (recommended in .nvmrc)
2. Run `pnpm install` to install TypeScript 5.3.3+ in each package
3. Use workspace-aware commands instead of global `tsc`:
   ```bash
   # Good - uses workspace TypeScript
   pnpm --filter web tsc --noEmit
   pnpm --filter @budget-planner/core tsc --noEmit
   
   # Bad - might use global TypeScript
   npx tsc --noEmit
   ```

### Issue: Path aliases not resolving

**Cause**: Module resolution mismatch between tsconfig and bundler

**Solution**:
1. Ensure Vite (or your bundler) is configured to handle path aliases
2. Check that `baseUrl` and `paths` in tsconfig match your project structure
3. Use the provided scripts in package.json instead of raw `tsc`

## Running TypeScript

### Type-check a specific package
```bash
# Web app
pnpm --filter web type-check
pnpm --filter web tsc --noEmit

# Core package
pnpm --filter @budget-planner/core type-check
pnpm --filter @budget-planner/core tsc --noEmit

# All packages
pnpm -r type-check
```

### Type-check from root
```bash
# Uses root TypeScript (after pnpm install)
pnpm tsc --noEmit

# Or use the dedicated script
pnpm run tsc
```

## Adding New Packages

When adding a new package:

1. Create a `tsconfig.json` that extends the appropriate base:
   ```json
   {
     "extends": "../../tsconfig.json",
     "compilerOptions": {
       "outDir": "./dist",
       "rootDir": "./src",
       "composite": true
     },
     "include": ["src/**/*"],
     "exclude": ["node_modules", "dist"]
   }
   ```

2. Add TypeScript as a dev dependency in the package's package.json:
   ```json
   {
     "devDependencies": {
       "typescript": "^5.3.3"
     }
   }
   ```

3. Add the package to the root tsconfig.json references (if needed for cross-package type checking)

## Development Environment Setup

1. Install Node.js 18+ (recommended: use `nvm use` with the .nvmrc file)
2. Run `pnpm install` to install all dependencies including TypeScript 5.3.3+
3. Use the provided scripts in package.json rather than global TypeScript

## CI/CD Considerations

In CI environments, ensure:
- Node.js 18+ is installed
- `pnpm install` is run before any type-checking
- Use `pnpm run type-check` or `pnpm run tsc` instead of raw `tsc`

## Version Compatibility

| TypeScript | moduleResolution: "bundler" | Recommended |
|------------|----------------------------|-------------|
| 4.9.x      | ❌ Not supported            | No          |
| 5.0.x      | ✅ Supported                | Yes         |
| 5.1.x      | ✅ Supported                | Yes         |
| 5.2.x      | ✅ Supported                | Yes         |
| 5.3.x      | ✅ Supported                | ✅ Yes       |
| 5.4.x      | ✅ Supported                | ✅ Yes       |

This project targets TypeScript 5.3.3+ to ensure all features work correctly.
