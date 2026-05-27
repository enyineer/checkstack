---
title: Docker Compose
description: Run Checkstack and a Postgres database together with a single compose file. Recommended for single-host self-hosting.
---

Docker Compose is the most common way to run Checkstack on a single host. One file describes both the application and its Postgres database, with persistent volumes, environment variables, and health checks already wired together. This page walks through a complete, runnable setup including an optional satellite.

> [!NOTE]
> If you already have a managed Postgres and only need the Checkstack container, the [Docker](/checkstack/user-guide/installation/docker/) page is shorter and more direct.

## Prerequisites

- Docker Engine 24+ with the Compose plugin (`docker compose`, not the legacy `docker-compose`).
- A host with at least 2 CPU cores and 2 GB of RAM available for the stack.
- A port you can bind to on the host (3000 by default).
- The ability to generate secure random strings (`openssl` or Node.js).

## The compose file

Save this as `docker-compose.yml` somewhere on the host. It runs Checkstack, a Postgres 16 database, and shows the optional satellite block commented out.

```yaml
name: checkstack

services:
  checkstack:
    image: ghcr.io/enyineer/checkstack:<version>
    restart: unless-stopped
    env_file: .env
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-checkstack}:${POSTGRES_PASSWORD:-checkstack}@postgres:5432/${POSTGRES_DB:-checkstack}
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/.checkstack/ready"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    env_file: .env
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-checkstack}"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Optional: Satellite agent for remote health check execution.
  # See https://enyineer.github.io/checkstack/user-guide/concepts/satellites/
  #
  # satellite:
  #   image: ghcr.io/enyineer/checkstack-satellite:<version>
  #   restart: unless-stopped
  #   environment:
  #     CHECKSTACK_CORE_URL: http://checkstack:3000
  #     CHECKSTACK_SATELLITE_CLIENT_ID: ${SATELLITE_CLIENT_ID}
  #     CHECKSTACK_SATELLITE_TOKEN: ${SATELLITE_TOKEN}
  #   depends_on:
  #     checkstack:
  #       condition: service_started

volumes:
  postgres_data:
```

A few things worth noting:

