# Stage 1: Install Dependencies and Build Frontend
FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY core ./core
COPY plugins ./plugins
# `docs` is a workspace member (Astro Starlight site). The runtime image
# does not need its source, but Bun's workspace resolver still requires
# the manifest to be present, otherwise `bun install` fails with
# "Workspace not found 'docs'".
COPY docs/package.json ./docs/package.json

# Install all dependencies with timeout to prevent CI stalls
#
# OPTIMIZATION: BuildKit cache mount persists ~/.bun/install/cache across builds.
# Packages are only downloaded once, even when bun.lock changes.
#
# WORKAROUND 1: Using `timeout` to kill stalled installs. Multi-platform builds
# (arm64 + amd64 in parallel) can rarely cause bun install to hang indefinitely,
# wasting runner minutes. A 300s (5 min) timeout per attempt, with 3 retries,
# ensures the build either succeeds or fails fast.
#
# WORKAROUND 2: Using "|| true" because Bun exits with code 1 when optional
# dependencies fail to install, even though they're truly optional.
#
# Affected packages:
#   - cpu-features (optional dep of ssh2): Native module that fails to compile
#     without build tools. ssh2 works fine without it (falls back to JS).
#
# Known issues:
#   - https://github.com/oven-sh/bun/issues/14619 (optional deps cause exit 1)
#   - https://github.com/oven-sh/bun/issues/7274 (--omit=optional inconsistent)
#
# TODO: Remove "|| true" once Bun properly handles optional dependency failures
# by exiting 0 when only optional deps fail. Until then, we verify core packages
# are installed correctly in the next step.
#
RUN --mount=type=cache,target=/root/.bun/install/cache \
  for i in 1 2 3; do \
  echo "Attempt $i: Installing dependencies..." && \
  timeout 300 bun install --frozen-lockfile && break || \
  { echo "Attempt $i failed (timeout or error), retrying in 5s..."; sleep 5; }; \
  done || true

# Verify core packages installed correctly (catches real failures vs optional)
RUN test -d core/backend/node_modules/hono && test -d core/backend/node_modules/drizzle-orm && \
  echo "✓ Core packages verified" || \
  (echo "ERROR: Core packages missing! Check bun install output above." && exit 1)

# Build frontend
RUN bun run --filter '@checkstack/frontend' build

# Stage 2: Prune devDependencies for Production
FROM oven/bun:1-alpine AS production-deps
WORKDIR /app

COPY package.json bun.lock ./
COPY core ./core
COPY plugins ./plugins
# `docs` is a workspace member (Astro Starlight site). The runtime image
# does not need its source, but Bun's workspace resolver still requires
# the manifest to be present, otherwise `bun install` fails with
# "Workspace not found 'docs'".
COPY docs/package.json ./docs/package.json

RUN --mount=type=cache,target=/root/.bun/install/cache \
  for i in 1 2 3; do \
  echo "Attempt $i: Installing production dependencies..." && \
  timeout 300 bun install --frozen-lockfile --production && break || \
  { echo "Attempt $i failed (timeout or error), retrying in 5s..."; sleep 5; }; \
  done || true

# Remove development-only folders
RUN rm -rf core/scripts core/test-utils-backend core/test-utils-frontend

# Stage 3: Production Runtime
FROM oven/bun:1-alpine AS runtime
WORKDIR /app

RUN apk update && apk upgrade --no-cache && apk add --no-cache tini wget

# Copy from builder/production-deps
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/core ./core
COPY --from=production-deps /app/plugins ./plugins
COPY --from=builder /app/core/frontend/dist ./core/frontend/dist
COPY package.json bun.lock ./
COPY LICENSE.md ./

RUN mkdir -p /app/runtime_plugins /app/data

ENV NODE_ENV=production
ENV CHECKSTACK_DATA_DIR=/app/data
ENV CHECKSTACK_PLUGINS_DIR=/app/runtime_plugins
ENV CHECKSTACK_FRONTEND_DIST=/app/core/frontend/dist

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Probe the readiness endpoint, not liveness:
#   /.checkstack/health  → 200 the moment the process is up (even mid-boot)
#   /.checkstack/ready   → 503 until plugins finish loading and all critical
#                          probes pass; 200 only when traffic should flow.
# `--start-period=60s` gives plugin init enough time on cold start before
# Docker counts failures against `--retries`.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/.checkstack/ready || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["bun", "run", "core/backend/src/index.ts"]

EXPOSE 3000
