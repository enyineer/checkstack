---
"@checkstack/automation-backend": minor
---

Secrets platform Phase 5c: run-wide secret masking at the automation persistence choke point.

Every step writes `result_payload` / `error_message` (and the run writes a
run-level `error_message`) to `automation_run_steps` / `automation_runs`.
Previously only the script-action and satellite-collector output paths were
masked, so a provider HTTP error that embedded a resolved connection
credential could reach the run-detail UI unmasked.

Now the dispatch run accumulates every secret value it resolves
(`RunSecretRegistry`) by wrapping each run's `getService` so the secret
resolver (`resolveSecret` / `resolveForRun` / `resolveBySchema`) and the
connection store (`getConnectionWithCredentials`) register their resolved
values — least-privilege (only what this run resolved), in memory only,
dropped when the run goes terminal. The run-state store masks step + run
output with these values BEFORE persistence, so every downstream read / DTO
/ run-detail page is masked by construction across ALL actions. The
existing script / satellite-collector source-side masking is kept as
defense in depth.
