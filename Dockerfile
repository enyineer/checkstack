# Stage 1: Install Dependencies and Build Frontend
FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY core ./core
COPY plugins ./plugins
# `docs` is a workspace member (Astro Starlight site). We build it in this
# stage and ship the static `dist` so the app can serve the user guide
# in-app (same artifact as the GitHub Pages deploy). The full source is
# copied here (not just the manifest) so `astro build` can run below.
COPY docs ./docs

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

# Build the CORE frontend plugins that ship a public Module Federation remote
# (checkstack.publicRemote), so the backend can serve their dist/ under
# /assets/plugins/<name>/ to the lean public status-page bundle. Without this the
# public bundle's loadRemote 404s and the widget renders nothing.
RUN bun run build:public-remotes

# Build the docs (Astro Starlight) static site -> docs/dist. Served in-app at
# /checkstack/* by the backend (see CHECKSTACK_DOCS_DIST in the runtime stage).
RUN bun run --filter '@checkstack/docs' build

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

# Strip vendored test/benchmark artefacts inside production node_modules.
# Some upstream tarballs (e.g. fast-uri, tedious) ship their own benchmark/
# folders with a nested package.json. Trivy treats those nested manifests as
# real packages and reports their CVEs (e.g. "benchmark", "uri-js" inside
# fast-uri/benchmark/). They're never executed at runtime, so we delete them
# wholesale to shrink the attack surface and silence false-positive findings.
RUN find node_modules -type d \
  \( -name test -o -name tests -o -name __tests__ \
     -o -name benchmark -o -name benchmarks \
     -o -name examples -o -name example \) \
  -prune -exec rm -rf {} +

# Stage 3: Production Runtime
FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# Runtime packages:
#  - tini / wget: init + healthcheck probe (unchanged).
#  - bubblewrap: the `bwrap` namespace launcher (filesystem confinement + deny /
#    rootless network namespaces) via UNPRIVILEGED user namespaces (rootless
#    bwrap) - no root needed.
#  - slirp4netns: rootless userspace egress so the `allowlist` + metadata block
#    work WITHOUT CAP_NET_ADMIN / a host uplink (the rootless-container path).
#  - util-linux: `prlimit` (resource rlimits) + `unshare` (the userns probe).
#  - nftables: the `nft` CLI the rootless egress filter loads (fail-closed).
# These make every sandbox layer enforceable so the secure FAIL-CLOSED default
# works out of the box. The container RUNTIME must apply TWO relaxations (see
# the script-sandbox docs + docker-compose.yml + deploy/k8s):
#   1. the bundled tuned seccomp profile (permits the unprivileged userns +
#      bwrap syscalls, still denies the dangerous set) via
#      `--security-opt seccomp=deploy/seccomp/checkstack-userns.json`; and
#   2. a /proc unmask so bwrap can mount a fresh /proc inside the namespace, via
#      `--security-opt systempaths=unconfined` (Docker) or `procMount: Unmasked`
#      (Kubernetes).
# Fallback if the profile file cannot be mounted: `seccomp=unconfined` +
# `systempaths=unconfined`. If NEITHER can be relaxed, set the global policy to
# `degrade`. The tuned profile + unmask combination is VALIDATED in-container
# against a real syscall trace of the full sandbox flow.
RUN apk update && apk upgrade --no-cache && \
  apk add --no-cache tini wget bubblewrap slirp4netns util-linux nftables

# Copy from builder/production-deps
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/core ./core
COPY --from=production-deps /app/plugins ./plugins
COPY --from=builder /app/core/frontend/dist ./core/frontend/dist
# Public Module Federation remote plugin dist(s), built in the builder stage
# (checkstack.publicRemote). production-deps ships the pruned `core` tree WITHOUT
# any built dist, so copy each remote's dist over it explicitly - the backend
# serves it from <plugin.path>/dist under /assets/plugins/<name>/. Add a line
# here for each new publicRemote plugin (kept in sync with build:public-remotes).
COPY --from=builder /app/core/announcement-frontend/dist ./core/announcement-frontend/dist
# In-app user guide (Astro Starlight build), served at /checkstack/*.
COPY --from=builder /app/docs/dist ./docs/dist
COPY package.json bun.lock ./
COPY LICENSE.md ./

RUN mkdir -p /app/runtime_plugins /app/data

# Dedicated low-privilege identity. NON-ROOT SUPERVISOR MODEL: the supervisor
# process itself runs as this uid (see `USER 65532:65532` below), so every
# sandboxed user script INHERITS non-root by construction and can never be
# host-root. Confinement (filesystem + network) is delivered by ROOTLESS bwrap
# via UNPRIVILEGED user namespaces - in-namespace root maps back to this
# unprivileged host uid, so even mapped-root cannot escape to host root. No
# root-mapped `--uid` drop is needed (and is impossible rootless without
# subuid/newuidmap). uid/gid 65532 is the conventional distroless non-root id
# and is free in the base image (1000 is taken by `bun`).
RUN addgroup -g 65532 checkstack && adduser -D -u 65532 -G checkstack checkstack

# Everything the non-root supervisor must READ at runtime (the app bundle, the
# reconciled managed-package node_modules tree, interpreters) and any dir it
# must WRITE (the data dir, the runtime plugins dir, and the per-run scratch
# under TMPDIR) must be owned by / writable by 65532. The bundle is world-
# readable by default; we chown the writable trees explicitly. (The per-run
# script scratch dirs are created under /tmp, which is world-writable.)
RUN chown -R 65532:65532 /app/data /app/runtime_plugins

ENV NODE_ENV=production
ENV CHECKSTACK_DATA_DIR=/app/data
ENV CHECKSTACK_PLUGINS_DIR=/app/runtime_plugins
ENV CHECKSTACK_FRONTEND_DIST=/app/core/frontend/dist
# In-app user guide static build (served at /checkstack/* by the backend).
ENV CHECKSTACK_DOCS_DIST=/app/docs/dist
# NOTE: CHECKSTACK_SANDBOX_UID/GID are intentionally NOT set. They seeded the
# legacy ROOT-supervisor `--uid` drop target; under the non-root supervisor the
# script inherits non-root and a drop to a DIFFERENT id is neither possible
# (rootless) nor needed. The privilege layer reports enforced-by-inheritance.

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

# NON-ROOT supervisor: run the whole process as the dedicated low-priv id. The
# script sandbox then provides FS + network confinement via ROOTLESS bwrap
# (unprivileged user namespaces), and the script inherits non-root by
# construction. Requires the runtime to permit unprivileged userns (see the
# bundled seccomp profile / the docs).
USER 65532:65532

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["bun", "run", "core/backend/src/index.ts"]

EXPOSE 3000
