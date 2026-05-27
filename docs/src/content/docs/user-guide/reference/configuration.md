---
title: "Configuration reference"
description: "Every environment variable Checkstack reads at boot, grouped by purpose, with type, default, and what changes when you set it."
---

Checkstack is configured almost entirely through environment variables. The platform reads them once at process start (or on the first request that touches them) and there is no runtime reload. To change a value, restart the container.

This page is the authoritative list. If you are just looking for the minimum required to boot, see [Run Checkstack with Docker](/checkstack/user-guide/installation/docker/) and come back here when you need detail.

> [!NOTE]
> All variables are read with `process.env`. They must be set on the **backend** container. Frontend assets are served by the backend, so there are no separate frontend env vars to set at deploy time.

## Core

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `BASE_URL` | yes | none | The exact public URL operators type into the browser to reach Checkstack (e.g. `http://192.168.1.10:3000`, `https://status.example.com`). Used for CORS, OAuth redirects, SAML reply URLs, OpenAPI server URL, notification links, and the runtime config endpoint at `/api/config`. Must match the address you actually use; a mismatch silently breaks SSO redirects and shows a blank UI. |
| `NODE_ENV` | no | `development` | Set to `production` for JSON-formatted logs and to disable the dev log files under `.dev/logs/`. Also blocks `CHECKSTACK_DEV_AUTH=true` (it throws on boot when set in production). |
| `CHECKSTACK_FRONTEND_DIST` | no (set by Docker image) | unset | Absolute path to the built frontend `dist/` directory. The official Docker image sets it to `/app/core/frontend/dist`. If you run the backend without static assets, leave this unset and serve the frontend separately. |
| `INTERNAL_URL` | no | falls back to `BASE_URL` or `http://localhost:3000` | URL used for backend-to-backend RPC inside the cluster. Set this to a cluster-internal address (e.g. a Kubernetes service name like `http://checkstack-svc:3000`) when running multiple replicas so internal traffic skips the external load balancer. |

## Database

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `DATABASE_URL` | yes | none | PostgreSQL connection string used by every backend package (`postgresql://user:pass@host:5432/db`). All plugin schemas live in this one database; per-plugin tables are isolated via PostgreSQL schemas (`plugin_<id>`). No extensions are required. Postgres 16 is the version shipped in the reference compose file. |

> [!IMPORTANT]
> Checkstack does not support SQLite. The platform relies on Postgres-specific features (JSONB, schema namespacing, `LISTEN`/`NOTIFY` style queueing via plugins). Any reachable Postgres 14+ instance works; managed services like Neon or Supabase are fine.

## Authentication

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `BETTER_AUTH_SECRET` | yes | none | Signs session cookies and OAuth state. Must be at least 32 characters. Used by `core/auth-backend` and the SAML plugin. Treat this like a JWT signing key: rotating it logs every user out. |
| `PUBLIC_URL` | no (SAML only) | falls back to `BASE_URL` | Optional override the SAML plugin uses to build identity-provider callback URLs. Only set this if the public URL exposed to your IdP differs from `BASE_URL` (rare). |

For the strategy-by-strategy walkthrough (credential, GitHub OAuth, SAML, LDAP, group mapping) see [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/).

## Encryption

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `ENCRYPTION_MASTER_KEY` | yes | none | 64-character hex string (32 bytes) used as the AES-256-GCM key for every secret stored in the database: OAuth client secrets, integration API tokens, satellite tokens, etc. Without it, the platform refuses to boot any feature that stores a secret. See [Secret encryption](/checkstack/user-guide/reference/secret-encryption/) for generation and rotation details. |

## Logging

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `LOG_LEVEL` | no | `info` | Winston log level. One of `error`, `warn`, `info`, `debug`. Setting `debug` is verbose but useful when diagnosing plugin install or queue lag issues. |
| `DEBUG` | no | unset | Only honoured by the satellite agent. Any non-empty value enables `[satellite:debug]` lines on stdout. |

## Plugin development

These variables only apply when you are developing a plugin locally; never set them in production.

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `CHECKSTACK_DEV_PLUGIN_PATH` | no | unset | Absolute path to a plugin directory whose default export is a `BackendPlugin`. Setting this skips filesystem discovery and loads only that plugin plus core services. Used by `bunx @checkstack/scripts dev`. |
| `CHECKSTACK_DEV_EXTRA_PLUGIN_PATHS` | no | unset | JSON array of additional plugin module paths to co-load alongside the one under `CHECKSTACK_DEV_PLUGIN_PATH`. The dev script sets this automatically based on `package.json` dependencies. |
| `CHECKSTACK_DEV_AUTH` | no | `false` | When `true`, registers a synthetic auth service that auto-grants every access rule. Strictly refused when `NODE_ENV=production` (the process throws at boot). Useful for testing plugins without going through a login flow. |

> [!WARNING]
> `CHECKSTACK_DEV_AUTH=true` disables every access guard in the platform. Never set it on an exposed instance.

## Satellite agent

The satellite is a separate process. These variables apply to the satellite container only, not to the core backend.

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `CHECKSTACK_CORE_URL` | yes | none | URL of the Checkstack core the satellite connects to. Reachable from wherever the satellite runs. |
| `CHECKSTACK_SATELLITE_CLIENT_ID` | yes | none | Stable id you assign in the Satellite registration UI. Identifies this satellite to the core. |
| `CHECKSTACK_SATELLITE_TOKEN` | yes | none | Bearer token issued by the core when the satellite was registered. Treat as a credential. |
| `DEBUG` | no | unset | Enables verbose satellite logs. |

## Docker Compose helpers

The reference `docker-compose.yml` adds a few Postgres-side variables for convenience. They are read by the Postgres image, not by Checkstack itself.

| Variable | Default in compose | What it does |
|----------|--------------------|--------------|
| `POSTGRES_USER` | `checkstack` | DB user the Postgres container creates on first boot. Plugged into `DATABASE_URL`. |
| `POSTGRES_PASSWORD` | `checkstack` | Password for the above user. Change this for any non-throwaway install. |
| `POSTGRES_DB` | `checkstack` | Database name created on first boot. |

## Example `.env`

A complete `.env` for a single-host production install looks like this:

```env
# Core
BASE_URL=https://status.example.com
NODE_ENV=production
LOG_LEVEL=info

# Database
POSTGRES_USER=checkstack
POSTGRES_PASSWORD=replace-me
POSTGRES_DB=checkstack

# Auth
BETTER_AUTH_SECRET=replace-with-32-plus-char-random-string

# Encryption
ENCRYPTION_MASTER_KEY=replace-with-64-hex-chars
```

For multi-replica deployments, add:

```env
INTERNAL_URL=http://checkstack-svc:3000
```

## Where to go next

- [Run Checkstack with Docker](/checkstack/user-guide/installation/docker/) for the install flow that feeds these variables.
- [Secret encryption](/checkstack/user-guide/reference/secret-encryption/) for generating and rotating `ENCRYPTION_MASTER_KEY`.
- [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/) for the strategy-side configuration you set from the UI on top of the env vars above.
- [Installation troubleshooting](/checkstack/user-guide/troubleshooting/installation/) when boot fails or environment values look wrong.
