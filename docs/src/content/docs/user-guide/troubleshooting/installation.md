---
title: "Installation troubleshooting"
description: "Fixes for the most common Checkstack boot failures, env-var traps, database errors, and satellite handshake problems."
---

This page is a problem-driven cheat sheet. Find the symptom you see, work through "How to verify" to confirm the diagnosis, then apply the fix. For the canonical list of env vars referenced throughout, see the [Configuration reference](/checkstack/user-guide/reference/configuration/).

## The container won't start

### Symptom: process exits with `DATABASE_URL is not defined`

The backend refuses to boot if `DATABASE_URL` is missing.

**How to verify** - check the container logs:

```bash
docker logs checkstack
# look for: Error: DATABASE_URL is not defined
```

**Fix** - set `DATABASE_URL` to a valid PostgreSQL connection string in your `.env` (or `-e DATABASE_URL=...`):

```env
DATABASE_URL=postgresql://checkstack:secret@postgres:5432/checkstack
```

Restart with `docker compose up -d --force-recreate`.

### Symptom: `ENCRYPTION_MASTER_KEY must be 32 bytes (64 hex characters)`

The encryption key is missing, the wrong length, or contains non-hex characters.

**How to verify**:

```bash
echo -n "$ENCRYPTION_MASTER_KEY" | wc -c   # must print 64
```

**Fix** - regenerate the key with one of:

```bash
openssl rand -hex 32
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> [!CAUTION]
> Changing `ENCRYPTION_MASTER_KEY` makes every secret stored under the old key unrecoverable. Only regenerate on a fresh install, or follow the rotation procedure in [Secret encryption](/checkstack/user-guide/reference/secret-encryption/).

### Symptom: `BETTER_AUTH_SECRET environment variable is not defined`

Auth plugins refuse to start if the secret is missing.

**How to verify** - container logs show:

```text
[auth-backend] BETTER_AUTH_SECRET environment variable is not defined.
```

**Fix** - set a 32+ character random string in `.env`:

```bash
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env
```

> [!WARNING]
> Rotating `BETTER_AUTH_SECRET` invalidates every active session. Users will need to sign in again after the next restart.

### Symptom: `CHECKSTACK_DEV_AUTH=true is refused when NODE_ENV=production`

You set the dev-auth bypass in a production container. The platform fail-fasts to keep an open-auth instance off the internet.

**Fix** - remove `CHECKSTACK_DEV_AUTH` from the environment. If you genuinely meant to run a non-production playground, set `NODE_ENV=development`.

## `BASE_URL` problems

`BASE_URL` is the single most common source of confusing UI behaviour. It is used for CORS, OAuth/SAML callback URLs, OpenAPI server URL, the runtime config endpoint, and frontend redirects.

### Symptom: blank UI, infinite loading, or onboarding never appears

The frontend talks to the backend through the URL it learns from `/api/config`. If `BASE_URL` points to the wrong address, the frontend cannot reach session or onboarding endpoints and silently shows empty state.

**How to verify**:

```bash
curl http://localhost:3000/api/config
# Expected: {"baseUrl":"<the URL you actually use in the browser>"}
```

If the response shows a different host, port, or scheme to what you typed in the browser, that is the problem.

**Fix** - set `BASE_URL` to the exact URL you use:

```env
# LAN install
BASE_URL=http://192.168.1.10:3000

