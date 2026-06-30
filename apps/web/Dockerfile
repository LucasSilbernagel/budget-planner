# syntax=docker/dockerfile:1
#
# Production image for the budget-planner TanStack Start SSR app (Story 5-2, AC-2).
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
# static dist/client/ assets.

FROM node:20-slim AS base
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
# Build-time PUBLIC var (Story 4-11): inlined into the client bundle by Vite, so
# it must be present at BUILD, not runtime. Supply with
# `--build-arg VITE_ETHICALADS_PUBLISHER_ID=...`; absent → ads simply don't
# render (it is a public id, not a secret).
ARG VITE_ETHICALADS_PUBLISHER_ID=""
ENV VITE_ETHICALADS_PUBLISHER_ID=$VITE_ETHICALADS_PUBLISHER_ID
RUN pnpm --filter @budget-planner/web build

# --- Runtime stage ----------------------------------------------------------
# The Start server bundle externalizes some runtime deps (react-dom, etc.), so
# node_modules must ship. `pg` is bundled with `pg-native` stubbed out, so no
# native libpq toolchain is needed. (Slimming via `pnpm deploy --prod` is a
# future optimization; left as a single fat image for reproducibility.)
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
COPY --from=build /app /app
EXPOSE 8080
# Run as the unprivileged `node` user shipped in the base image.
USER node
# Invoke node directly (not `pnpm start`) so the runtime needs no writable pnpm
# store. Equivalent to `pnpm --filter @budget-planner/web start`. ESM relative
# imports in server-entry.mjs resolve from the file, so cwd does not matter.
CMD ["node", "apps/web/server-entry.mjs"]
