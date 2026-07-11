---
"@checkstack/scripts": patch
---

Install dependencies from the lockfile before starting the dev instance in the
developer cockpit. Selecting "1 Dev" now runs `bun install --frozen-lockfile`
with streamed progress before booting deps + backend + frontend, so pulling a
Renovate lock-file refresh no longer leaves you running against a stale
`node_modules`. The PR-preview flow (option 2) already installs its own merged
worktree, so it is unchanged.
