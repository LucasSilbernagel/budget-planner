# Budget Planner

Budget Planner is a privacy-first personal budgeting and financial-planning web app.
It helps you track income and expenses, set savings goals, monitor account balances, and model long-term outcomes like retirement and net worth.
The free tier runs entirely in your browser with no account and no server calls, so your financial data never leaves your device.
The paid tier adds authenticated, EU-hosted multi-device sync.

> **Note:** This project is not yet deployed to production, so there is no live demo link yet.

## Features

- **Income and expense tracking** with frequency-normalized budgeting (weekly, monthly, annual, and more collapsed to a common basis).
- **Net period income and savings capacity** calculations, including maximum dynamically allocable savings.
- **Retirement modeler** using a safe-withdrawal model, plus a forward-looking **net-worth projection** with compounding.
- **Savings goals and balance tracking** with clear progress visualizations.
- **Currency control** that formats amounts using the selected currency's regional default.
- **Premium-gated dark mode** and **advanced forecasting**, surfaced in a discoverable locked state for free users.
- **Progressive Web App (PWA)** support with offline shell caching and installability.
- **Multi-device sync** for paid users, backed by EU-hosted PostgreSQL.
- **In-app documentation** and an **in-app contact form**.

## Tech Stack

- **Framework:** TanStack Start (SSR with file-based routing).
- **UI:** React 19, Tailwind CSS.
- **State:** Zustand.
- **Charts:** Recharts.
- **Language:** TypeScript.
- **Database:** Drizzle ORM with PostgreSQL.
- **Tooling:** Biome (lint/format), Vitest (unit), Playwright (end-to-end), MSW (network mocking).
- **Monorepo:** pnpm workspaces.

## Getting Started

### Prerequisites

- **Node.js 20.12+** (the repository pins Node 20 via `.nvmrc`).
- **pnpm**.
- **PostgreSQL** is only needed for the paid/server-sync path and the database scripts; the free tier is fully client-side and needs no database.

### Installation

1. Clone the repository:

```bash
git clone https://github.com/LucasSilbernagel/budget-planner.git
cd budget-planner
```

2. Install dependencies:

```bash
pnpm install
```

