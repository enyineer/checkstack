# Engineering roadmap — deferred items & future work

Living list of work intentionally deferred (with rationale), so it is not lost.
Internal forward-reference, co-located with `.agent/plans/`. Promote an item to a
full plan under `.agent/plans/` when it's picked up. Some items are test-coverage
gaps; keep them here rather than in published `docs/` so we don't hand out a
"where coverage is thin" map.

Last updated: 2026-05-31.

---

## Testing & infrastructure

### Tier-2 real-infrastructure test harness (HIGH value, deferred)

> **Update 2026-05-31:** folded into `.agent/plans/reactive-automation-engine.md`
> as a **surgical** real-services integration lane (real Postgres pool + real
> Redis/BullMQ, env-gated, ~5 boundary tests only). pg-mem was evaluated and
> **rejected** (no advisory-lock / multi-connection / MVCC fidelity — it would
> recreate the false-green). The reactive re-architecture makes this lane a
> prerequisite, not a deferral. The notes below remain the rationale.

**What:** an integration-test harness that runs the multi-instance correctness
code against **real Postgres** (and, as a stretch, **real Redis/BullMQ**) instead
of the in-memory fakes the unit suite uses today.

**Why it matters (the fidelity gap):** every horizontal-scale invariant on the
automation + script-packages + secrets work is currently tested with hand-written
in-memory fakes. Those fakes *encode the assumption under test*, so they validate
our **logic** but cannot catch a bug in the **primitive's real semantics**. We
already shipped one such bug and caught it by **reading, not testing**:
the advisory lock was acquired on one pooled DB connection and released on a
*different* one (`pg_advisory_unlock` no-ops off-session), so the lock leaked — a
`Map`-based fake that doesn't model connection pooling cannot surface it. The
work-queue "exactly-once across pods" guarantee has **zero** primitive-level
coverage (the in-memory queue has no consumer-group semantics at all).

**Invariants this harness would cover (and which are blind today):**
- Advisory-lock connection affinity + release under a real `pg.Pool` — the
  load-bearing primitive for ~6 invariants: installer election, blob-GC vs
  install/migration mutual exclusion, per-run resume lock, single migration
  resumer on boot, incident `dedupe_open_for_system`, and the `single`-mode
  concurrency check+create lock. One real-pool test guards all of them.
- `DELETE … RETURNING` atomic claim (dwell fire) and `pg_advisory_xact_lock`
  under **two genuinely concurrent transactions** (not `Promise.all` on one event
  loop, which is cooperative single-threaded and can't expose a lost-update/MVCC
  bug).
- The dwell partial-unique-index `(automationId, triggerId, contextKey)` arm race
  (`ON CONFLICT DO NOTHING` + re-read) under real MVCC.
- **Work-queue single-consumer / exactly-once trigger delivery across pods**
  (real BullMQ + Redis, two consumer processes in one `workerGroup`) — the one
  invariant with no possible in-memory proxy.

**How to build it:**
- New test category, e.g. `*.it.test.ts`, env-gated (reuse the existing
  `CHECKSTACK_E2E_*` flag convention, see
  `plugins/integration-script-backend/src/run-script-packages-e2e.test.ts`) so the
  fast `bun test` unit lane stays Docker-free.
- Postgres: lowest-friction first step is a real `pg.Pool` against the existing
  `docker-compose-dev.yml` Postgres; testcontainers-postgres is cleaner for CI
  isolation. Use `max < concurrent callers` to force connection reuse so affinity
  bugs surface.
- Redis/BullMQ: add a Redis service to `docker-compose-dev.yml`; run two consumer
  processes in the same group; assert exactly one processes a single emitted
  trigger.
- A dedicated CI job with those services (the unit lane does not run it).

**Recommended order (highest value first):** (1) real-`pg.Pool` advisory-lock
test, (2) real-BullMQ single-consumer test. (1) alone catches the H2 bug class for
~6 invariants.

**Reference:** the full gap matrix + tier breakdown is in the
horizontal-scale coverage audit (2026-05-31). Tier-1 logic tests + the L2 cross-pod
masking fix already landed on the integration branch.

---

## Feature follow-ups

### 4b — satellite-direct-Vault resolution (deferred, user-confirmed)

