# Typechecking & project references

Typechecking runs as a single `tsgo -b` from the repo root, driven by
**TypeScript project references** wired up between every workspace
package. The references arrays in each `tsconfig.json` and the root
solution `tsconfig.json` are **generated** from `package.json` deps —
they are NOT hand-edited.

## When you MUST run `bun run typecheck:references:generate`

Run it (and commit the resulting tsconfig changes) whenever you:

1. **Add** a `@checkstack/*` workspace dependency to any `package.json`
   (`dependencies` or `devDependencies`).
2. **Remove** a `@checkstack/*` workspace dependency from any `package.json`.
3. **Create** a new workspace package (under `core/` or `plugins/`).
   `bun run create` runs the generator for you, but if you scaffold a
   package by hand, run it yourself.
4. **Rename** or **delete** a workspace package.

If you skip this step, CI fails on the
`typecheck:references:check` job and `bun run typecheck` will either
skip the new package or fail to find its types.

## Workflow for typical edits

```bash
# 1. Add a workspace dep
#    edit some/package/package.json → add "@checkstack/foo": "workspace:*"

# 2. Refresh the references graph
bun run typecheck:references:generate

# 3. Verify
bun run typecheck
```

## What NOT to do

- Do NOT hand-edit `references` arrays in any `tsconfig.json` — your
  edits will be overwritten on the next generator run. If a reference
  needs to be excluded (e.g. to break a cycle), do it in the dep graph
  via `package.json`, not in the tsconfig.
- Do NOT run `bun run typecheck:clean` as part of normal work — it
  wipes `.tsbuild/` and forces a ~12s cold rebuild. It's only for
  diagnosing stale-cache issues.
- Do NOT add `tsc --noEmit` to a new package's scripts — use
  `tsgo -b`. The shared tsconfigs in `@checkstack/tsconfig` are already
  set up for project references; new packages just need to extend the
  appropriate one (`backend.json`, `frontend.json`, or `common.json`).
