# Tool: developer cockpit + PR preview

The **developer cockpit** (`bun run dev`) is the local dev entry point. It hosts
two views: the **dev-run** instance (deps + backend + frontend, as before) and
**PR preview**, which merges one or more open PRs into a throwaway worktree,
copies the dev database, and boots the merged app as a **namespaced secondary
instance** on random ports - running ALONGSIDE the normal dev instance without
clashing. It is built on `@opentui/react` and lives in
`core/scripts/src/cockpit/`.

Namespacing (not suppression) is what makes this safe: the preview instance sets
`CHECKSTACK_INSTANCE_NAMESPACE`, so shared infrastructure (redis/BullMQ keys) is
isolated per instance. See
[`parallel-instances`](../../docs/src/content/docs/developer-guide/architecture/parallel-instances.md)
and the RRB [`dependencies`](./dependencies.md) rules. Nothing user-visible is
suppressed - notifications, integrations, AI and probes all run in the preview.

## When to offer a preview (agent behaviour)

After you finish a PR (branch pushed, PR opened), **check for other open PRs**
and offer to preview this PR together with them:

```bash
gh pr list --state open --json number,title,headRefName
```

- If there ARE other open PRs, ask the user whether they want to preview the new
  PR together with any of them.
- If the user names PRs in natural language ("preview 380 and 381", "test this
  with the mass-actions PR"), resolve the numbers and START the preview
  non-interactively (below). Do NOT open the interactive TUI on the user's
  behalf - you cannot drive it.
- If the user wants a preview but does not specify which PRs, tell them to run
  `bun run dev` and pick PRs in the cockpit's PR-preview view (they drive the
  interactive selection themselves). The cockpit opens on a home screen and
  auto-starts NOTHING: `1` starts/opens dev, `2` opens PR preview, `s` stops the
  current instance without quitting, `q` quits.

## Driving the preview from the CLI (non-interactive)

The cockpit degrades to a plain streaming runner when stdout is not a TTY, so it
is agent-drivable via flags. Run it in the BACKGROUND (it is long-lived):

```bash
# Start a preview of specific PRs (plain streaming; snapshot kept on exit).
bun run preview:prs --prs 380,381

# Force a fresh db snapshot before starting.
bun run preview:prs --prs 380,381 --fresh

# Wipe the ephemeral preview database and exit (no start).
bun run preview:prs --wipe
```

- `--prs <numbers>` is REQUIRED in non-interactive mode (there is no picker).
  Invalid/closed numbers produce a clear error listing the open PRs.
- The preview backend/frontend serve on random free ports; the runner prints the
  frontend URL (`http://localhost:<port>`).
- The db copy (`checkstack_<namespace>`, default `checkstack_preview`) is
  EPHEMERAL and REUSED across runs. It is KEPT across runs; wipe it explicitly
  with `--wipe`, or re-snapshot with `--fresh` (both apply interactively and
  non-interactively).
- Requires the dev deps running (`docker compose -f docker-compose-dev.yml up -d`
  or a running `bun run dev`) since the copy is made inside the compose postgres.

## Guarantees to rely on

- The preview NEVER collides with the running dev instance: distinct ports,
  distinct database copy, and a distinct instance namespace for shared redis.
- Merge conflicts in generated files (`docs-index`, sdk, lockfile) auto-resolve
  by regeneration; a hand-authored conflict stops preparation and is reported so
  the user can resolve it deliberately.
