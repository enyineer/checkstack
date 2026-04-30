---
"@checkstack/announcement-backend": patch
"@checkstack/gitops-backend": patch
"@checkstack/integration-backend": patch
"@checkstack/satellite-backend": patch
"@checkstack/slo-backend": patch
"@checkstack/theme-backend": patch
---

chore: add `drizzle-kit` as a dev dependency

Lets each backend package run `drizzle-kit generate` locally without
relying on the workspace-level binary. No runtime impact — devDeps
only.
