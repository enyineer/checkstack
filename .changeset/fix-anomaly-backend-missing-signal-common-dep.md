---
"@checkstack/anomaly-backend": patch
"@checkstack/frontend-api": patch
---

Add missing workspace/runtime deps that were only resolving locally via stale `node_modules` symlinks: `@checkstack/signal-common` in `anomaly-backend` and `@orpc/contract` in `frontend-api`. Both were imported as `import type` and went unflagged by the `no-extraneous-runtime-deps` rule, but failed `tsc` on clean CI installs.