# Production with TLS termination
BASE_URL=https://status.example.com
```

Recreate the container so the new value is picked up:

```bash
docker compose up -d --force-recreate
```

### Symptom: SSO/SAML login redirects to the wrong URL

The identity provider returns the user to the wrong URL after auth. Almost always a `BASE_URL` mismatch.

**Fix** - make sure `BASE_URL` matches the URL configured as the reply URL / callback URL at the IdP. If your IdP-facing URL differs from the LAN/internal URL (e.g. you terminate TLS at a reverse proxy), set `PUBLIC_URL` to override just the SAML callback construction.

### Symptom: CORS errors in the browser console

The frontend was loaded from a URL that is not in the CORS allow-list.

**How to verify** - browser console shows `Access-Control-Allow-Origin` errors.

**Fix** - confirm `BASE_URL` matches the address in the browser address bar exactly (scheme, host, port). Recreate the container.

## Database connectivity

### Symptom: `connection refused` or `ETIMEDOUT` from Postgres

The backend cannot reach the database.

**How to verify** - from inside the Checkstack container:

```bash
docker exec -it checkstack sh
# Try the connection manually
nc -vz postgres 5432
```

**Fix** - check, in order:

1. Postgres is running and healthy (`docker compose ps`).
2. `DATABASE_URL`'s host resolves from inside the Checkstack container. Use the service name (e.g. `postgres`), not `localhost`.
3. The Postgres healthcheck has passed; the supplied compose file depends on it.
4. Network policies / firewalls allow port 5432 between containers.

### Symptom: `password authentication failed for user`

The credentials in `DATABASE_URL` don't match what Postgres expects.

**Fix** - confirm `POSTGRES_USER` / `POSTGRES_PASSWORD` in `.env` match the user/password in `DATABASE_URL`. If you changed `.env` after first boot, recreate the Postgres container so the new credentials are applied:

```bash
docker compose down -v   # WARNING: -v deletes the postgres volume
docker compose up -d
```

> [!CAUTION]
> `docker compose down -v` deletes the Postgres data volume. Only run it on an install you can rebuild.

### Symptom: `database "checkstack" does not exist`

The database named in `DATABASE_URL` does not exist on the server.

**Fix** - either create the database manually (`createdb -U postgres checkstack`) or set `POSTGRES_DB=checkstack` in `.env` so the official Postgres image creates it on first boot.

### Symptom: Postgres extension errors

Checkstack does not require any Postgres extensions. If you see an extension error, it's almost certainly from a plugin you installed, not the platform. Check the plugin's docs.

## Encryption key issues

### Symptom: existing secrets cannot be read after a restart

The encryption key has changed since the secrets were written. Every secret was encrypted with the previous key and the new key cannot decrypt them.

**Fix** - restore the previous `ENCRYPTION_MASTER_KEY` value. If the previous key is genuinely lost, the affected secrets must be re-entered through the UI (auth secrets, integration tokens, satellite tokens, ...). See [Secret encryption](/checkstack/user-guide/reference/secret-encryption/) for the rotation procedure that avoids this.

### Symptom: `Invalid encrypted format` when reading a config value

The stored ciphertext is corrupted (typically because the row was edited by hand in Postgres).

**Fix** - delete the affected row through the relevant Settings page in the UI and re-enter the value.

## Satellite handshake failures

The satellite agent is a separate container that connects back to the core over WebSocket. It needs three env vars; see [Configuration reference](/checkstack/user-guide/reference/configuration/#satellite-agent).

### Symptom: satellite logs show `CHECKSTACK_CORE_URL environment variable is required`

One of the three required satellite env vars is missing.

**Fix** - set `CHECKSTACK_CORE_URL`, `CHECKSTACK_SATELLITE_CLIENT_ID`, and `CHECKSTACK_SATELLITE_TOKEN` on the satellite container. The id and token come from the Register button on the Satellites page in the UI.

### Symptom: satellite connects but immediately disconnects

The handshake reached the core but auth was rejected.

**How to verify** - watch the core logs while restarting the satellite. The core logs the rejection reason.

**Fix** - the most common causes:

1. The token doesn't match what the core has on file. Regenerate one from the Satellites page and update the satellite container.
2. The client id was already taken. Pick a unique id when registering.
3. The satellite version is far older than the core. Pull a newer image.

### Symptom: WebSocket upgrade fails behind a reverse proxy

The connection is closed at handshake.

**Fix** - make sure your reverse proxy forwards the `Upgrade` and `Connection` headers and does not buffer WebSocket traffic. Nginx needs:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 86400s;
```

### Symptom: clock skew warnings between satellite and core

JWT signatures are time-bound. A satellite with a clock more than a few minutes off from the core will fail signature validation.

**Fix** - run NTP (or your platform's equivalent) on both hosts. On Docker Desktop, the host clock is usually fine; on bare metal, confirm `timedatectl status` reports the clock as synchronized.

## Where to go next

- [Configuration reference](/checkstack/user-guide/reference/configuration/) - the env vars referenced throughout this page.
- [Secret encryption](/checkstack/user-guide/reference/secret-encryption/) - safe `ENCRYPTION_MASTER_KEY` generation and rotation.
- [Notification troubleshooting](/checkstack/user-guide/troubleshooting/notifications/) - when the platform boots but alerts never arrive.
- [Plugin troubleshooting](/checkstack/user-guide/troubleshooting/plugins/) - when plugin installs fail.
