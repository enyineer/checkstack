---
"@checkstack/test-utils-frontend": patch
---

Register RTL cleanup at root scope so it applies to every frontend test file

`setup.ts` registers `afterEach(cleanup)` at module scope. That is correct when
the module is PRELOADED - a preload's hooks land at the process root and apply
to every file in the run - which is how `core/ui/bunfig.toml` uses it.

It silently does NOT work when a test file merely imports the setup. The module
is evaluated once per process, so the hook is scoped to whichever file imported
it FIRST; every later frontend file in that process runs with no cleanup at all
and its renders accumulate in `document.body` for the rest of the run.

The repo-root run is exactly that configuration. CI tests each workspace package
with a root-cwd `bun test <files>`, which reads the root bunfig - and that
preloaded only the backend file. Meanwhile
`bun run --filter @checkstack/ui test` (package bunfig preloads the setup) and
`bun run test` (`run-tests.ts` isolates `.tsx` files) both stayed green, so
every path a developer normally runs masked it.

Nothing fails at the leak site; the damage lands on an unrelated file whose
query happens to match two elements. `Tabs.test.tsx` renders the same two tab
labels five times and was first to collide, failing with "Found multiple
elements with the role tab" only in the repo-root run while passing on its own -
and blaming whichever file happened to leak into it.

A new `root-preload.ts`, added to the root bunfig, registers the hook where it
actually applies regardless of import order. Every test process in the repo
loads it, so it must cost nothing without a DOM: the `document` check
short-circuits BEFORE the dynamic import, so a backend process never pulls in
react-dom or testing-library. Running alongside `setup.ts`'s own hook in
package-scoped runs is harmless, since `cleanup()` is idempotent.

This is the companion to the earlier idempotent-Happy-DOM-registration fix: that
one made the direct-import path safe to LOAD, this one makes it actually clean
up.
