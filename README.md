# Longhand Budget

**Track your finances with privacy and control.**

Longhand Budget is a privacy-first personal budgeting and financial-planning web app.
It helps you track income and expenses, set savings goals, monitor what you own and owe, and model long-term outcomes like retirement.
It is built for intentional budgeting without bank sync or AI integrations: you plan with the numbers you enter yourself, and the app never connects to your bank or any financial institution.
The free tier needs no account, and your financial data stays in your browser and is never sent anywhere.
The page itself does load a visit-counting analytics script, and the contact form posts what you type in it, so the guarantee is about your financial data specifically rather than about zero network traffic.
Premium adds authenticated, EU-hosted multi-device sync.

The product is always called Longhand Budget; the only exceptions are the shorter label under the installed app icon and the install prompt that names it.

<img width="2800" height="1800" alt="Screen Shot 2026-09-14 at 16 51 47" src="https://github.com/user-attachments/assets/bb55f631-9abd-45ee-bc83-53975db88e90" />

## Live URL

https://www.longhandbudget.com/

## Features

Longhand Budget is split into a Free tier that runs entirely on your device and a Premium tier that adds five capabilities.
There are no ads, no third-party trackers, and no AI features on either tier.

### Free

- **Income and expense tracking** with weekly, biweekly, monthly, and annual frequencies.
- **A common monthly basis** so totals are comparable.
  The conversion uses an average of about 4.33 weeks a month, so the monthly figure is an estimate.
- **Net period income and savings capacity** calculations, including maximum dynamically allocable savings.
- **Savings goals** with progress tracking.
- **Balance tracking** for investments, debts, and things you own outright.
- **Visual breakdowns** on the overview of income versus expenses, and of what you own against what you owe.
- **Retirement modeling** using a safe-withdrawal projection, with a separate post-retirement return rate.
  The planner remembers your inputs between visits and can be hidden from the Settings page if you do not want it.
- **Currency display** with locale-aware formatting, or a currency-less mode for raw numbers.
- **Dark mode.**
- **Local-first storage.**
  Your data lives in your browser and never leaves your device on the Free tier.
- **Progressive Web App (PWA)** support with offline shell caching and installability.
- **In-app documentation** and an **in-app contact form**.

### Premium

The Premium set is defined once, in code, at `apps/web/src/lib/premium/benefits.ts`.
That module is the single source of truth, and the app's surfaces derive their benefit lists from it rather than hard-coding their own.

- **Multi-device sync** so your plan follows you from phone to laptop.
  Synced data lives on servers in the European Union.
- **Custom profiles** to keep separate sets of finances, such as personal versus household.
- **Advanced forecasting**, a what-if workspace where you build a scenario from your own figures, save it to a searchable list, and reload it later.
- **Financial summary report**, a printable summary of your budget, net worth, and savings goals.
  It is assembled in your browser from the figures on your device, so nothing is sent anywhere to produce it.
- **Custom categories** for income and expenses, with the overview charts grouped by category and a per-category breakdown.
  Categories are stored on your device and are deliberately not synced.

## Pricing

- **Free:** €0, forever, no account required.
- **Premium:** €5.99 per month, €39 per year (about 46% cheaper than monthly), or €99 once for a lifetime license.
Prices are shown in euros; at checkout Paddle displays and charges the equivalent in your local currency.
Paddle acts as the authorised reseller and Merchant of Record, so it is responsible for sales tax and VAT, and receipts come from Paddle.

## Pages

The app has 20 pages.

| Route | Page | Tier |
| --- | --- | --- |
| `/` | Overview dashboard with the category and breakdown charts | Free |
| `/income` | Income sources | Free |
| `/expenses` | Expenses | Free |
| `/savings` | Savings goals | Free |
| `/balance` | Balance Tracking - investments, debts, and things owned outright | Free |
| `/retirement` | Retirement planner | Free |
| `/settings` | Currency, theme, planner visibility, local data, account | Free |
| `/forecasting` | Advanced forecasting scenario builder | Premium |
| `/profiles` | Custom profiles | Premium |
| `/financial-summary` | Financial Summary | Premium |
| `/categories` | Custom categories and per-category breakdown | Premium |
| `/login` | Sign in via emailed magic link | - |
| `/pricing` | Pricing | - |
| `/welcome` | Post-checkout thank-you page that points buyers to sign-in | - |
| `/docs`, `/docs/:docId` | In-app documentation | - |
| `/contact` | Contact form | - |
| `/privacy`, `/terms`, `/refund` | Legal pages | - |

