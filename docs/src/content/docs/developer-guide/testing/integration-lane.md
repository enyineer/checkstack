---
title: "Integration test lane"
description: "The default unit/fakes lane versus the env-gated real-Postgres/Redis integration lane, how to run each, and the five external-runtime seams the integration tests pin."
---

Tests run in two lanes. The default lane uses fakes and runs on every change; it covers all logic and happy paths and stays fast. A separate, surgical integration lane runs only against real Postgres and real Redis/BullMQ, gated behind an env flag, and asserts only the handful of external-runtime contracts that fakes cannot model. This split keeps the fast feedback loop fast while still pinning the seams where our code depends on real third-party semantics. Use bun's test runner for both, in line with [the project testing doctrine](/checkstack/developer-guide/testing/backend-utilities/).

## Unit lane (default, fakes)

The unit lane is the bulk of coverage: entity diff/emit/no-op behavior, wake-index reference extraction (every grammar shape plus the wildcard fallback), wake-index intersection lookups, Stage-1 routing, Stage-2 fan-out, condition evaluation, scope projection, secret masking, and each domain's change-deriver mapping. It uses fakes (no real database, queue, or network) so it runs anywhere with no services.

```bash
# Run the whole fast lane.
bun test

# Run one package's unit tests.
bun test core/automation-backend
```

The default `bun test` never touches a real service. Integration suites are wrapped in `describe.skipIf(!process.env.CHECKSTACK_IT)(...)`, so they are skipped unless the env flag is set.

## Integration lane (env-gated, real services)

The integration lane verifies our code against real third-party runtime semantics that fakes cannot reproduce: advisory-lock connection affinity, atomic claim races, `ON CONFLICT` arms, BullMQ consumer-group exactly-once delivery, and BullMQ stalled-job redelivery. It is intentionally a small, fixed set - it is not where new feature coverage goes.

Files use the `*.it.test.ts` convention and are gated behind `CHECKSTACK_IT=1`. Bring up Postgres and Redis with the dev compose file, which now includes a Redis service alongside Postgres:

```bash
docker compose -f docker-compose-dev.yml up -d postgres redis
```

Then run only the integration files with the flag set:

```bash
CHECKSTACK_IT=1 \
CHECKSTACK_IT_PG_URL=postgres://checkstack:checkstack@localhost:5432/checkstack \
CHECKSTACK_IT_REDIS_URL=redis://localhost:6379 \
bun test it.test
```

`CHECKSTACK_IT_PG_URL` and `CHECKSTACK_IT_REDIS_URL` default to the compose ports, so they can be omitted when running against the default dev compose. CI runs this as a separate `integration` job with Postgres and Redis service containers, kept distinct from the fast `test` job so the unit lane stays fast.

> [!NOTE]
> There is no half-fidelity middle tier (no pg-mem). A seam is either modeled by a fake in the unit lane or asserted against the real service in the integration lane.

## The five integration seams

The integration lane pins exactly these external-runtime contracts:

| Seam | File | Asserts |
|------|------|---------|
| Advisory-lock affinity + release | `core/backend-api/src/advisory-lock.it.test.ts` | Two `tryAcquire(sameKey)` on real Postgres: the first returns a handle, the second returns `null`; after `release()` a third succeeds; killing the holding connection auto-releases the lock. |
| Atomic dwell claim | `core/automation-backend/src/dispatch/dwell.it.test.ts` | Two concurrent `delete(id)` claims on real Postgres - exactly one returns a row (`RETURNING`), the other empty. |
| Wake-index ON CONFLICT race | `core/automation-backend/src/entity/wake-index.it.test.ts` | Concurrent inserts of the same `(waitLockId, ref)` under `ON CONFLICT DO NOTHING` yield exactly one row; the intersection lookup returns the wait. |
| BullMQ consumer-group exactly-once | `core/automation-backend/src/dispatch/stage1.it.test.ts` | Two workers, one `ENTITY_CHANGED` emit on real Redis/BullMQ - the handler runs exactly once. |
| BullMQ stalled redelivery | `core/automation-backend/src/dispatch/stage2-stalled.it.test.ts` | A Stage-2 worker that dies holding a job - after lock expiry another worker redelivers and completes it once. |

These back the durability model in [the reactive dispatch pipeline](/checkstack/developer-guide/backend/automations/reactive-dispatch/): the advisory-lock and claim-race seams guard idempotency, and the BullMQ seams guard exactly-once dispatch and crash recovery.
