# Budget Planner - BMAD Project

A personal budget planning software project built using the BMAD Method.

## Project Status

- **BMAD Installation**: Pending (requires Node.js 20.12+)
- **Current Phase**: Pre-Analysis
- **Track**: BMAD Method (recommended for products with 10-50+ stories)

## Quick Start

### 1. Install Node.js 20.12+
BMAD requires Node.js 20.12 or higher. You currently have v16.16.0.

**Options:**
- Download from [Node.js official website](https://nodejs.org/)
- Use a version manager like `nvm`:
  ```bash
  nvm install 20
  nvm use 20
  ```

### 2. Install BMAD Method
Once Node.js 20.12+ is installed, run:
```bash
cd /Users/lucassilbernagel/Documents/development/side-projects/budget-planner
npx bmad-method install
```

When prompted:
- Select **BMad Method** module
- Choose your AI tool (Claude Code, Cursor, etc.)
- Accept defaults for other settings

### 3. Begin Analysis Phase
After installation, use the `bmad-help` skill to get started:
```
bmad-help I have a product document for a budget planner. Where should I start?
```

## Project Structure (After BMAD Installation)

```
budget-planner/
├── _bmad/                          # BMAD configuration and agents
│   ├── core/
│   ├── bmm/
│   └── ...
├── _bmad-output/                   # Generated artifacts
│   ├── planning-artifacts/
│   │   ├── PRD.md                  # Product Requirements Document
│   │   ├── architecture.md         # Technical architecture
│   │   └── epics/                  # Epic and story files
│   ├── implementation-artifacts/
│   │   └── sprint-status.yaml      # Sprint tracking
│   └── project-context.md          # Implementation rules
├── product-document.md             # Your product document (to be added)
└── README.md
```

## Recommended Workflow

Based on having a detailed product document, here's your optimal path:

### Phase 1: Analysis (Optional but Recommended)
Since you already have a product document, you can either:

1. **Use `bmad-product-brief`** - Quick guided session to extract key insights from your document
2. **Use `bmad-prfaq`** - Rigorous validation of your product concept
3. **Skip to Phase 2** - Go directly to PRD creation

### Phase 2: Planning (Required)
```
bmad-prd Create
```
This will create your Product Requirements Document. You can feed your existing product document as input.

### Phase 3: Solutioning
```
bmad-create-architecture
bmad-create-epics-and-stories
bmad-check-implementation-readiness
```

### Phase 4: Implementation
```
bmad-sprint-planning
# Then for each story:
bmad-create-story
bmad-dev-story
bmad-code-review
```

## Using Your Product Document

Your product document can be used in several ways:

1. **As input to `bmad-product-brief`** - The agent will extract and organize key information
2. **As input to `bmad-prd`** - The PRD workflow can incorporate your existing document
3. **As a reference in `_bmad-output/project-context.md`** - Add it as a knowledge source

## Resources

- [BMAD Documentation](https://docs.bmad-method.org/)
- [Getting Started Guide](https://docs.bmad-method.org/tutorials/getting-started/)
- [Workflow Map](https://docs.bmad-method.org/reference/workflow-map/)
- [BMAD Discord Community](https://discord.gg/gk8jAdXWmj)

## Next Steps

1. ✅ Project folder created
2. ✅ Monorepo structure initialized (pnpm workspaces)
3. ⏳ Upgrade Node.js to 20.12+
4. ⏳ Install BMAD Method
5. ⏳ Add your product document to the folder
6. ⏳ Run `bmad-help` for personalized guidance

---

## Monorepo Structure (Implemented)

This project now has a **monorepo structure with pnpm workspaces** as defined in Story 1.1.

### Workspace Configuration

```
budget-planner/
├── pnpm-workspace.yaml          # Workspace configuration
├── package.json                 # Root package.json with scripts
├── tsconfig.json                # Root TypeScript config
├── .npmrc                       # pnpm configuration
├── README.md                    # This file
├── apps/
│   └── web/                     # TanStack Start frontend
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.tsx
└── packages/
    ├── core/                    # Shared utilities & calculations
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       └── index.ts
    ├── db/                      # Database schema & ORM
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       └── index.ts
    └── config/                  # Centralized configuration
        ├── package.json
        ├── tsconfig.json
        └── src/
            └── index.ts
```

### Package Descriptions

| Package | Purpose | Dependencies |
|---------|---------|--------------|
| `@budget-planner/web` | Frontend (TanStack Start + React 19) | React, TanStack, Zustand, Recharts, Radix |
| `@budget-planner/db` | Database (Drizzle ORM + PostgreSQL) | Drizzle ORM, pg |
| `@budget-planner/config` | Configuration (Zod validation) | Zod |
| `@budget-planner/core` | Shared utilities & calculations | TypeScript types from db/config |

### Available Scripts

```bash
# Install all dependencies
pnpm install

# Development
pnpm dev              # Start frontend
pnpm dev:web          # Start web app
pnpm dev:db           # Start db package
pnpm dev:config       # Start config package
pnpm dev:core         # Start core package

# Build
pnpm build            # Build frontend
pnpm build:all        # Build all packages

# Quality Checks
pnpm lint             # Run Biome linter
pnpm lint:fix         # Fix linting issues
pnpm type-check       # Type-check all packages

# Testing
pnpm test             # Run all tests
pnpm test:unit        # Run unit tests
pnpm test:e2e         # Run E2E tests
```

### Adding New Dependencies

```bash
# Add to a specific package
pnpm --filter web add react-router-dom
pnpm --filter db add drizzle-orm

# Add shared dependency (hoisted to root)
pnpm add -D typescript biome
```

### Verification

To verify the monorepo setup works correctly:

```bash
# Test pnpm install
pnpm install

# Check workspace structure
pnpm ls --depth -1

# Test TypeScript compilation
pnpm type-check
```

---

## Implementation Status

- ✅ **Story 1.1**: Monorepo structure with pnpm workspaces - **IN PROGRESS**
- ⏳ **Story 1.2**: TanStack Start frontend initialization - Pending
- ⏳ **Story 1.3**: Database schema for income/expense entities - Pending
- ⏳ **Story 1.4**: Implement income source CRUD operations - Pending

See `_bmad-output/implementation-artifacts/sprint-status.yaml` for complete sprint tracking.
