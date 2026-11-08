# syntax=docker/dockerfile:1.7
#
# One image recipe for every long-running Node service (D25): services/agent,
# services/indexer, services/scorer and the Telegram bot in packages/alerts.
# Build context is the repo root; see infra/compose/stack.yml for the per-service args.
#
#   PACKAGE  workspace package name, e.g. @strata/agent
#   ENTRY    compiled entry point relative to the package root, e.g. dist/core/main.js
#
# Contract for each service package: a `build` script that emits plain ESM JavaScript
# into dist/, so the runtime needs neither tsx nor dev dependencies. Secrets are never
# copied into the image; compose mounts them read-only at /run/secrets at runtime.

ARG NODE_IMAGE=node:22.23.4-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo
# corepack reads the exact pnpm version from package.json#packageManager.
COPY package.json ./
RUN corepack enable && corepack install && pnpm --version

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
ARG PACKAGE
RUN test -n "${PACKAGE}" || (echo "PACKAGE build arg is required" >&2; exit 1)
# Builds the target and every workspace package it depends on, in dependency order.
RUN pnpm exec turbo run build --filter="${PACKAGE}..."
# Copies the package plus production dependencies only into /out (dev deps pruned).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter "${PACKAGE}" deploy --prod --legacy /out

FROM ${NODE_IMAGE} AS runtime
ARG ENTRY
ENV NODE_ENV=production \
    ENTRY=${ENTRY} \
    METRICS_PORT=9464
WORKDIR /app
# Owned by root and not writable by the runtime user: the process cannot modify its code.
COPY --from=build /out ./
RUN test -n "${ENTRY}" && test -f "/app/${ENTRY}" || (echo "ENTRY ${ENTRY} not found in build output" >&2; exit 1)
USER node
EXPOSE 9464
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.METRICS_PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# exec keeps node as the signal target so SIGTERM reaches the cancel-all handler.
CMD ["sh", "-c", "exec node --enable-source-maps \"$ENTRY\""]