- **Pinned image tag.** Replace `<version>` with the exact release you want to run (see [GitHub releases](https://github.com/enyineer/checkstack/releases)). Pinning is the recommended pattern; see [Upgrading](/checkstack/user-guide/installation/upgrading/) for the rationale.
- **`restart: unless-stopped`.** The container restarts after host reboots and after crashes, but not after you manually `docker compose stop`.
- **Postgres has a healthcheck.** `depends_on` with `service_healthy` waits for Postgres to be ready before starting Checkstack.
- **The Checkstack healthcheck probes `/.checkstack/ready`.** This is the readiness probe and returns 200 only when plugins have finished loading. See [Health probes](/checkstack/user-guide/reference/health-probes/).
- **A single named volume** (`postgres_data`) holds your database. Back this up.

## The `.env` file

Create a `.env` file next to `docker-compose.yml`. The values below combine Postgres credentials with Checkstack's required environment variables.

```env
# --- Postgres ---
POSTGRES_USER=checkstack
POSTGRES_PASSWORD=replace-me-with-a-strong-password
POSTGRES_DB=checkstack

# --- Checkstack ---
# 64 hex characters (32 bytes). Generate with: openssl rand -hex 32
ENCRYPTION_MASTER_KEY=replace-me-64-hex-chars

# At least 32 characters. Generate with: openssl rand -base64 32
BETTER_AUTH_SECRET=replace-me-32-plus-chars

# Must match exactly how you reach Checkstack in the browser.
# Example LAN host: http://192.168.1.50:3000
# Example domain:   https://status.example.com
BASE_URL=http://localhost:3000
```

> [!IMPORTANT]
> `BASE_URL` is the most common gotcha. It must match the URL you actually type in the browser, including protocol, host, and port. A mismatch causes the frontend to silently fail to reach the backend and the onboarding screen to look broken. See [First-run setup](/checkstack/user-guide/installation/first-run-setup/).

Generate the secrets and write them in one shot:

```bash
cat > .env << EOF
POSTGRES_USER=checkstack
POSTGRES_PASSWORD=$(openssl rand -base64 24)
POSTGRES_DB=checkstack
ENCRYPTION_MASTER_KEY=$(openssl rand -hex 32)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BASE_URL=http://localhost:3000
EOF
```

> [!CAUTION]
> Do not commit `.env` to version control. Add it to `.gitignore`. Losing `ENCRYPTION_MASTER_KEY` makes every encrypted secret in the database unrecoverable.

## Start the stack

```bash
docker compose up -d
```

On first start, Checkstack performs its database migrations and registers all built-in plugins. Watch the logs while it boots:

```bash
docker compose logs -f checkstack
```

When you see `listening on http://0.0.0.0:3000` and `core init complete`, open the URL you set as `BASE_URL` in a browser. You will land on the onboarding screen that creates the first admin user. See [First-run setup](/checkstack/user-guide/installation/first-run-setup/) for what happens next.

## Day-2 operations

### Check container health

```bash
docker compose ps
```

`STATUS` should report `healthy` for both services. If `checkstack` shows `unhealthy`, hit the readiness endpoint to see which probe is failing:

```bash
curl http://localhost:3000/.checkstack/ready
```

### Tail logs

```bash
docker compose logs -f checkstack
docker compose logs -f postgres
```

### Restart after a config change

```bash
docker compose up -d --force-recreate
```

Use this whenever you change `.env` or `docker-compose.yml`. Compose otherwise leaves running containers alone.

### Stop and start

```bash
docker compose stop      # stops without removing
docker compose start     # starts existing containers
docker compose down      # stops AND removes containers (volumes survive)
```

> [!WARNING]
> `docker compose down -v` also removes the `postgres_data` volume. That destroys your entire database. Only run it if you really want a clean slate.

## Backups

Snapshot Postgres on whatever schedule your data sensitivity demands. A simple cron-friendly recipe:

```bash
docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > checkstack-$(date +%F).sql.gz
```

Store the dump and your `.env` somewhere safe. You need both to restore: the dump rebuilds the data; `ENCRYPTION_MASTER_KEY` is required to decrypt the secrets inside it.

## Adding a satellite later

The compose file ships with a commented `satellite:` block. To use it:

1. Create a satellite record in the Checkstack UI (**Infrastructure -> Satellites -> Add satellite**). Copy the client ID and token shown after creation.
2. Add the values to your `.env`:
   ```env
   SATELLITE_CLIENT_ID=<uuid-from-ui>
   SATELLITE_TOKEN=<one-time-token-from-ui>
   ```
3. Uncomment the `satellite:` service in `docker-compose.yml`.
4. `docker compose up -d` again.

For more on what satellites do and when to use them, see [Satellites](/checkstack/user-guide/concepts/satellites/) and [Connect a satellite](/checkstack/user-guide/guides/connect-a-satellite/).

## Reverse proxy notes

For production you will typically front Checkstack with a reverse proxy that terminates TLS. A minimal Caddy config:

```text
status.example.com {
  reverse_proxy checkstack:3000
}
```

Two things to keep in mind:

- Set `BASE_URL=https://status.example.com` (the public URL), not the internal Docker hostname.
- The proxy must allow long-lived WebSocket connections; Checkstack uses them for realtime signals.

For Nginx / Traefik examples and TLS handling, see [Installation troubleshooting](/checkstack/user-guide/troubleshooting/).

## Where to go next

- [First-run setup](/checkstack/user-guide/installation/first-run-setup/) walks through the onboarding flow once the stack is up.
- [Configuration reference](/checkstack/user-guide/reference/) lists every supported environment variable.
- [Upgrading](/checkstack/user-guide/installation/upgrading/) covers safe upgrade paths and the BETA versioning policy.
