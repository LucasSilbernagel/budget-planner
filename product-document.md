# Longhand Budget - Product Specification & Architecture Document

> **📋 Document Type:** Product Specification & Technical Architecture  
> **🎯 Purpose:** Single source of truth for Longhand Budget implementation  
> **🔒 Compliance:** Strict adherence to technical stack, architectural patterns, and privacy parameters required

---

## 📌 Table of Contents

1. [Executive Summary & Sovereignty Architecture](#1-executive-summary--sovereignty-architecture)
2. [Monorepo Technical Stack Specification](#2-monorepo-technical-stack-spec)
3. [Database Schema](#3-database-schema)
4. [Operational Requirements & Computational Logic](#4-operational-requirements--computational-logic)
5. [UI/UX & Functional Interfaces](#5-uiux--functional-interfaces)
6. [Testing, CI/CD, and Deployment Protocol](#6-testing-cicd-and-deployment-protocol)

---

## 1. Executive Summary & Sovereignty Architecture

### 🎯 Product Overview
Longhand Budget is a comprehensive financial management application designed to help users track income, expenses, savings goals, and investment balances with a focus on privacy and data sovereignty.

### 💰 Tier Structure

| Tier | Features | Data Storage | Authentication |
|------|----------|--------------|----------------|
| **Free Tier** | Core budget tracking, local calculations | Client-side only (localStorage / IndexedDB) | ❌ Not required |
| **Paid Tier** | Multi-device sync, custom profiles, premium forecasting | Server-side (DanubeData PostgreSQL) | ✅ Required |

### 🛡️ Privacy & Legal Architecture

#### Hosting & Compute
- **Requirement:** All services, servers, and databases must be hosted on **DanubeData**
- **Location:** European data centers (Germany)
- **Purpose:** Full immunity from the US CLOUD Act
- **Compliance:** US-sovereignty avoidance

#### Payment Processing
- **Merchant:** Paddle (UK-headquartered Merchant of Record)
- **Capabilities:**
  - Global billing
  - Custom discount code distribution
  - Automated local tax/VAT remittances

#### Advertising
- **None.** The app shows no ads and embeds no third-party trackers, for every visitor on every tier (Story 25.1 removed the former EthicalAds integration; reverses FR20 / Story 4.11).

---

## 2. Monorepo Technical Stack Spec

### 🏗️ Project Organization

```
budget-planner/
├── apps/
│   └── web/                 # TanStack Start App (Frontend & Server Functions)
├── packages/
│   ├── db/                  # Drizzle Schema, migrations, DanubeData DB client
│   └── config/              # Centralized Biome, Tailwind, TypeScript configs
├── pnpm-workspace.yaml
└── package.json
```

### 🎨 Frontend Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Framework** | TanStack Start | SSR, Streaming, File-based routing |
| **React** | React 19 | Component library |
| **TypeScript** | Latest | Type safety |
| **Components** | Radix UI Primitives | Accessible UI primitives |
| **Styling** | Tailwind CSS | Utility-first CSS with design tokens |
| **State Management** | Zustand | Transient UI state, client-side caching, config defaults, computational sync |
| **Linting** | Biome | Code quality with unicorn metrics |
| **Accessibility** | eslint-plugin-jsx-a11y | Strict a11y validation |

### 🗄️ Backend Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Server Layer** | TanStack Start Server Functions | RPC-style communication |
| **API Layer** | Lightweight TypeScript service | Authenticated state syncing |
| **Runtime** | Node.js / Bun | Fast execution |
| **Database** | PostgreSQL | Relational data storage |
| **Hosting** | DanubeData | European data centers |
| **ORM** | Drizzle ORM | TypeScript-first, lightweight SQL generation |

---

## 3. Database Schema

> **Location:** `packages/db/schema.ts`

### TypeScript Schema Definition

```typescript
import { 
  pgTable, 
  uuid, 
  varchar, 
  decimal, 
  timestamp, 
  pgEnum 
} from 'drizzle-orm/pg-core';

// Enums
export const frequencyEnum = pgEnum('frequency', [
  'weekly', 
  'biweekly', 
  'monthly', 
  'annually'
]);

export const financeTypeEnum = pgEnum('finance_type', [
  'investment', 
  'debt'
]);

// Users Table
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  paddleId: varchar('paddle_id', { length: 255 }),
  subscriptionStatus: varchar('subscription_status', { length: 50 }).default('free'),
  currency: varchar('currency', { length: 10 }).default('NONE'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Income Sources Table
export const incomeSources = pgTable('income_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // Nullable for local state parsing
  name: varchar('name', { length: 100 }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  frequency: frequencyEnum('frequency').notNull(),
});

// Expenses Table
export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  frequency: frequencyEnum('frequency').notNull(),
});

// Savings Goals Table
export const savingsGoals = pgTable('savings_goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  targetAmount: decimal('target_amount', { precision: 12, scale: 2 }).notNull(),
  currentBalance: decimal('current_balance', { precision: 12, scale: 2 }).notNull(),
});

// Balance Tracking Table
export const balanceTracking = pgTable('balance_tracking', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  type: financeTypeEnum('type').notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  currentBalance: decimal('current_balance', { precision: 12, scale: 2 }).notNull(),
  maxContributionLimit: decimal('max_contribution_limit', { precision: 12, scale: 2 }),
  monthlyContribution: decimal('monthly_contribution', { precision: 12, scale: 2 }),
});
```

### Entity Relationship Diagram

```
users (1) ----┬── (N) incomeSources
              ├── (N) expenses
              ├── (N) savingsGoals
              └── (N) balanceTracking
```

---

## 4. Operational Requirements & Computational Logic

### 📊 Frequency Normalization Engine

**Rule:** Every calculation must convert values to a standardized period base before cross-aggregating.

#### Normalization Factors

| Frequency | Symbol | To Monthly Formula | Factor |
|-----------|--------|---------------------|--------|
| Weekly | W | M = W × (52/12) | 4.333 |
| Biweekly | B | M = B × (26/12) | 2.167 |
| Monthly | M | M = M | 1 |
| Annually | A | M = A / 12 | 0.083 |

**Formula:**
```
Normalized Monthly Value = Raw Value × Frequency Factor
```

### 🧮 Core Metrics & Formulations

#### Net Period Income
```
Net Period Income = ∑(Income_normalized) - ∑(Expenses_normalized)
```

#### Savings Capacity Percentage
```
Savings Capacity % = (∑(Income_normalized) - Net Period Income) × 100
```

#### Maximum Dynamically Allocable Savings
- **Definition:** Real-time calculation of remaining liquidity
- **Purpose:** Display available funds to distribute across active target goals
- **Constraint:** Must not dip below zero

### 🎯 Algorithmic Retirement Modeler

**Objective:** Determine the exact point where accrued investment assets can safely yield the user's desired retirement income.

#### Input Parameters
- **FV:** Future Value of assets (target)
- **Ir:** Desired retirement income
- **r:** Fixed rate of return (compounded monthly)

#### Logic Rule
Calculate compounding factors natively within a utility service file, mapping asset growth timelines directly against the user's current age up to their estimated life expectancy.

#### Formula (Safe Withdrawal Model)
```
Target: FV × (r / 12) = Ir
=> FV = Ir × (12 / r)
```

---

## 5. UI/UX & Functional Interfaces

### 📈 Data Visualization
- **Library:** Recharts (lightweight interactive SVG graphs)
- **Components:**
  - Income vs. Expense category breakdown distributions
  - Forward-looking net worth compound projection paths

### 💱 Currency Control System

| Mode | Behavior | Implementation |
|------|----------|----------------|
| **Currency-less Mode** | Raw numeric entries without forced symbols | Default state |
| **Explicit Symbols** | Display with currency symbols | Uses JavaScript `Intl.NumberFormat` |

**Features:**
- Dynamic switching between modes
- Native localization engine support

### 📱 App Transparency
- **Version Display:** UI footer reads from `package.json`
- **Issue Tracking:** Integrated submission link to GitHub Repository Issue engine
- **Client Metadata:** Clean URL-string injection for tracking

### 📖 Documentation System
- **Engine:** TanStack Router
- **Format:** Lightweight static markdown routes
- **Content:** Support/Documentation and FAQ structures

---

## 6. Testing, CI/CD, and Deployment Protocol

### 🚀 Local Development Flow

#### Setup Commands

```bash
# 1. Install all monorepo dependencies
pnpm install

# 2. Spin up local DanubeData-compatible Postgres instance via Docker
docker run --name budget-db \
  -e POSTGRES_PASSWORD=local_secret \
  -p 5432:1234 \
  -d postgres

# 3. Generate and run localized database migrations
pnpm --filter db db:generate
pnpm --filter db db:migrate

# 4. Fire up the local TanStack Start development environment
pnpm --filter web dev
```

### 🧪 Testing Strategy

| Test Type | Tool | Scope | Purpose |
|-----------|------|-------|---------|
| **Unit Tests** | Vitest | Mathematical modules | Continuous structural validation |
| **Mock Testing** | Mock Service Worker (MSW) | Network requests | Intercept Paddle calls |
| **E2E Tests** | Playwright | UI interactions | Multi-currency flow simulations |

**Test Modules:**
- Retirement horizons calculations
- Compound curves validation
- Frequency normalization blocks

### ⚙️ Continuous Integration & Production Routing

#### CI/CD Pipeline (GitHub Actions)
**Required Checks for PR Deployment:**
1. ✅ `pnpm biome check` - Code quality
2. ✅ `pnpm test:unit` - Unit tests
3. ✅ `headless playwright` - E2E tests

#### Production Hosting
- **Provider:** Netlify
- **Runtime:** Static and edge operations
- **Region:** Western Europe data center lanes

---

## 📋 Implementation Priority Matrix

| Priority | Component | Dependencies |
|----------|-----------|--------------|
| **P0** | Monorepo setup with pnpm | None |
| **P0** | TanStack Start frontend | Monorepo |
| **P0** | Database schema (Drizzle) | Monorepo |
| **P1** | Frequency normalization engine | Core types |
| **P1** | Retirement modeler | Normalization |
| **P1** | UI/UX components (Radix + Tailwind) | Frontend |
| **P2** | Zustand state management | Frontend |
| **P2** | Server functions (TanStack) | Backend |
| **P2** | Currency control system | UI |
| **P3** | Testing infrastructure | Core features |
| **P3** | CI/CD pipeline | Testing |
| **P3** | Paddle integration | Paid tier |

---

## 🔗 External Dependencies

| Service | Provider | Region | Purpose |
|---------|----------|--------|---------|
| **Hosting** | DanubeData | EU (Germany) | Database & Compute |
| **Payments** | Paddle | UK | Billing & Taxes |
| **Frontend Host** | Netlify | Western Europe | Static hosting |

---

## 🎯 Success Metrics

### Technical Metrics
- ✅ All calculations pass mathematical validation tests
- ✅ 100% TypeScript type safety
- ✅ Zero US data residency
- ✅ Full CLOUD Act immunity
- ✅ Biome linter passes with unicorn rules
- ✅ Accessibility compliance (a11y)

### User Metrics
- ✅ Accurate financial projections
- ✅ Real-time sync for paid tier
- ✅ Seamless currency handling
- ✅ Intuitive UI/UX

---

## 📝 Notes for BMAD Workflows

> **For BMAD Agents:** This document provides comprehensive technical and architectural specifications. Key highlights for planning:
>
> - **Architecture:** Monorepo with pnpm workspaces
> - **Tech Stack:** TanStack Start, React 19, TypeScript, Drizzle ORM, PostgreSQL
> - **Privacy:** Client-side only for free tier, DanubeData-hosted for paid tier
> - **Compliance:** US-sovereignty avoidance (DanubeData EU, Paddle UK)
> - **Testing:** Vitest (unit), MSW (mock), Playwright (E2E)
> - **Deployment:** Netlify (frontend), DanubeData (backend)

---

**Document Version:** 1.0  
**Last Updated:** June 16, 2026