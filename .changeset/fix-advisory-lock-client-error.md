---
"@checkstack/backend-api": minor
---

Harden the advisory-lock service against holder-connection termination.

A session-level advisory lock is held on a dedicated checked-out pool client.
If that backend is terminated (admin kill, failover, network drop) while the
lock is held, `pg` emits an `'error'` on the client; with no listener attached
that error is re-thrown by the EventEmitter and crashes the pod. The service
now attaches an error listener to the held client so the loss degrades
gracefully - the session lock is auto-released server-side when the backend
dies, and the key simply becomes acquirable again.

Also de-flaked the advisory-lock integration test: it now terminates only the
lock-holding backend (found via `pg_locks`) instead of every backend in the
database - the old blanket kill also tore down the pool's idle connections,
whose async errors flaked the run and left the pool unusable.
