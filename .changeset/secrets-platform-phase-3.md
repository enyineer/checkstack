---
"@checkstack/satellite-common": minor
"@checkstack/satellite-backend": minor
"@checkstack/satellite": minor
"@checkstack/backend-api": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-script-backend": minor
---

Secrets platform Phase 3: just-in-time secret delivery to satellites + source-side masking, and central-execution injection for healthcheck collectors.

- New satellite WS messages `request_run_secrets` / `run_secrets`: just
  before a satellite runs a collector that declares a `secretEnv`, it asks
  core for that collector's resolved env; core resolves ONLY the secrets the
  collector's OWN persisted assignment declares (least-privilege — the
  satellite cannot choose) and replies with the env map (or a clear error).
  The satellite injects it memory-only for the run and drops it on
  completion. Secrets never ride the persisted assignment and never touch
  disk.
- Source-side masking: the satellite runs `maskSecrets` over the collector's
  stdout/stderr/result/error using the run's delivered values BEFORE the
  result leaves the satellite (defense in depth).
- `CollectorStrategy.execute` gains an optional `secretEnv`. The
  inline-script and shell collectors inject it into the runner
  (`process.env` / `$VAR`) and mask the values out of their output.
- Healthcheck collectors running centrally (the queue executor) also resolve
  + inject `secretEnv` via `secretResolverRef`, closing the gap where a
  centrally-run secretEnv collector got no secrets. A missing required
  secret fails the run clearly in all paths.
