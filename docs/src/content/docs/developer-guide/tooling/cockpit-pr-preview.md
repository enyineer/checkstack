---
title: "Developer cockpit and PR preview"
description: "Run the local dev instance and preview one or more open PRs together as an isolated secondary instance from a single terminal UI."
---

The developer cockpit is the local dev entry point (`bun run dev`). It is a terminal UI, built on [opentui](https://opentui.com/), that hosts a home screen plus two instance views: the dev-run instance you already know, and a PR-preview flow that boots one or more merged PRs as an isolated secondary instance next to it. It lives in `core/scripts/src/cockpit/` and reuses the dev runner's headless supervision core.

## Views

- **Home**: the landing screen. Nothing starts automatically - the cockpit opens here and shows which instances are running. Press `1` or `2` to begin.
- **Dev** (`1`): the primary instance - docker deps, backend, and frontend - with a process sidebar (status dots + unread-alert badges), a scrollable per-process log, and a pinned alerts panel. Starts the dev servers on first open.
- **PR preview** (`2`): pick open PRs, merge them into a throwaway worktree, snapshot the dev database, and boot the merged app on random ports as a namespaced secondary instance - shown with the same full instance panel once running.

Switch views with `1` / `2`; return to Home with `Esc`. Stop the current instance (dev or preview) with `s` without leaving the cockpit - the other instance keeps running. Quit the whole cockpit with `q` (or `Ctrl-C`). Within a running instance, `Tab` / `←` `→` switch the focused process, `↑` `↓` / `PgUp` `PgDn` scroll its log (the title shows `(tail)` vs `(scrolled)`), and `r` restarts the focused process. Both instances keep running as you switch views, and quitting shows a teardown overlay while every child is stopped.

Because opentui captures the mouse for its own selection, the cockpit auto-copies any text you select to the system clipboard (via `pbcopy` / `wl-copy` / `xclip` / `clip`), so drag-to-select works as copy.

## How a preview is isolated

A preview runs concurrently with your dev instance and must not collide with it. Three things keep them apart:

- **Ports**: the preview backend and frontend bind random free ports (never the dev defaults 3000 / 5173). The frontend uses `--strictPort` so a residual collision fails loudly.
- **Database**: the dev database is copied into an ephemeral `checkstack_<namespace>` database (default `checkstack_preview`) inside the compose postgres. The preview runs against the copy; your dev data is untouched.
- **Shared infrastructure**: the preview sets `CHECKSTACK_INSTANCE_NAMESPACE`, so redis/BullMQ keys are namespaced per instance. See [Parallel instances and namespacing](/checkstack/developer-guide/architecture/parallel-instances/).

Nothing user-visible is suppressed - notifications, integrations, AI, and probes all run in the preview, so you can actually test them.

## Interactive use

```bash
bun run dev
```

From the home screen press `1` to start the dev instance or `2` to open the PR-preview view; select PRs (`Up`/`Down` to move, `Space` to toggle, `Enter` to start). Stop either instance with `s` (or leave both running) and quit with `q`. To reset the database copy, wipe it with `--wipe` or force a fresh snapshot with `--fresh`; otherwise the copy is reused across runs.

## Non-interactive use (agents / scripts)

When stdout is not a TTY the cockpit degrades to a plain streaming runner driven by flags. This is how an agent starts a preview:

```bash
# Preview specific PRs (snapshot kept on exit).
bun run preview:prs --prs 380,381

# Force a fresh snapshot before starting.
bun run preview:prs --prs 380,381 --fresh

# Wipe the ephemeral copy and exit.
bun run preview:prs --wipe
```

`--prs` is required in non-interactive mode; invalid or closed numbers produce an error listing the open PRs. The runner prints the preview frontend URL once it is up.

## Merge conflicts

Selected PRs are merged into the worktree in order. Conflicts in generated files (`docs-index`, the SDK, the lockfile) are auto-resolved by regenerating them. A hand-authored conflict stops preparation and is reported with the conflicting files, so you can resolve it deliberately rather than previewing a bad merge.

## Requirements

- The dev deps must be running (`bun run dev`, or `docker compose -f docker-compose-dev.yml up -d`) - the database copy is made inside the compose postgres container.
- `gh` must be installed and authenticated (the PR list comes from `gh pr list`).
