---
"@checkstack/script-packages-backend": minor
"@checkstack/script-packages-frontend": minor
---

Fix two Script Packages bugs: empty-allowlist installs and read-only Advanced settings.

- Install now: clicking "Install now" with no enabled packages no longer fails with ENOENT and an `error` install state. With an empty dependency set `bun install` writes no `bun.lock`, so the central resolver previously threw reading it. The resolver now short-circuits an empty (or all-disabled) allowlist to an empty resolved set, ending the install in `ready` at 0.0 MB with the deterministic empty-lockfile hash. No subprocess or registry call is made in that case.
- Advanced settings: the registry URL, "ignore install scripts" toggle, write-only auth token, size guardrail thresholds, and active storage backend are now editable in the Script Packages settings page (previously read-only displays) and wired to the existing `setRegistryConfig` / `setSizeCapConfig` / `setStorageBackend` mutations. The auth-token field is write-only: a blank field leaves the stored token untouched, and a "Clear token" action removes it. The destructive blob-migration flow is unchanged.

No schema or RPC contract changes.
