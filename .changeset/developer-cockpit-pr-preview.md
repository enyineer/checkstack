---
"@checkstack/scripts": minor
---

Add the developer cockpit (`bun run dev`), an opentui-based terminal UI that
hosts the existing dev-run instance plus a new PR-preview flow.

PR preview merges one or more selected open PRs into a throwaway worktree, copies
the dev database into an ephemeral snapshot, and boots the merged app on random
free ports as a namespaced SECONDARY instance (`CHECKSTACK_INSTANCE_NAMESPACE`),
running alongside the normal dev instance without colliding on ports, database,
or shared redis. Nothing user-visible is suppressed - notifications,
integrations, AI and probes all run in the preview.

- Interactive: `bun run dev` opens on a home screen and auto-starts NOTHING;
  `1` starts/opens dev, `2` opens the PR-preview view (multi-select PRs), `s`
  stops the current instance without quitting the cockpit, `q` quits. Selecting
  text auto-copies it to the system clipboard.
- Non-interactive (agent-facing): `bun run preview:prs --prs 380,381`
  (`--fresh` to re-snapshot, `--wipe` to drop the copy).
- The preview instance boots against an isolated `CHECKSTACK_DATA_DIR` seeded
  from the dev instance's script-package store, so its startup reconcile reuses
  the already-built trees instead of a cold offline install.
- Generated-file merge conflicts (docs-index, sdk, lockfile) auto-resolve by
  regeneration; hand-authored conflicts stop and are reported.
- Each instance (dev and preview) has a full supervision panel: a process
  sidebar with status dots and unread-alert badges, a scrollable per-process log
  (Tab/Arrows to switch, Up/Down/PgUp/PgDn to scroll), a pinned alerts panel,
  `r` to restart the focused process, and a teardown overlay on quit.
- Swaps the renderer from ink to `@opentui/core` / `@opentui/react` (prebuilt
  native renderer, no Zig toolchain needed) and REMOVES the previous ink dev
  runner and its component kit - the cockpit is now the sole `bun run dev`.

The dev supervisor now supports per-process `env` overrides and injected process
defs (used by the preview instance), and `core/frontend`'s vite dev proxy target
is overridable via `CHECKSTACK_DEV_BACKEND_URL` (dev-only; inert by default).
