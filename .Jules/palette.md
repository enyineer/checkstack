## 2026-02-17 - Resolving CI Lockfile Corruption
**Learning:** Manually running `bun install` after modifying `resolutions` can produce a `bun.lock` file with duplicate keys or structure that `bun install --frozen-lockfile` (used in CI) rejects.
**Action:** When modifying global `resolutions` or `dependencies`, it's safer to fully clear `bun.lock` and `node_modules` before running `bun install` to ensure a clean, consistent lockfile generation.
