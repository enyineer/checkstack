---
title: "FAQ"
description: "Short answers to the questions operators ask most often - incidents, databases, backups, plugin uninstall behaviour, secrets, and replicas."
---

This page collects the questions that come up most often when running Checkstack in anger. Each answer is short and links to the canonical source for detail.

## Are incidents auto-created?

**No.** Checkstack does not automatically open incidents when a health check fails. Incidents are explicit operator-reported events that you create from the UI (or via the public REST API). A failing health check produces an unhealthy status and, depending on your subscriptions, a notification - but the platform leaves the decision of "is this incident-worthy?" to a human.

The rationale: automated incident creation produces noise. The platform's job is to surface the failing state; whether that warrants an incident timeline, an SLA breach, or a public status update is a judgement call.

If you want auto-creation, you can plumb it yourself: subscribe to health-check events via an integration (webhook, script integration, ...) and call the public REST API to open an incident when your own logic decides one should exist.

## Can I use SQLite?

**No.** Checkstack requires PostgreSQL. The platform pins the `pg` driver in `core/backend` and every plugin's drizzle config; the Drizzle dialect is hardcoded to `postgresql`. Plugin tables are also isolated through PostgreSQL schemas (`plugin_<id>`), which SQLite doesn't have.

Any reachable Postgres 14+ instance works. The reference `docker-compose.yml` ships with Postgres 16. Managed services like Neon, Supabase, or RDS are fine - they connect through the standard `DATABASE_URL`.

## Can I run multiple replicas?

**Yes, with caveats.** The platform is built for multi-instance operation: plugin installs, uninstalls, and config changes are broadcast across replicas; the queue and cache layers have multi-instance backends (BullMQ, Redis) you can swap to from the Infrastructure settings page.

To run more than one replica:

