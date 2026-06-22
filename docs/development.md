# Development Setup Guide

This guide covers setting up your local development environment for the Budget Planner application.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- [pnpm](https://pnpm.io/) (package manager)
- [PostgreSQL](https://www.postgresql.org/) 15.x (for server-side features)
- [Git](https://git-scm.com/)

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd budget-planner
```

### 2. Install Dependencies

```bash
# Install all dependencies
pnpm install

# Build all packages
pnpm build
```

### 3. Set Up PostgreSQL

**Option A: Docker (Recommended for Cross-Platform)**

```bash
# Run PostgreSQL 15 container
# Replace YOUR_POSTGRES_PASSWORD with a strong password
docker run --name budget-planner-db \
  -e POSTGRES_PASSWORD=YOUR_POSTGRES_PASSWORD \
  -e POSTGRES_USER=budget-planner-user \
  -e POSTGRES_DB=budget-planner-dev \
  -p 5432:5432 -d postgres:15

# Verify it's running
docker ps
```

**Option B: Homebrew (macOS)**

```bash
# Install PostgreSQL
brew install postgresql@15
brew services start postgresql@15

# Create database and user
createuser -P budget-planner-user
createdb -O budget-planner-user budget-planner-dev
```

**Option C: Native Installation (Linux/Ubuntu/Debian)**

```bash
# Install PostgreSQL
sudo apt update
sudo apt install postgresql-15

# Create user and database
sudo -u postgres createuser -P budget-planner-user
sudo -u postgres createdb -O budget-planner-user budget-planner-dev
```

**Verify Installation**

```bash
# Check PostgreSQL version
psql --version

# Connect to the database
psql -h localhost -U budget-planner-user -d budget-planner-dev -c "SELECT 1"
```

### 4. Configure Environment Variables

Copy the example environment file:

```bash
cp apps/web/.env.example apps/web/.env
```

Edit `apps/web/.env` and update the `DATABASE_URL` with your actual password:

```
DATABASE_URL=postgresql://budget-planner-user:CHANGE_ME_TO_YOUR_PASSWORD@localhost:5432/budget-planner-dev
NODE_ENV=development
```

**⚠️ IMPORTANT:** Always replace `CHANGE_ME_TO_YOUR_PASSWORD` with your actual PostgreSQL password. Never commit this file to version control.

For database migrations, also configure `packages/db/.env`:

```
DATABASE_URL=postgresql://budget-planner-user:CHANGE_ME_TO_YOUR_PASSWORD@localhost:5432/budget-planner-dev
```

**Important:** Never commit `.env` files to git (they're in `.gitignore`).

### 5. Apply Database Migrations

```bash
# Navigate to db package
cd packages/db

# Apply migrations to local database
DATABASE_URL=postgresql://budget-planner-user:CHANGE_ME_TO_YOUR_PASSWORD@localhost:5432/budget-planner-dev pnpm db:migrate

# Or manually apply SQL files
psql -h localhost -U budget-planner-user -d budget-planner-dev -f migrations/0000_rare_johnny_storm.sql
psql -h localhost -U budget-planner-user -d budget-planner-dev -f migrations/0001_add_rate_limits_table.sql
```

**Note:** If you're using Homebrew PostgreSQL, you may need to use the full path to psql:
```bash
/opt/homebrew/opt/postgresql@15/bin/psql -h localhost -U budget-planner-user -d budget-planner-dev -f migrations/0000_rare_johnny_storm.sql
```

### 6. Verify Database Setup

```bash
# Connect and list tables
psql -h localhost -U budget-planner-user -d budget-planner-dev -c "\dt"

# Expected output:
#                    List of relations
#  Schema |      Name       | Type  |        Owner
# --------+-----------------+-------+---------------------
#  public | balanceTracking | table | budget-planner-user
#  public | expenses        | table | budget-planner-user
#  public | incomeSources   | table | budget-planner-user
#  public | rateLimits      | table | budget-planner-user
#  public | savingsGoals    | table | budget-planner-user
#  public | userProfiles    | table | budget-planner-user
#  public | users           | table | budget-planner-user
```

### 7. Run the Development Server

```bash
# Start the TanStack Start development server
cd apps/web
pnpm dev

# The application should be available at http://localhost:5173
```

## Development Workflow

### Free Tier Features (Client-Side Only)

These features work entirely in the browser without a database connection:
- Income and expense tracking (stored in localStorage)
- Savings goals management
- Balance tracking
- Frequency normalization calculations
- Basic visualizations

### Paid Tier Features (Server-Side)

These features require the PostgreSQL database:
- User authentication via Paddle
- Multi-device data synchronization
- Server-side persistence
- Premium forecasting
- Custom user profiles

**Note:** For local development of paid tier features, use your local PostgreSQL database. For production, the application will use DanubeData PostgreSQL (Germany - EU) per [ADR-001](./planning-artifacts/adr/ADR-001-danubedata-full-stack-migration.md).

### Database Seeding (Optional)

To seed your local database with test data:

```bash
# Create a seed script (packages/db/scripts/seed.ts)
# Then run:
cd packages/db
DATABASE_URL=postgresql://budget-planner-user:CHANGE_ME_TO_YOUR_PASSWORD@localhost:5432/budget-planner-dev pnpm exec tsx scripts/seed.ts
```

## Common Commands

### Database Operations

```bash
# Start PostgreSQL (Docker)
docker start budget-planner-db

# Stop PostgreSQL (Docker)
docker stop budget-planner-db

# Connect to database
psql -h localhost -U budget-planner-user -d budget-planner-dev

# List all tables
psql -h localhost -U budget-planner-user -d budget-planner-dev -c "\dt"

# Run a SQL file
psql -h localhost -U budget-planner-user -d budget-planner-dev -f path/to/file.sql

# Reset database (⚠️ DANGER: deletes ALL data - NEVER run on production!)
# This command will IRRECOVERABLY DELETE all tables and data
psql -h localhost -U budget-planner-user -d budget-planner-dev -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

### Package Management

```bash
# Install dependencies
pnpm install

# Add a dependency to a specific package
pnpm add <package> --filter <package-name>

# Build all packages
pnpm build

# Run tests
pnpm test

# Run linting
pnpm lint
```

### Application

```bash
# Start development server
pnpm --filter web dev

# Build for production
pnpm --filter web build

# Start production server
pnpm --filter web start
```

## Troubleshooting

### PostgreSQL Connection Issues

**Problem:** `psql: error: connection to server at "localhost" (::1), port 5432 failed: Connection refused`

**Solution:**
1. Check if PostgreSQL is running:
   ```bash
   # Docker
   docker ps
   
   # Homebrew
   brew services list
   
   # Native
   sudo systemctl status postgresql
   ```

2. If not running, start it:
   ```bash
   # Docker
   docker start budget-planner-db
   
   # Homebrew
   brew services start postgresql@15
   
   # Native
   sudo systemctl start postgresql
   ```

3. Verify PostgreSQL is listening on port 5432:
   ```bash
   lsof -i :5432
   # or
   netstat -tuln | grep 5432
   ```

**Problem:** `password authentication failed for user "budget-planner-user"`

**Solution:**
1. Verify the password you're using matches what you set during user creation
2. Try connecting without a password first to verify the user exists:
   ```bash
   psql -h localhost -U postgres -d postgres
   ```
3. Then check the user:
   ```sql
   SELECT * FROM pg_user WHERE usename = 'budget-planner-user';
   ```

### Module Not Found Errors

**Problem:** `Cannot find module 'pg'` or similar

**Solution:**
1. Ensure you've installed dependencies:
   ```bash
   pnpm install
   ```
2. If using Node.js directly (not through pnpm), install pg globally:
   ```bash
   npm install -g pg
   ```
3. Or use pnpm exec to run commands in the correct context:
   ```bash
   pnpm --filter db exec node your-script.js
   ```

### TypeScript Compilation Errors

**Problem:** TypeScript errors when building

**Solution:**
1. Check the root tsconfig.json for errors
2. Run type checking to see specific errors:
   ```bash
   pnpm type-check
   ```
3. Ensure all dependencies are installed:
   ```bash
   pnpm install
   ```

### Database Migration Issues

**Problem:** Migrations fail because tables already exist

**Solution:**
1. Check which migrations have been applied:
   ```bash
   psql -h localhost -U budget-planner-user -d budget-planner-dev -c "SELECT * FROM drizzle_migrations;"
   ```
2. If the migration table doesn't exist, the migrations haven't been applied yet
3. If you need to reset, drop all tables and reapply:
   ```bash
   psql -h localhost -U budget-planner-user -d budget-planner-dev -f migrations/reset.sql
   ```

## Architecture Overview

### Project Structure

```
budget-planner/
├── apps/
│   └── web/                   # TanStack Start application (SSR, Streaming)
│       ├── src/              # Source code
│       ├── public/           # Static assets
│       └── .env              # Environment variables
├── packages/
│   ├── db/                   # Database schema and ORM (Drizzle)
│   │   ├── src/              # Database client, schema, migrations
│   │   └── .env              # Database-specific env vars
│   └── config/               # Centralized configuration
└── docs/                     # Documentation
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | TanStack Start | SSR, Streaming, File-based routing |
| React | React 19 | UI components |
| Styling | Tailwind CSS | Utility-first styling |
| State Management | Zustand | Transient UI state |
| Backend | TanStack Start Server Functions | RPC-style API |
| Database | PostgreSQL 15.x | Data persistence |
| ORM | Drizzle ORM | TypeScript-first database access |
| Package Manager | pnpm | Workspaces, dependency management |
| Testing | Vitest, MSW, Playwright | Unit, mock, E2E testing |
| Linting | Biome | Code quality enforcement |

### Database Schema

The application uses the following tables:

- **users** - User accounts with authentication information
- **incomeSources** - Income sources (salary, freelance, etc.)
- **expenses** - Expense tracking
- **savingsGoals** - Savings targets and progress
- **balanceTracking** - Investment and debt tracking
- **userProfiles** - Custom user profiles (paid tier)
- **rateLimits** - API rate limiting (added recently)

### Environment Configuration

The application uses different databases for development and production:

**Development:**
- Local PostgreSQL on localhost:5432
- Zero infrastructure costs
- Full offline capability

**Production:**
- DanubeData PostgreSQL (Germany - EU)
- Ensures CLOUD Act immunity (NFR1, NFR2)
- Internal DNS with ~0.4ms latency

The only difference between environments is the `DATABASE_URL` connection string.

## Data Sovereignty & Compliance

This project enforces strict data sovereignty requirements:

- **NFR1: Zero US Data Residency** - All data must remain in EU
- **NFR2: EU-Based Hosting** - All providers must be EU-incorporated with EU data centers

**Development:** Local PostgreSQL keeps all data on your machine (satisfies NFR1, NFR2)

**Production:** DanubeData PostgreSQL in Falkenstein, Germany (satisfies NFR1, NFR2)

**Important:** Never use US-based database providers (AWS RDS, Firebase, Supabase US region, etc.) for this project.

## Additional Resources

- [Project Context](../_bmad-output/project-context.md) - Critical rules and patterns
- [Architecture Decision Document](../_bmad-output/planning-artifacts/architecture.md) - Technical architecture
- [ADR-001: DanubeData Full Stack Migration](../_bmad-output/planning-artifacts/adr/ADR-001-danubedata-full-stack-migration.md) - Infrastructure decisions
- [Epic 5: Production Deployment & Infrastructure](../_bmad-output/planning-artifacts/epics.md#epic-5-production-deployment--infrastructure-danubedata-full-stack) - Current epic details