Premium pages are reachable by every visitor and show a locked state rather than a redirect, so the benefit is discoverable before you pay.
The app also serves 17 `/api/*` routes for authentication, sync, calculations, webhooks, and health checks.

## Tech Stack

- **Framework:** TanStack Start (SSR with file-based routing).
- **UI:** React 19 and Tailwind CSS, with classes composed through `cn()` (`clsx` + `tailwind-merge`).
- **State:** Zustand.
- **Charts:** Recharts.
- **Language:** TypeScript.
- **Database:** Drizzle ORM with PostgreSQL.
- **Billing:** Paddle Billing.
- **Tooling:** Biome (lint/format, tabs), knip (unused code), Vitest (unit), Playwright (end-to-end), MSW (network mocking).
- **Monorepo:** pnpm workspaces.

Note that `apps/web` runs Vitest 3 while the root and the other packages run Vitest 1, so `pnpm test` spans two majors.

## Getting Started

### Prerequisites

- **Node.js 24.**
  The repository pins Node 24 via `.nvmrc`, and every workspace declares `engines.node: ">=24.0.0"`.
- **pnpm 10.34.3.**
  The version is pinned by the `packageManager` field in the root `package.json`, which is the single source of truth for both local installs and CI.
  `pnpm-lock.yaml` is `lockfileVersion: 9.0`, so pnpm 8 and older will fail `pnpm install --frozen-lockfile`.
  Enable corepack and the pinned version is picked up automatically.
- **PostgreSQL** is only needed for the paid/server-sync path and the database scripts; the free tier is fully client-side and needs no database.

For a fuller local setup walkthrough, including three ways to install PostgreSQL, see [docs/development.md](./docs/development.md).

### Installation

1. Clone the repository:

```bash
git clone https://github.com/LucasSilbernagel/budget-planner.git
cd budget-planner
```

The repository, the workspace name, and the `@budget-planner/*` package names all keep the project's original identifier.
Only the product name changed.

2. Install dependencies:

```bash
pnpm install
```

