# syntax=docker/dockerfile:1
# Build context must be the monorepo root. The registry bills each tag at its full
# compressed size, so an image must stay <= 112 MB (build-image enforces it).

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
# Build tools are devDependencies, so install them despite the production build.
COPY . .
RUN NODE_ENV=development pnpm install --frozen-lockfile

# VITE_* values are inlined into the client bundle at build time; only public
# values belong here, since a build arg is baked into an image layer.
ARG VITE_COUNTERDEV_ID=""
ENV VITE_COUNTERDEV_ID=$VITE_COUNTERDEV_ID
ARG VITE_FORMSPARK_FORM_ID=""
ENV VITE_FORMSPARK_FORM_ID=$VITE_FORMSPARK_FORM_ID

RUN pnpm --filter @budget-planner/web build

# --prod: web needs only what server.js imports bare; db needs drizzle-kit/tsx
# for the migrate mode, so they are db `dependencies`.
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --prod --filter @budget-planner/web --filter @budget-planner/db

# PGlite is a test-only root devDependency that drizzle-orm's optional peer drags
# into a --prod install; delete it and fail on any other dangling link.
RUN rm -rf node_modules/.pnpm/@electric-sql+pglite@* \
 && dangling="$(find /app -xtype l | sort)" \
 && printf 'dangling symlinks (expected: pglite peer, @budget-planner/core|config):\n%s\n' "${dangling}" \
 && unexpected="$(printf '%s\n' "${dangling}" | grep -v -E '/node_modules/@electric-sql/pglite$|/apps/web/node_modules/@budget-planner/(core|config)$' || true)" \
 && if [ -n "${unexpected}" ]; then echo "unexpected dangling symlinks:"; echo "${unexpected}"; exit 1; fi

COPY packages/db/drizzle.config.ts packages/db/
COPY packages/db/migrations packages/db/migrations
COPY packages/db/src packages/db/src
RUN rm -f packages/db/src/*.test.ts

# Not `base`: nothing at runtime runs pnpm. Paths mirror the workspace layout
# because entry files and pnpm's .bin shims embed them.
FROM node:24-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
WORKDIR /app
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/web/node_modules /app/apps/web/node_modules
COPY --from=prod-deps /app/packages/db /app/packages/db
# dist/client carries precompressed .br/.gz siblings; the edge does not compress.
COPY --from=build /app/apps/web/dist /app/apps/web/dist
COPY --from=build /app/apps/web/package.json /app/apps/web/server-entry.mjs /app/apps/web/serve-entry.mjs /app/apps/web/migrate-entry.mjs /app/apps/web/
COPY --from=build /app/apps/web/src/server/entrypoint.mjs /app/apps/web/src/server/node-adapter.mjs /app/apps/web/src/server/migrate-runner.mjs /app/apps/web/src/server/migrate-status.mjs /app/apps/web/src/server/
EXPOSE 8080
USER node
CMD ["node", "apps/web/server-entry.mjs"]
