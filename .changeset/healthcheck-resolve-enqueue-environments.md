---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
---

Expose health check environment resolution to cross-plugin callers via a new
`resolveEnqueueEnvironments({ configId, systemId })` procedure. It returns the
effective environment ids a one-off run should enqueue for (or `[null]` for an
env-less system) - the same fan-out the `run_now` automation and the recurring
scheduler use. Gated by any healthcheck read capability (`typeScoped` read),
consistent with the other utility reads.

This lets a cross-plugin health trigger enqueue exactly the environment slices
the run executor accepts. Previously such a caller could only enqueue an env-less
run (`environmentId: null`), which the executor drops as stale for a system that
has effective environments - so the trigger was a silent no-op for env-assigned
systems. The log-stream fast-path health trigger is the first consumer (covered
by the existing log streams changeset).
