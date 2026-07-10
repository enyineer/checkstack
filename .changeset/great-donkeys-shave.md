---
"@checkstack/ai-backend": patch
---

Regenerate the assistant's docs index to cover the new security-maintenance
content: Renovate `lockFileMaintenance`, the `bunfig.toml` supply-chain
cooldown, why the lockfile PR needs a changeset to rebuild the production
image, and the PR-time split between the dependency-graph gate
(`security_deps`, full npm graph incl. devDependencies) and the container gate
(`security`, OS/apk packages only).