3. Set up environment variables.
   Copy `apps/web/.env.example` to `apps/web/.env` and fill in values as needed (see [Environment Variables](#environment-variables) below).
   The free-tier app runs without any of these set.

4. Start the development server:

```bash
pnpm dev
```

5. Open [http://localhost:5173](http://localhost:5173) in your browser.

### Environment Variables

All variables are optional in development; the app falls back to safe defaults and the free tier needs none of them.
A full production or paid-tier deployment additionally requires the server secrets below (session signing, magic-link email, and Paddle billing), all validated in `packages/config/src/schema.ts`.

| Variable | Scope | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Server | PostgreSQL connection string. A local instance in development; DanubeData PostgreSQL (EU) in production. Only needed for the paid/server-sync path. |
| `SESSION_SECRET` | Server | HMAC-SHA256 key for signed session cookies. **Required in production** - authentication fails closed if it is missing or shorter than 32 characters. Generate with `openssl rand -hex 32`. In development it may be omitted (an insecure fallback is used with a warning). |
| `SITE_URL` | Server | Public HTTPS origin of the deployed app. **Required in production** - it fails closed if the value is missing, `localhost`, or non-HTTPS, because magic-link emails build absolute links from it. Defaults to `http://localhost:5173` in development. |
| `EMAIL_API_KEY` | Server | API key for the EU transactional-email provider (Brevo) that sends magic-link login emails. Required in production for the paid tier - the mailer fails closed outside development. A runtime secret; never commit it. |
| `EMAIL_FROM` | Server | Verified sender address for magic-link emails. Defaults to `no-reply@budgetplanner.eu`. |
| `PADDLE_ENVIRONMENT` | Server | Selects the Paddle billing environment, `sandbox` or `production`. Defaults to `sandbox`. |
| `PADDLE_API_KEY` | Server | Paddle billing API key for the paid tier. A runtime secret. |
| `PADDLE_WEBHOOK_SECRET` | Server | Secret used to verify Paddle billing webhook signatures. A runtime secret. |
| `VITE_ETHICALADS_PUBLISHER_ID` | Client | Public identifier that ships in the client bundle, not a secret. Enables privacy-respecting, cookie-free ads for non-premium users. When unset, no ads are rendered. |
| `VITE_FORMSPARK_FORM_ID` | Client | Public identifier for the in-app contact form, not a secret. When unset, the contact form shows "temporarily unavailable." |

The Paddle billing variables back the paid-tier checkout and are being finalized in the billing integration work (story 5-3); the full set is defined in `packages/config/src/schema.ts`.

## Available Scripts

Run these from the repository root unless noted otherwise.

- `pnpm dev` - Start the web app in development (alias for `pnpm --filter web dev`) on port 5173.
- `pnpm build` - Build the web app for production.
- `pnpm --filter web start` - Serve the production build (runs `node server-entry.mjs`); see [Deployment](#deployment-and-data-sovereignty).
- `pnpm lint` - Run Biome checks and validate the TypeScript project references.
- `pnpm lint:fix` - Apply Biome autofixes.
- `pnpm format` - Format the codebase with Biome.
- `pnpm type-check` - Type-check the web app.
- `pnpm type-check:all` - Type-check every workspace package.
- `pnpm test` / `pnpm test:unit` - Run the unit test suites across packages (Vitest).
- `pnpm test:watch` - Run unit tests in watch mode.
- `pnpm test:e2e` - Run the end-to-end tests (Playwright).

Database scripts live in the `packages/db` workspace:

- `pnpm --filter db db:generate` - Generate Drizzle migrations from the schema.
- `pnpm --filter db db:migrate` - Apply pending migrations.
- `pnpm --filter db db:studio` - Open Drizzle Studio.

## Deployment and Data Sovereignty

The app builds to a single TanStack Start SSR server.
`pnpm build` emits `dist/server/server.js` (a web-standard fetch handler) and the `dist/client/` assets.
`pnpm --filter web start` then runs `node server-entry.mjs`, a thin self-listening `node:http` wrapper that binds `$PORT` (default 8080), serves `dist/client/`, and delegates SSR and `/api/*` to the built handler.

The intended production topology (see `_bmad-output/planning-artifacts/adr/ADR-001-danubedata-full-stack-migration.md`) is:

- **App server:** DanubeData Rapids SSR (Falkenstein, Germany / EU).
- **Database:** DanubeData PostgreSQL (Germany / EU).
- **Billing:** Paddle (UK, acting as Merchant of Record) - Paddle handles billing only, not authentication.
- **Authentication:** app-owned email magic-link login.
- **Ads:** EthicalAds (Germany / EU), cookie-free, non-premium users only.

The data model is EU-only with a zero-US-residency posture.
The free tier stores everything client-side (localStorage / IndexedDB) with no account and no server calls.
The paid tier syncs data to the EU-hosted PostgreSQL database behind authenticated sessions.

There is one documented exception to the zero-US-residency rule: the in-app contact form uses Formspark, which stores submissions in Ireland (EU) but relies on a US-owned cloud subprocessor (AWS), leaving it exposed to the US CLOUD Act.
It only ever transmits free-text feedback (never financial data), and the exception is recorded in `_bmad-output/planning-artifacts/adr/ADR-004-contact-form-formspark-exception.md`.

## Project Structure

```
budget-planner/
├── apps/
│   └── web/                 # TanStack Start SSR app (frontend + /api/* server routes)
│       └── src/
│           ├── routes/      # File-based routes (pages and /api server routes)
│           ├── components/
│           ├── server/      # Server-side API handlers
│           └── stores/      # Zustand stores
├── packages/
│   ├── core/                # Shared finance, calculation, format, and sync utilities (@budget-planner/core)
│   ├── db/                  # Drizzle schema, migrations, and PostgreSQL client (@budget-planner/db)
│   └── config/              # Zod-validated configuration (@budget-planner/config)
├── _bmad-output/            # Planning and implementation artifacts (BMAD)
├── pnpm-workspace.yaml
└── package.json
```

## License

Copyright (c) 2026 Lucas Silbernagel. All rights reserved.

The source is published for portfolio and demonstration purposes only.
You are welcome to read the code, but no permission is granted to copy, modify, redistribute, or deploy it.
See the [LICENSE](./LICENSE) file for the full terms.

## Contact

For questions, feedback, or feature requests:

- Use the in-app contact form at the `/contact` route.
- Open an issue on [GitHub](https://github.com/LucasSilbernagel/budget-planner/issues).
