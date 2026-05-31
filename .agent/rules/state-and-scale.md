# State management & horizontal scale

The platform runs as **N horizontally-scaled pods sharing one database**.
Design every piece of state accordingly. This rule exists because the test
suite runs in a single process and therefore **cannot** catch pod-local-state
bugs: a value written in one process is trivially visible to the same process,
so green typecheck/lint/tests do **not** prove scale-correctness.

## The question to ask of every stateful change

For any new or migrated stateful feature, answer all three explicitly (in the
PR description or the changeset):

1. **Where does the current state physically live?** (a Postgres table, a
   derivation of one, or process-local memory)
2. **Does a read return the same answer on every pod?** If a read can return a
   different answer on a different pod, it is a **bug**, regardless of passing
   tests.
3. **Is it duplicated anywhere?** Two writers of the same logical value is a
   code smell (see "Before reaching for framework-owned storage").

## Reactive entity state (`defineEntity`)

- A reactive entity's **current state must be globally readable**. Its `read`
  accessor MUST resolve from **shared, durable storage** (the plugin's own
  Postgres tables, or a derivation of them) - **never** from process-local /
  in-memory state. Scope enrichment and `wait_until` re-evaluation run on
  whichever pod claims the dispatch/wake job, so an in-memory source means a
  value written on pod A is invisible to pod B and the automation reads
  stale/empty state.
- **In-memory is allowed only for genuinely pod-local infrastructure that is
  never the queryable source of truth** - e.g. a live WebSocket/socket
  registry used to route messages to a connection physically held by *this*
  pod. The reactive entity's status is a separate, durable value. Mark the
  pod-local data `declareNonReactiveState({ reason: "bookkeeping" })`.
- **Change events are not a substitute for a global read.** Entity change
  events propagate cluster-wide via the event bus, so triggers and
  `onEntityChanged` consumers fire correctly even when the current-state read
  is pod-local and broken. Working triggers do **not** prove the read path is
  scale-correct - verify the read path separately.

## Before reaching for framework-owned storage

- Entities are plugin-backed: every `defineEntity` kind owns its storage (its
  own table, a computation over durable tables, or another shared-DB source).
  The framework owns only the `entity_transitions` history log, never a kind's
  current state. Do not reintroduce a generic framework-owned current-state
  store.
- Before declaring state "homeless", **verify no existing durable table already
  holds or can derive it** (an aggregates table, a bulk-state service, etc.).
  Prefer plugin-owned storage or compute-on-read over a materialized copy. A
  materialized cache of derivable data is denormalization - only introduce it
  for a measured reason, and never as the default.
