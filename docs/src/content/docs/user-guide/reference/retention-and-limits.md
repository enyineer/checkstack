---
title: "Retention and limits"
description: "How long Checkstack keeps health check data, what an operator can tune per system, and the hardcoded platform limits you cannot exceed."
---

Checkstack stores health check runs at three resolution tiers and rolls them up automatically. This page tells you what the defaults are, what you can change from the UI, and the platform-wide ceilings you cannot exceed.

If you are a developer adding a new strategy, see [Health check data management](/checkstack/developer-guide/backend/healthchecks/data-management/) for the internals.

## Health check storage tiers

Every health check run is written to one of three tables, with older data rolling up automatically:

| Tier | Backing table | Default retention | What it stores |
|------|---------------|-------------------|----------------|
| Raw | `health_check_runs` | 7 days | The full per-run payload (status, latency, strategy-specific result JSON) - the most detailed view. |
| Hourly | `health_check_aggregates` (bucket `hourly`) | 30 days | One row per check per hour with aggregated metrics (run counts, success rate, latency p95) plus the strategy's compact `aggregatedResult`. |
| Daily | `health_check_aggregates` (bucket `daily`) | 365 days | One row per check per day with the same metric set but no strategy-specific payload. |

Charts in the UI re-aggregate across tiers automatically when you zoom out, so the same view works for "the last hour" and "the last year".

## Per-system retention overrides

You can override the defaults per check assignment from the health-check editor. The override is stored alongside the assignment and validated against this schema:

```ts
const RetentionConfigSchema = z.object({
  rawRetentionDays: z.number().int().min(1).max(30).default(7),
  hourlyRetentionDays: z.number().int().min(7).max(90).default(30),
  dailyRetentionDays: z.number().int().min(30).max(1095).default(365),
});
```

| Setting | Min | Max | Default |
|---------|-----|-----|---------|
| `rawRetentionDays` | 1 | 30 | 7 |
| `hourlyRetentionDays` | 7 | 90 | 30 |
| `dailyRetentionDays` | 30 | 1095 (3 years) | 365 |

> [!IMPORTANT]
> The three values must strictly increase: `rawRetentionDays < hourlyRetentionDays < dailyRetentionDays`. Saving a configuration that violates this returns a `BAD_REQUEST`.

To reset an override back to the defaults, clear the retention block on the assignment (the RPC accepts `null`).

## Script health check limits

The Script plugin (shell scripts and inline TypeScript/JS run on the satellite) enforces a hardcoded execution-time ceiling per run:

| Field | Min | Max | Default |
|-------|-----|-----|---------|
| `timeout` (ms) | 100 | 300 000 (5 minutes) | 30 000 (30 seconds) |

The timeout applies to both shell and inline collectors. The platform kills the spawned subprocess when the timeout fires and records `timedOut: true` on the run. For more detail on the script plugin model see [Script health checks](/checkstack/user-guide/reference/script-health-checks/).

## Plugin install limits

Plugin tarballs uploaded through the Plugin Manager (or fetched from npm/GitHub) are size-capped:

| Limit | Value |
|-------|-------|
| Max plugin tarball size | 50 MB |

Uploads above this limit are rejected with HTTP 413 before any DB write. The same cap applies to the npm and GitHub installers.

## What you cannot change

The following ceilings are hardcoded in the platform and there is no env var or UI knob for them. Most of them exist to keep a single bad input from running the platform out of memory.

| Limit | Value | Where it lives |
|-------|-------|----------------|
| Max plugin tarball size | 50 MB | `MAX_TARBALL_SIZE_BYTES` in `core/backend` |
| Script timeout ceiling | 5 minutes | `executeConfigSchemaV2` in the script plugin |
| Daily retention ceiling | 1095 days | `RetentionConfigSchema` |
| Health check probe wait timeout | 30 s | `READY_WAIT_TIMEOUT_MS` for the boot gate on `/.checkstack/ready` |

## What you can tune at deploy time

| Setting | Where to change it |
|---------|--------------------|
| Logging verbosity | `LOG_LEVEL` env var (see [Configuration reference](/checkstack/user-guide/reference/configuration/)) |
| Queue backend (in-memory vs BullMQ) | Infrastructure settings UI |
| Cache backend | Infrastructure settings UI |
| Auth strategies | Authentication settings UI |
| Per-check schedule cadence | Health check editor per assignment |
| Per-check retention | Health check editor per assignment (see above) |

## Where to go next

- [Health check data management](/checkstack/developer-guide/backend/healthchecks/data-management/) for the aggregation pipeline internals.
- [Script health checks](/checkstack/user-guide/reference/script-health-checks/) for the script timeout in context.
- [Configuration reference](/checkstack/user-guide/reference/configuration/) for the env vars governing the surrounding services.