1. Use the BullMQ queue plugin instead of the default in-memory queue. The in-memory queue is per-process and won't coordinate work across replicas.
2. Use a multi-instance cache plugin (e.g. Redis) for the same reason.
3. Set `INTERNAL_URL` on each replica to a cluster-internal address so internal RPC skips the external load balancer. See [Configuration reference](/checkstack/user-guide/reference/configuration/#core).
4. Make sure all replicas read from the same Postgres database and use the same `ENCRYPTION_MASTER_KEY` and `BETTER_AUTH_SECRET`.

> [!IMPORTANT]
> The default Docker compose file is single-replica. Multi-replica deployments need the queue and cache backends configured for distribution before you scale out.

## How do I back up Checkstack?

Take a Postgres dump:

```bash
docker exec checkstack-postgres-1 pg_dump -U checkstack checkstack \
  | gzip > checkstack-$(date +%F).sql.gz
```

That's almost everything: every system, health check, incident, maintenance, integration credential, plugin install (the tarball is stored in `plugin_artifacts` as `bytea`), and per-plugin schema data lives in the one Postgres database.

The two pieces you also need to keep:

1. **Your `.env` file**, in particular `ENCRYPTION_MASTER_KEY`. Without it, every encrypted secret in the dump is unreadable.
2. **The `runtime_plugins/` directory** if you want to skip the re-extract step on a fresh boot. It's not strictly required - the platform rebuilds it from `plugin_artifacts` on startup - but having it speeds up first boot after a restore.

To restore:

```bash
gunzip < checkstack-2026-05-26.sql.gz \
  | docker exec -i checkstack-postgres-1 psql -U checkstack checkstack
```

Start the container with the same `ENCRYPTION_MASTER_KEY` and `BETTER_AUTH_SECRET` as the source install.

## What happens to my data if I uninstall a plugin?

By default, **nothing destructive**. The uninstall preview screen shows two opt-in toggles:

- **Delete schema** - drops the plugin's Postgres schema (`plugin_<id>`) and all its tables. Off by default.
- **Delete configs** - removes the plugin's rows from `plugin_configs`. Off by default.

If you leave both off, you can re-install the same plugin later and pick up where you left off.

If you tick "Delete schema", the data is gone (`DROP SCHEMA ... CASCADE`). Take a Postgres backup first.

Plugins that other installed plugins depend on cannot be uninstalled in isolation. The preview screen shows dependents and asks you whether to cascade the uninstall. See [Plugin troubleshooting](/checkstack/user-guide/troubleshooting/plugins/#uninstall-behaviour).

## Where are my secrets stored?

Encrypted in Postgres, in the per-plugin `plugin_configs` table (and, for some plugin-specific secrets, in plugin-owned tables). Encryption is AES-256-GCM with the key in `ENCRYPTION_MASTER_KEY`. Secrets are encrypted before they leave the application layer, so the database holds only ciphertext.

For generation, rotation, and the contract guarantees see [Secret encryption](/checkstack/user-guide/reference/secret-encryption/).

## How do I rotate my admin password?

From the UI:

1. Sign in as the admin.
2. Open **Settings -> Profile**.
3. Use the **Change password** action and supply the old + new password.

For a forgotten admin password where you're the only admin: if you have the credential auth strategy enabled, use **Forgot password** on the login page; the reset link is dispatched through your configured notification strategy. If you can't get the reset email out (no notification plugin yet), you'll need to reset the user record directly in Postgres - the user table is `auth_user`, the credential rows are in `auth_account`. Restart the container after editing so cached sessions are dropped.

## How do I disable a compromised user?

1. Open **Settings -> Authentication -> Users**.
2. Find the user and use the **Delete user** action. Deleting removes their access rules everywhere and invalidates their sessions.

If you only want to lock them out temporarily without losing their team memberships, remove them from every team they belong to (in the Teams tab). They keep the row but lose all access.

Either way, rotate `BETTER_AUTH_SECRET` if you suspect their session cookie was lifted - rotating the secret invalidates every cookie in flight, not just theirs.

## My satellite is offline. Will check results be lost?

The satellite buffers result messages locally and replays them when the connection is re-established. Short reconnections (the link flapped for a minute) lose nothing. Long reconnections (a satellite down for hours) eventually drop the oldest buffered messages once the in-memory buffer fills.

If a satellite is going down for a planned maintenance window longer than a few minutes, schedule a Checkstack maintenance window covering the systems it serves so missing results don't fire false alarms.

## Can I export historical check data?

Yes - the public REST API exposes the aggregated history endpoints. A SQL `COPY` against the `health_check_runs` and `health_check_aggregates` tables also works for one-off exports. See [Retention and limits](/checkstack/user-guide/reference/retention-and-limits/) for what's actually in each table.

## Does Checkstack call out to the internet?

The platform itself does not phone home. The only outbound calls are made by:

- **Plugin installs from npm / GitHub** - on demand, when you click Install.
- **Integration plugins** - when you wire one up (Jira, Slack, webhooks, ...).
- **Notification plugins** - when a notification fires.

Everything else is purely internal. You can run a fully offline install by pre-loading plugin tarballs via the **Tarball upload** tab in the Plugin Manager.

## Do I need TLS in front of Checkstack?

For any production deployment, yes. Sessions and API keys are bearer credentials; TLS is mandatory for confidentiality. The simplest setup is to terminate TLS at a reverse proxy (Caddy, Traefik, nginx) and point `BASE_URL` at the public `https://` URL. The platform itself does not terminate TLS - it expects to receive HTTP from the proxy.

## Where to go next

- [Configuration reference](/checkstack/user-guide/reference/configuration/) - every env var, with defaults.
- [Installation troubleshooting](/checkstack/user-guide/troubleshooting/installation/) - boot failures and `BASE_URL` issues.
- [Plugin troubleshooting](/checkstack/user-guide/troubleshooting/plugins/) - install, upgrade, uninstall failures.
- [Notification troubleshooting](/checkstack/user-guide/troubleshooting/notifications/) - when alerts don't arrive.
