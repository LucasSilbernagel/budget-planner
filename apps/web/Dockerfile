# syntax=docker/dockerfile:1
#
# Production image for the budget-planner TanStack Start SSR app (Story 5-2, AC-2;
# slimmed by story ops-1).
# Targets DanubeData Rapids (Knative serverless containers, Falkenstein, Germany —
# EU only, zero US residency: NFR1/NFR2).
#
# Build context MUST be the monorepo root (pnpm workspace):
#   docker build -f apps/web/Dockerfile -t budget-planner-web .
#   docker run --rm -p 8080:8080 -e NODE_ENV=production \
#     -e SESSION_SECRET=$(openssl rand -hex 32) -e SITE_URL=http://localhost:8080 \
#     budget-planner-web
#
# The container runs the self-listening entrypoint (apps/web/server-entry.mjs),
# which binds $PORT (default 8080) on 0.0.0.0 and serves SSR + /api/* + the
# static dist/client/ assets — or, with APP_ENTRYPOINT=migrate, applies the
# database migrations (apps/web/migrate-entry.mjs).
#
# ⚠️ SIZE IS A HARD CONSTRAINT (story ops-1). The DanubeData registry plan is
# 500 MB and counts every tag at its FULL compressed size (no layer dedup across
# tags). The pipeline keeps 2 rollback tags + the live one + the migrator's pinned
# tag, so one tag must stay <= 112 MB: (2 + 1 + 1) x S <= 450 MB (50 MB margin).
# The build-image job measures every build and FAILS above that budget before
# anything is pushed (deploy.yml "Check the image size budget"). The fat image this
# replaced (whole workspace + every devDependency) was ~173 MB.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# --- Build stage: install ALL workspace deps and build the web app ----------
FROM base AS build
# `vite`, the TanStack Start plugin, etc. are devDependencies, so the build must
# install them (NODE_ENV=production would prune them). The `build` script itself
# sets NODE_ENV=production for the compile so the production React JSX runtime is
# used (Story 5-2, AC-1 — a dev-runtime bundle throws `jsxDEV is not a function`).
COPY . .
RUN NODE_ENV=development pnpm install --frozen-lockfile

# Build-time public vars (Story 5-4, AC-2). `vite build` inlines VITE_-prefixed
# values into the CLIENT bundle, so they must be present HERE — setting them on
# the running container has no effect. Both values below are public identifiers,
# not secrets (apps/web/.env.example, ADR-005); passing a secret as a build arg
# would bake it into an image layer, so only public values belong here.
# `__APP_VERSION__` needs no arg — vite.config.ts inlines it from package.json.
#
# Unset is valid for both, and each degrades on its own: analytics is simply not
# loaded, and the contact form renders a "temporarily unavailable" notice
# (apps/web/src/components/contact/contact-form.tsx).
ARG VITE_COUNTERDEV_ID=""
ENV VITE_COUNTERDEV_ID=$VITE_COUNTERDEV_ID
ARG VITE_FORMSPARK_FORM_ID=""
ENV VITE_FORMSPARK_FORM_ID=$VITE_FORMSPARK_FORM_ID

RUN pnpm --filter @budget-planner/web build

# --- Prod-deps stage: production node_modules + the migrate payload ----------
# Only manifests and the lockfile, so this stage does not re-run when source
# changes. `--prod` installs `dependencies` only:
#   - @budget-planner/web: exactly what `dist/server/server.js` imports bare at
#     runtime (react, react-dom, @tanstack/react-router, recharts, zustand, zod,
#     drizzle-orm, markdown-to-jsx, @paddle/paddle-js). Everything else —
#     including @tanstack/react-start and the workspace packages — is bundled
#     into server.js, so it is a devDependency (ops-1 moved react-start there; the
#     server bundle was byte-identical before and after).
#   - @budget-planner/db: the migrate entrypoint's toolchain. drizzle-kit, tsx
#     and dotenv are RUNTIME dependencies of the image's migrate mode, which
#     spawns packages/db/node_modules/.bin/{tsx,drizzle-kit} (migrate-runner.mjs,
#     migrate-lock-cli.ts). They are `dependencies` of packages/db for that reason.
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --prod --filter @budget-planner/web --filter @budget-planner/db

# PGlite (~26 MB) is a ROOT devDependency used only by tests. pnpm resolves it as
# drizzle-orm's optional peer, so the drizzle-orm snapshot drags it into a --prod
# install. Nothing at runtime imports `drizzle-orm/pglite` (the app and the
# migrator both use node-postgres), so delete it. The check below fails the build
# if anything ELSE ends up as a dangling link: the only expected ones are this
# peer link and the bundled workspace packages (core, config) whose sources are
# deliberately not shipped.
RUN rm -rf node_modules/.pnpm/@electric-sql+pglite@* \
 && dangling="$(find /app -xtype l | sort)" \
 && printf 'dangling symlinks (expected: pglite peer, @budget-planner/core|config):\n%s\n' "${dangling}" \
 && unexpected="$(printf '%s\n' "${dangling}" | grep -v -E '/node_modules/@electric-sql/pglite$|/apps/web/node_modules/@budget-planner/(core|config)$' || true)" \
 && if [ -n "${unexpected}" ]; then echo "unexpected dangling symlinks:"; echo "${unexpected}"; exit 1; fi

# The migrate payload. Run with cwd packages/db: drizzle.config.ts reads
# ./migrations; the lock CLI imports the preflight CLI, ca-cert,
# migrate-credentials and client (-> schema). Tests are not shipped.
COPY packages/db/drizzle.config.ts packages/db/
COPY packages/db/migrations packages/db/migrations
COPY packages/db/src packages/db/src
RUN rm -f packages/db/src/*.test.ts

# --- Runtime stage ----------------------------------------------------------
# Straight from the node base, NOT `base`: nothing at runtime runs pnpm or
# corepack (the CMD runs `node` directly, and migrate-entry spawns the .bin
# shims by path). Layout is /app/apps/web + /app/packages/db exactly as in the
# workspace, so every relative path in the entry files stays valid
# (migrate-entry.mjs resolves packages/db as `join(here, '..', '..', 'packages', 'db')`,
# and pnpm's .bin shims embed /app paths from the install above).
FROM node:24-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
WORKDIR /app
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/web/node_modules /app/apps/web/node_modules
COPY --from=prod-deps /app/packages/db /app/packages/db
# dist/client carries the precompressed .br/.gz siblings (scripts/precompress.mjs,
# the last step of `build`); the node adapter serves them. The edge does NOT
# compress, so losing them silently loses compression for static assets.
COPY --from=build /app/apps/web/dist /app/apps/web/dist
COPY --from=build /app/apps/web/package.json /app/apps/web/server-entry.mjs /app/apps/web/serve-entry.mjs /app/apps/web/migrate-entry.mjs /app/apps/web/
COPY --from=build /app/apps/web/src/server/entrypoint.mjs /app/apps/web/src/server/node-adapter.mjs /app/apps/web/src/server/migrate-runner.mjs /app/apps/web/src/server/migrate-status.mjs /app/apps/web/src/server/
EXPOSE 8080
# Run as the unprivileged `node` user shipped in the base image.
USER node
# Invoke node directly (not `pnpm start`) so the runtime needs no pnpm at all.
# Equivalent to `pnpm --filter @budget-planner/web start`. ESM relative imports
# in server-entry.mjs resolve from the file, so cwd does not matter.
CMD ["node", "apps/web/server-entry.mjs"]