Today secrets are **core-mediated**: core resolves a run's allowlisted secrets
just-in-time and pushes them to the satellite over the encrypted WS channel
(memory-only, never persisted). The deferred mode lets a satellite resolve from
Vault **directly** using its own OIDC/AppRole identity, for topologies where the
satellite can reach Vault but not core. Not needed while core mediates (the
resolver already routes through whichever backend is active, including Vault);
adds attack surface + per-satellite identity management. Pick up only if a
core-unreachable-but-Vault-reachable deployment appears.

### L5 — `sweepWaitUntilLocks` re-ticks every lock each cycle (perf)

> **Update 2026-05-31:** obviated by the reactive engine
> (`.agent/plans/reactive-automation-engine.md`) — `wait_until` becomes
> event-woken with no poll re-check, so the condition-re-tick sweep this describes
> goes away entirely. Kept here only until that plan lands.

`sweepWaitUntilLocks` (`core/automation-backend/src/dispatch/stalled-sweeper.ts`)
re-evaluates **every** `until` wait lock on every pod every 30s with no staleness
filter, each running `enrichScopeWithState` (a health-check round-trip) — an
`O(pods × until-runs)` redundant load on the health service. Correctness is fine
(advisory lock + delete-before-resume); this is purely a load optimization. Fix:
add a `lastCheckedAt` to wait locks and have `findWaitLocksByKind('until')` return
only locks not re-checked within the queue's normal poll interval, so the backstop
sweeps only genuinely-overdue locks.

---

## Cleanup migrations (drop dead tables after one release)

Several tables were intentionally **kept as backup for one release** during cutovers
and should be dropped in a follow-up migration once a release has shipped clean:
- `webhook_subscriptions` and `delivery_logs` — superseded by the automation
  platform (legacy integration subscription model).
- `health_check_auto_incidents` — superseded by the auto-incident → default-automation
  cutover (no longer written or read).
- The GitOps `plugin_gitops.secrets` source table — after the secrets-platform
  promotion migration (`0001_promote_gitops_secrets`) has shipped and been verified;
  it is copied-not-moved today (idempotent, source intentionally not dropped).

Also: the now-unused `createAutoIncident` / `resolveAutoIncident` RPCs on
`incident-backend` (left in place to limit blast radius during the auto-incident
cutover) can be removed in a surface-cleanup pass.

---

## Maintenance notes

### Hermetic Feature-1 e2e fixture (Bun version coupling)

The network-free script-packages import test
(`plugins/integration-script-backend/src/run-script-packages-fixture.ts`) vendors a
`leftpad@0.0.1` Bun **cache-entry** blob captured with Bun 1.3.6. If a future Bun
**major** changes the offline-reconstruct cache format, the fixture may need
regenerating — regeneration steps are documented in that file. The live-network
e2e (env-gated) is the cross-check.

### `--ignore-scripts` admin toggle (security posture, user-confirmed)

`--ignore-scripts` for the central `bun install` is default-ON but **admin-toggleable**
(per locked decision). An admin can turn it off and re-enable install-time lifecycle
scripts (RCE vector) — it's `script-packages.manage`-gated. If the threat model ever
tightens, consider hard-pinning it on (or gating the off-switch behind an ops/env
flag rather than a normal admin toggle).

---

## Docs follow-ups

> The `secret-field.ts` unification (secrets-common canonical, gitops-common
> re-exports) and the broken-link repair (~24 internal `/checkstack/...` links
> across the site) are **DONE** - landed in this PR.

- **Write the referenced-but-missing pages.** The link repair found three
  cross-references pointing at pages that were never written (now de-linked, link
  text kept): a backend **Health & readiness** guide, a **Monorepo tooling / CLI
  scaffolding** guide (referenced from several plugin docs), and a **UI component
  library** page (was pointing at the `core/ui` source README). Write these, then
  restore the references.
- **Add a CI doc-link checker.** The ~24 broken links were path drift after doc
  moves with nothing to catch them. A link-integrity check wired into
  `.github/workflows/pr-checks.yml` would prevent regression.

## Known minor edges (documented, no action needed unless they recur)

- **Resume-vs-recover lock race (self-healing):** if `recoverStalledRun` and
  `resumeRun` race for the same `runId`, the recover path can grab the per-run
  advisory lock, no-op (run no longer `waiting`), while the resume bails on the held
  lock — a theoretical single missed resume that self-heals via the next wake/sweep
  retry. Faithful to production ordering (the sweeper filters to `running` runs and
  runs the wait-aware paths first, so it doesn't compete for a `waiting` run's lock
  in practice). Revisit only if a stuck-after-race report appears.
