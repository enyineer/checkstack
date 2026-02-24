# Sentinel's Journal

## 2025-02-12 - [Critical] Leaked Server Secrets to Child Processes
**Vulnerability:** The application was passing `process.env` (containing sensitive secrets like `DATABASE_URL` and `BETTER_AUTH_SECRET`) to user-defined scripts executed via `Bun.spawn` in `healthcheck-script-backend` and `integration-script-backend`.
**Learning:** `Bun.spawn` (and `child_process.spawn`) by default inherits `process.env`. Explicitly passing `{ ...process.env, ...config.env }` ensures leakage of all secrets.
**Prevention:** Always use an allowlist of safe environment variables (e.g., `PATH`, `HOME`, `LANG`) when spawning child processes. Never pass `process.env` directly unless absolutely necessary and safe.

## 2025-02-12 - [Critical] Command Injection in Disk Collector
**Vulnerability:** The `DiskCollector` plugin was constructing shell commands using unsanitized user input (`config.mountPoint`) via string interpolation: ``client.exec(`df -BG ${config.mountPoint} | tail -1`)``. This allowed attackers to inject arbitrary shell commands (e.g., `/; rm -rf /`).
**Learning:** Even internal plugins processing seemingly harmless configuration like "mount points" must validate input rigorously before passing it to `exec` or `spawn`. Zod schemas provide a first line of defense, but runtime checks immediately before execution are critical for defense-in-depth.
**Prevention:** Always validate inputs destined for shell commands against a strict allowlist regex (e.g., `^[\w/.-]+$`). Prefer `spawn` with argument arrays over `exec` with shell strings whenever possible to bypass shell interpretation entirely.
