# Sentinel's Journal

## 2025-02-12 - [Critical] Leaked Server Secrets to Child Processes
**Vulnerability:** The application was passing `process.env` (containing sensitive secrets like `DATABASE_URL` and `BETTER_AUTH_SECRET`) to user-defined scripts executed via `Bun.spawn` in `healthcheck-script-backend` and `integration-script-backend`.
**Learning:** `Bun.spawn` (and `child_process.spawn`) by default inherits `process.env`. Explicitly passing `{ ...process.env, ...config.env }` ensures leakage of all secrets.
**Prevention:** Always use an allowlist of safe environment variables (e.g., `PATH`, `HOME`, `LANG`) when spawning child processes. Never pass `process.env` directly unless absolutely necessary and safe.

## 2025-02-13 - [Medium] Missing Security Headers in Hono Middleware
**Vulnerability:** Core backend responses were missing basic security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`), increasing risk of clickjacking and MIME sniffing.
**Learning:** In Hono (and many async middleware frameworks), response headers must be set **before** `await next()` to ensure they are applied even if downstream handlers fail or short-circuit. Setting them after `await next()` can result in headers being missed on error responses.
**Prevention:** Use a custom middleware that sets headers on the context (`c.header(...)`) immediately upon entry, before delegating to the next handler.
