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
2. ⏳ Upgrade Node.js to 20.12+
3. ⏳ Install BMAD Method
4. ⏳ Add your product document to the folder
5. ⏳ Run `bmad-help` for personalized guidance
