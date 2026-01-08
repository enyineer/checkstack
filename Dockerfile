# Stage 1: Dependencies
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY core/*/package.json ./core/
COPY plugins/*/package.json ./plugins/
RUN bun install --frozen-lockfile --production

# Stage 2: Build Frontend
FROM oven/bun:1-alpine AS frontend-builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run --filter '@checkmate-monitor/frontend' build

# Stage 3: Production Runtime
FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache tini

# Copy application code
COPY --from=deps /app/node_modules ./node_modules
COPY --from=frontend-builder /app/core/frontend/dist ./core/frontend/dist
COPY core ./core
COPY plugins ./plugins
COPY package.json bun.lock ./

# Create runtime directories
RUN mkdir -p /app/runtime_plugins /app/data

# Environment variables
ENV NODE_ENV=production
ENV CHECKMATE_DATA_DIR=/app/data
ENV CHECKMATE_PLUGINS_DIR=/app/runtime_plugins
ENV CHECKMATE_FRONTEND_DIST=/app/core/frontend/dist

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["bun", "run", "core/backend/src/index.ts"]

EXPOSE 3000
