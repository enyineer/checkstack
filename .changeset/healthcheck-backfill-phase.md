---
"@checkstack/healthcheck-backend": patch
---

Run the config-secrets backfill in afterPluginsReady instead of init.
Health-check strategies contributed by other plugins register during THEIR
init, and plugin init order follows the service-ref graph, so running the
backfill during healthcheck's own init could scan configurations before a
contributor (e.g. logstream's health strategy) had registered - skipping
that strategy's config with a "strategy not registered" warning at boot.
Only afterPluginsReady guarantees a complete registry. The backfill is
idempotent, so any configuration skipped by an earlier boot is picked up
on the next one.
