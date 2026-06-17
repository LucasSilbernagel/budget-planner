# BMAD Method Setup Guide for Budget Planner

> **🎯 Your Project:** Budget Planner  
> **📁 Location:** `/Users/lucassilbernagel/Documents/development/side-projects/budget-planner/`  
> **📊 Status:** Ready for BMAD installation

---

## ✅ What I've Set Up for You

### Project Structure Created
```
budget-planner/
├── README.md                    # Project overview and quick start
├── product-document.md         # Template for your product document
├── setup-bmad.sh               # Automated setup script
├── .gitignore                  # Git ignore rules
└── BMAD-SETUP-GUIDE.md         # This comprehensive guide
```

### Files Ready for Your Input
1. **`product-document.md`** - Replace the template with your actual product document
2. **`README.md`** - Already customized for your budget-planner project

---

## 🚀 Installation Steps

### Step 1: Upgrade Node.js (Required)

**Current:** Node.js v16.16.0  
**Required:** Node.js 20.12+

**Options:**

**Option A: Using nvm (Recommended)**
```bash
# Install nvm if you don't have it
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Restart your terminal, then:
nvm install 20
nvm use 20
```

**Option B: Direct Download**
1. Download from [https://nodejs.org/](https://nodejs.org/)
2. Install the LTS version (v20.x or higher)
3. Verify: `node --version`

**Verify:**
```bash
node --version  # Should show v20.x.x or higher
```

### Step 2: Install BMAD Method

**Method A: Using the setup script**
```bash
cd /Users/lucassilbernagel/Documents/development/side-projects/budget-planner
./setup-bmad.sh
```

**Method B: Manual installation**
```bash
cd /Users/lucassilbernagel/Documents/development/side-projects/budget-planner
npx bmad-method install
```

**During installation, you'll be prompted to:**
1. Confirm installation directory (accept default)
2. Select modules → **Check "BMad Method" (bmm)**
3. Select AI tools → Choose your IDE (Claude Code, Cursor, etc.)
4. Configure module settings → Accept defaults or customize

### Step 3: Add Your Product Document

Replace the content in `product-document.md` with your detailed product document.

**Recommended structure:**
- Executive Summary
- Problem Statement
- Solution Overview
- Target Users
- Feature Requirements
- Success Metrics
- Competitive Analysis

---

## 🎯 Recommended BMAD Workflow for Your Project

Since you have a **detailed product document**, here's the optimal path:

### 🔍 Phase 1: Analysis (Choose ONE)

| Option | Workflow | When to Use | Output |
|--------|----------|-------------|--------|
| **A** | `bmad-product-brief` | You want a quick, collaborative summary | 1-2 page product brief |
| **B** | `bmad-prfaq` | You want rigorous validation (Amazon-style) | Press release + FAQ answers |
| **C** | Skip to Phase 2 | You're confident and ready for PRD | None |

**My Recommendation:** Start with `bmad-product-brief` since you already have a detailed document. This will efficiently extract and structure the key information.

### 📋 Phase 2: Planning (Required)

```bash
bmad-prd Create
```

**What happens:**
- The workflow will ask for your intent (Create/Update/Validate)
- Choose **Create**
- Provide your product document as context
- The agent will synthesize it into a comprehensive PRD
- Output: `_bmad-output/planning-artifacts/PRD.md`

### 🏗️ Phase 3: Solutioning

```bash
# 1. Create Architecture
bmad-create-architecture

# 2. Create Epics and Stories  
bmad-create-epics-and-stories

# 3. Validate readiness
bmad-check-implementation-readiness
```

### 💻 Phase 4: Implementation

```bash
# Initialize sprint planning
bmad-sprint-planning

# For each story:
bmad-create-story      # Create the story file
bmad-dev-story        # Implement the story
bmad-code-review      # Review the code (recommended)
```

---

## 💡 How to Use Your Product Document with BMAD

### Option 1: Product Brief Workflow (Recommended)

```bash
# In your AI IDE, invoke:
bmad-product-brief
```

**What to say:**
> "I have a detailed product document for a budget planner. Please help me create a product brief from it."

**What happens:**
- The Analyst agent will read your `product-document.md`
- Guide you through a structured discovery
- Extract key insights
- Create a product brief that feeds into PRD

### Option 2: Direct to PRD

```bash
# In your AI IDE, invoke:
bmad-prd Create
```

**What to say:**
> "I have a product document at `/product-document.md`. Please use it as the basis for creating our PRD."

**What happens:**
- The workflow will incorporate your document
- Ask clarifying questions about gaps
- Create a comprehensive PRD

### Option 3: Reference in Project Context

After BMAD installation, you can add your document as a reference:

1. Create or edit `_bmad-output/project-context.md`
2. Add a section like:
   ```markdown
   ## Knowledge Sources
   - Product Document: ./product-document.md
   ```

This makes it available to all agents throughout the project.

---

## 🎓 BMAD Method Overview

### The Four Phases

| Phase | Name | Purpose | Your Status |
|-------|------|---------|-------------|
| 1 | **Analysis** | Ideation, research, concept validation | ⏳ Pending |
| 2 | **Planning** | Create requirements (PRD) | ⏳ Pending |
| 3 | **Solutioning** | Design architecture, create epics/stories | ⏳ Pending |
| 4 | **Implementation** | Build story by story | ⏳ Pending |

### The Three Tracks

| Track | Best For | Your Fit |
|-------|----------|----------|
| **Quick Flow** | Bug fixes, simple features (1-15 stories) | ❌ Not recommended |
| **BMad Method** | Products, platforms (10-50+ stories) | ✅ **Recommended** |
| **Enterprise** | Compliance, multi-tenant (30+ stories) | ⚠️ Only if very complex |

---

## 🔧 Key BMAD Commands Reference

### Navigation & Help
| Command | Purpose |
|---------|---------|
| `bmad-help` | Your intelligent guide - ask anything |
| `bmad-help what should I do first?` | Get personalized next steps |

### Analysis Phase
| Command | Purpose |
|---------|---------|
| `bmad-brainstorming` | Guided ideation session |
| `bmad-market-research` | Market research |
| `bmad-domain-research` | Domain research |
| `bmad-technical-research` | Technical research |
| `bmad-product-brief` | Create product brief |
| `bmad-prfaq` | Working Backwards challenge |

### Planning Phase
| Command | Purpose |
|---------|---------|
| `bmad-prd` | Create/Update/Validate PRD |
| `bmad-prd Create` | Create new PRD |
| `bmad-prd Update` | Update existing PRD |
| `bmad-prd Validate` | Validate PRD |

### Solutioning Phase
| Command | Purpose |
|---------|---------|
| `bmad-create-architecture` | Create architecture document |
| `bmad-create-epics-and-stories` | Break PRD into epics and stories |
| `bmad-check-implementation-readiness` | Validate planning cohesion |

### Implementation Phase
| Command | Purpose |
|---------|---------|
| `bmad-sprint-planning` | Initialize sprint tracking |
| `bmad-create-story` | Create story from epic |
| `bmad-dev-story` | Implement a story |
| `bmad-code-review` | Code review workflow |
| `bmad-retrospective` | Epic retrospective |

---

## 📊 What Your Project Will Look Like After BMAD Installation

```
budget-planner/
├── _bmad/                          # BMAD Configuration
│   ├── core/                       # Core BMAD framework
│   │   ├── agents/                 # Agent definitions
│   │   ├── workflows/              # Workflow templates
│   │   └── ...
│   ├── bmm/                        # BMad Method module
│   │   ├── agents/
│   │   ├── workflows/
│   │   └── ...
│   └── config.toml                 # Configuration
│
├── _bmad-output/                   # Generated Artifacts
│   ├── planning-artifacts/
│   │   ├── PRD.md                  # Product Requirements Document
│   │   ├── architecture.md         # Technical Architecture
│   │   ├── addendum.md             # Additional requirements
│   │   ├── decision-log.md         # Decision log
│   │   └── epics/                  # Epic and story files
│   │       ├── epic-1.md
│   │       ├── epic-2.md
│   │       └── ...
│   ├── implementation-artifacts/
│   │   └── sprint-status.yaml      # Sprint tracking
│   └── project-context.md          # Implementation rules
│
├── product-document.md            # Your product document
├── README.md
├── setup-bmad.sh
└── .gitignore
```

---

## ⚠️ Important Notes

### 1. Always Use Fresh Chats
Each BMAD workflow should run in a **fresh chat** to prevent context limitations.

### 2. Workflow Order Matters
- Analysis → Planning → Solutioning → Implementation
- Within each phase, follow the recommended order

### 3. BMAD-Help is Your Friend
Whenever you're unsure, invoke:
```
bmad-help
```
Or ask a specific question:
```
bmad-help I have a product document. What workflow should I use?
```

### 4. Node.js Requirement
BMAD **requires** Node.js 20.12+. The current system has v16.16.0, which will cause installation failures.

---

## 🎯 Next Actions for You

### Immediate (Do Now)
1. ✅ Project folder created
2. ⏳ **Upgrade Node.js to 20.12+**
3. ⏳ Add your product document to `product-document.md`
4. ⏳ Run `./setup-bmad.sh` or `npx bmad-method install`

### After BMAD Installation
5. ⏳ Run `bmad-product-brief` (recommended first step)
6. ⏳ Then run `bmad-prd Create`
7. ⏳ Follow the guided workflows

---

## 🔗 Resources

### Official Documentation
- [BMAD Method Home](https://docs.bmad-method.org/)
- [Getting Started](https://docs.bmad-method.org/tutorials/getting-started/)
- [Workflow Map](https://docs.bmad-method.org/reference/workflow-map/)
- [Installation Guide](https://docs.bmad-method.org/how-to/install-bmad/)

### Community
- [Discord Server](https://discord.gg/gk8jAdXWmj) - Get help from the community
- [GitHub Repository](https://github.com/bmad-code-org/BMAD-METHOD)
- [YouTube Channel](https://www.youtube.com/@BMadCode)

### Modules & Extensions
- [BMad Builder](https://bmad-builder-docs.bmad-method.org/) - Build custom modules
- [Creative Intelligence Suite](https://cis-docs.bmad-method.org/)
- [Game Dev Studio](https://game-dev-studio-docs.bmad-method.org/)

---

## 💬 Frequently Asked Questions

### Q: Do I need to do all analysis workflows?
**A:** No, all Phase 1 workflows are optional. With your detailed product document, you could go directly to `bmad-prd`. However, `bmad-product-brief` is recommended to efficiently extract and structure your existing information.

### Q: Can I change my plan later?
**A:** Yes! Use `bmad-correct-course` workflow to handle scope changes mid-implementation.

### Q: What if I want to brainstorm first?
**A:** Run `bmad-brainstorming` before starting your PRD. Invoke the Analyst agent first: `bmad-agent-analyst`

### Q: How long does each workflow take?
**A:** It varies, but typically:
- Product Brief: 30-60 minutes
- PRD Creation: 60-120 minutes
- Architecture: 60-90 minutes
- Each story: 15-60 minutes

### Q: Can I use BMAD with GitHub Copilot or other AI tools?
**A:** BMAD works with any AI coding assistant that supports custom system prompts. Officially supported tools include Claude Code, Cursor, and Codex CLI. Check [the tools list](https://docs.bmad-method.org/how-to/install-bmad/#flag-reference) for updates.

---

## 📞 Need Help?

1. **Check this guide** - Most questions are answered here
2. **Use `bmad-help`** - After installation, it's your intelligent guide
3. **Join Discord** - [https://discord.gg/gk8jAdXWmj](https://discord.gg/gk8jAdXWmj)
4. **Ask me** - I'm here to help with your BMAD journey!

---

**🎉 You're ready to start!**

The project structure is set up. Once you:
1. Upgrade Node.js to 20.12+
2. Install BMAD Method
3. Add your product document

...you'll be ready to begin the BMAD workflow with `bmad-product-brief` or `bmad-prd Create`.

**Pro Tip:** Start with `bmad-help` after installation - it will inspect your project and tell you exactly what to do next!
