# Testing

We want to use test-driven development for all code which is written in this project.

ALWAYS use bun's test runner (https://bun.com/docs/test) when writing unit tests.

NEVER write code that is untested, except for really small utility functions that don't need testing.

## Running the suite: ALWAYS use `bun run test`, NEVER bare `bun test`

Run tests through the project script — `bun run test` (which runs
`scripts/run-tests.ts`) — **never `bun test` directly**.

**Why:** a bare `bun test` globs in the whole repo, including the integration
lane (`*.it.test.ts`, gated behind `CHECKSTACK_IT`) and the Playwright e2e specs
(`core/e2e`). Those need live services (Postgres, Redis, a running app) that a
normal dev/CI unit run does not have, so `bun test` reports dozens of spurious
failures and errors that have nothing to do with your change — a misleading red
that hides real regressions. `run-tests.ts` excludes those two lanes and also
groups files to contain the global-mutation / module-mock leakage that Bun's
shared-process runner would otherwise spread between files.

- **Full unit suite:** `bun run test`.
- **A subset / single file:** extra args pass through to `bun test`, so
  `bun run test path/to/file.test.ts` or `bun run test <name-pattern>` still goes
  through the safe harness. Prefer this over `bun test path/...`.
- **Integration lane** (only when you specifically mean to, and have the services
  up): it runs under `CHECKSTACK_IT=1` — do not reach for it as part of a normal
  "run the tests" step.

If you see a large number of failures in `*.it.test.ts` / `core/e2e` files, you
almost certainly ran `bun test` by mistake — re-run with `bun run test`.