3. Set up environment variables.
   Copy `apps/web/.env.example` to `apps/web/.env` and fill in values as needed (see [Environment Variables](#environment-variables) below).
   The free-tier app runs without any of these set.
   The root `.env.example` is only for running database migrations (`packages/db/drizzle.config.ts` reads it).

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
| `PORT` | Server | Port the production server binds. Defaults to `8080`. |
| `APP_ENTRYPOINT` | Server | Set to `migrate` to make the container image run database migrations instead of serving the app. |
| `NODE_ENV` | Server | Standard environment flag. When it is `production`, several paths below fail closed unless their secrets are configured. |
| `SESSION_SECRET` | Server | HMAC-SHA256 key for signed session cookies. **Required in production** - authentication fails closed if it is missing or shorter than 32 characters. Generate with `openssl rand -hex 32`. In development it may be omitted (an insecure fallback is used with a warning). |
| `SITE_URL` | Server | Public HTTPS origin of the deployed app. **Required in production** - it fails closed if the value is missing, `localhost`, or non-HTTPS, because magic-link emails build absolute links from it. Defaults to `http://localhost:5173` in development. |
| `EMAIL_API_KEY` | Server | API key for the EU transactional-email provider (Brevo) that sends magic-link login emails. Required in production for the paid tier - the mailer fails closed outside development. A runtime secret; never commit it. |
| `EMAIL_FROM` | Server | Verified sender address for magic-link emails. Defaults to `hello@longhandbudget.com`, the Brevo-verified address Longhand Budget owns. |
| `PADDLE_ENVIRONMENT` | Server | Selects the Paddle billing environment, `sandbox` or `production`. Defaults to `sandbox` everywhere EXCEPT `GET /api/paddle/checkout-config`, which refuses to serve a default and 500s if this is unset. |
| `PADDLE_API_KEY` | Server | Paddle billing API key for the paid tier. A runtime secret. |
| `PADDLE_CLIENT_TOKEN` | Client-safe | Browser token for Paddle.js checkout. Not a secret — safe to expose via `/api/paddle/checkout-config`. |
| `PADDLE_WEBHOOK_SECRET` | Server | Secret used to verify Paddle billing webhook signatures. A runtime secret. |
| `PADDLE_MONTHLY_PRICE_ID` / `PADDLE_ANNUAL_PRICE_ID` / `PADDLE_LIFETIME_PRICE_ID` | Client-safe | Live Paddle price IDs for the €5.99/mo, €39/yr and €99 lifetime plans. All three are **required in production** and must differ from each other (`assertPaddleProductionConfig` throws otherwise). |
| `PADDLE_WEBHOOK_MAX_AGE_SECONDS` | Server | Webhook timestamp-freshness window, in seconds. Optional, defaults to `300`. |
| `RETENTION_SWEEP_TOKEN` | Server | Bearer token for `POST /api/internal/retention-sweep`. Must meet the same length floor as `SESSION_SECRET`; when unset or too short the endpoint refuses every call. |
| `VITE_FORMSPARK_FORM_ID` | Client | Public identifier for the in-app contact form, not a secret. When unset, the contact form shows "temporarily unavailable." |
| `VITE_COUNTERDEV_ID` | Client | Public identifier for counter.dev analytics, not a secret. When unset, no analytics script is loaded. |

The full set of Paddle price and key variables is defined in `packages/config/src/schema.ts`.

## Available Scripts

Run these from the repository root unless noted otherwise.

- `pnpm dev` - Start the web app in development (alias for `pnpm --filter web dev`) on port 5173.
- `pnpm build` - Build the web app for production.
  This builds `apps/web` only, not the other packages.
- `pnpm build:packages` - Build `packages/core`, `packages/db`, and `packages/config` with `tsc -b`.
- `pnpm --filter web start` - Serve the production build (runs `node server-entry.mjs`); see [Deployment](#deployment-and-data-sovereignty).
- `pnpm --filter web preview` - Preview the production build with Vite.
- `pnpm lint` - Run Biome, validate the tsconfig files, and check comment rules (`lint:comments`).
- `pnpm lint:fix` - Apply Biome autofixes.
- `pnpm format` - Format the codebase with Biome.
- `pnpm knip` - Report unused files, exports, and dependencies (needs a prior web build for `routeTree.gen.ts`).
- `pnpm type-check` - Type-check the web app.
- `pnpm type-check:all` - Type-check every workspace package.
- `pnpm test` / `pnpm test:unit` - Run the unit test suites (Vitest).
  Note that `packages/config` has no tests, so this covers three of the four packages.
- `pnpm test:watch` - Run unit tests in watch mode.
- `pnpm --filter web test:coverage` - Run the web unit tests with coverage.
- `pnpm test:e2e` - Run the end-to-end tests (Playwright).
- `pnpm gates` - Run every local gate (package and web builds, bundle check, type-check, Biome, unit suites, e2e) in parallel and report one verdict.
  Pass `--only <id,...>` to run a subset or `--sequential` to run one at a time; `pnpm gates --help` lists the gate ids.
- `pnpm --filter web test:e2e:install` - Install the Chromium browser Playwright needs.
- `pnpm --filter web icons:generate` - Regenerate every favicon and PWA icon from `apps/web/public/favicon.svg`.

Database scripts live in the `packages/db` workspace:

- `pnpm --filter db db:generate` - Generate Drizzle migrations from the schema.
- `( set -a; . ./.env; set +a; pnpm --filter db db:migrate:preflight && pnpm --filter db db:migrate )` - Classify the target database, then apply pending migrations. The subshell loads the root `.env`, which the preflight does not read itself. Never run `db:migrate` without the preflight in front of it; see `packages/db/migrations/README.md`.
- `pnpm --filter db db:studio` - Open Drizzle Studio.
- `pnpm --filter db db:smoke` - Check the connection to a real database. It needs `DATABASE_URL` and is not run in CI.
- `pnpm --filter db db:ca-expiry` - Fail if the pinned `DATABASE_CA_CERT` is missing, expired, or about to expire.

## Continuous Integration

`.github/workflows/ci.yml` runs on pull requests into `main`, on Node 24:

1. **Lint** - `pnpm biome check .`, `pnpm validate:tsconfig`, `pnpm lint:comments`, `scripts/validate-deploy-workflow.py`, a production web build checked by `check-client-bundle.mjs`, then `pnpm knip`.
2. **Unit tests** - Vitest, with the web suite split across two shards; no database required.
3. **E2E tests** - Playwright against Chromium, with the HTML report uploaded as an artifact.

Pushes to `main` run `.github/workflows/deploy.yml`, which calls `ci.yml` as a reusable workflow, adds a type-check of every package, and builds and deploys the container image.
The type-check does not run on pull requests, so run `pnpm type-check:all` before you push.

The other workflows:

- `container-image.yml` - On pull requests, builds the container image and runs the same size budget and serve and migrate checks as the deploy, without pushing anything.
- `screenshots.yml` - Manually dispatched; the only place screenshot baselines are generated, because CI and dev machines render fonts differently.
- `retention-sweep.yml` - Daily call to the retention-sweep endpoint.
- `ca-expiry.yml` - Weekly warning when the pinned database CA certificate is close to expiry.
- `paddle-drift.yml` - Weekly check that the Paddle.js internals the app relies on still match the CDN file.

To skip bulk-reformat commits in `git blame`, run `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

## Deployment and Data Sovereignty

The app builds to a single TanStack Start SSR server.
`pnpm build` emits `dist/server/server.js` (a web-standard fetch handler) and the `dist/client/` assets.
`pnpm --filter web start` then runs `node server-entry.mjs`, which loads `serve-entry.mjs`: a thin self-listening `node:http` wrapper that binds `$PORT` (default 8080), serves `dist/client/`, and delegates SSR and `/api/*` to the built handler.
With `APP_ENTRYPOINT=migrate`, the same entry runs `migrate-entry.mjs` instead, so one image serves the app and applies migrations.

The production topology is:

- **App server:** DanubeData Rapids SSR (Falkenstein, Germany / EU).
- **Database:** DanubeData PostgreSQL (Germany / EU).
- **Billing:** Paddle (UK, acting as Merchant of Record) - Paddle handles billing only, not authentication.
- **Authentication:** app-owned email magic-link login.
- **Ads:** none - the app shows no ads and no third-party trackers, for every tier.

The data model is EU-only with a zero-US-residency posture.
The free tier stores everything client-side (localStorage / IndexedDB) with no account and no server calls.
The paid tier syncs data to the EU-hosted PostgreSQL database behind authenticated sessions.

There are two scoped exceptions to the zero-US-residency rule:

- **Contact form.** The in-app contact form uses Formspark, which stores submissions in Ireland (EU) but relies on a US-owned cloud subprocessor (AWS), leaving it exposed to the US CLOUD Act.
  It only ever transmits free-text feedback, never financial data.
- **Analytics.** The app loads cookieless, open-source counter.dev analytics from `cdn.counter.dev`, whose hosted server location is not documented as EU-only.
  It sets no cookie, stores no persistent identifier, and builds no cross-site profile, which is why the no-tracker claim above still holds; it counts visits with a single non-identifying marker held in the browser, and carries no financial data.

Because neither exception sets a cookie or stores anything requiring consent, the app ships no cookie-consent banner.

## Project Structure

The tree below shows the load-bearing directories rather than every folder.

```
budget-planner/
├── apps/
│   └── web/                 # TanStack Start SSR app (frontend + /api/* server routes)
│       ├── e2e/             # Playwright specs
│       ├── public/          # Static assets, icons, robots.txt
│       ├── scripts/         # Build, icon, service-worker, and bundle-check scripts
│       └── src/
│           ├── routes/      # File-based routes (pages and /api server routes)
│           ├── components/  # Page and UI components
│           ├── content/     # In-app documentation and legal markdown
│           ├── lib/         # Analytics, premium benefits, sync bridge, helpers
│           ├── server/      # Server-side API handlers
│           └── stores/      # Zustand stores
├── packages/
│   ├── core/                # Shared finance, calculation, format, and sync utilities (@budget-planner/core)
│   ├── db/                  # Drizzle schema, migrations, and PostgreSQL client (@budget-planner/db)
│   └── config/              # Zod-validated configuration (@budget-planner/config)
├── biome-plugins/           # Custom Biome lint rules (GritQL)
├── docs/                    # Contributor documentation
├── scripts/                 # Repo tooling: tsconfig, comment, and deploy-workflow validators
├── .github/workflows/       # CI, deploy, and scheduled checks
├── pnpm-workspace.yaml
└── package.json
```

## License

Copyright (c) 2026 Lucas Silbernagel.
All rights reserved.

The source is published for portfolio and demonstration purposes only.
You are welcome to read the code, but no permission is granted to copy, modify, redistribute, or deploy it.
Because of this, the project does not accept outside contributions.
See the [LICENSE](./LICENSE) file for the full terms.

## Contact

For questions, feedback, or feature requests:

- Use the in-app contact form at the `/contact` route.
- Open an issue on [GitHub](https://github.com/LucasSilbernagel/budget-planner/issues).
