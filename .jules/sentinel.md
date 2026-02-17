# Sentinel's Journal

## 2025-02-12 - [Critical] Leaked Server Secrets to Child Processes
**Vulnerability:** The application was passing `process.env` (containing sensitive secrets like `DATABASE_URL` and `BETTER_AUTH_SECRET`) to user-defined scripts executed via `Bun.spawn` in `healthcheck-script-backend` and `integration-script-backend`.
**Learning:** `Bun.spawn` (and `child_process.spawn`) by default inherits `process.env`. Explicitly passing `{ ...process.env, ...config.env }` ensures leakage of all secrets.
**Prevention:** Always use an allowlist of safe environment variables (e.g., `PATH`, `HOME`, `LANG`) when spawning child processes. Never pass `process.env` directly unless absolutely necessary and safe.
