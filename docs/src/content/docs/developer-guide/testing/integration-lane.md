---
title: "Integration test lane"
description: "The default unit/fakes lane versus the env-gated real-Postgres/Redis integration lane, how to run each, and when to reach for withTestDb instead of createMockDb."
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

The integration lane verifies our code against a real database and queue. It holds two kinds of test: a small, fixed set of external-runtime seam tests (advisory-lock connection affinity, atomic claim races, `ON CONFLICT` arms, BullMQ consumer-group exactly-once delivery, and BullMQ stalled-job redelivery), plus query-correctness tests that exercise risk-bearing SQL against real Postgres via `withTestDb()` (see [createMockDb versus withTestDb](#createmockdb-versus-withtestdb)). It is still not a dumping ground for ordinary branch-logic coverage - that belongs in the fast unit lane.

A few `*.it.test.ts` suites need a real container runtime rather than Postgres/Redis. The container health check's `container-proxy.it.test.ts` stands up the real `lscr.io/linuxserver/socket-proxy` in front of the host Docker socket and drives the strategy through it, asserting both that reads work and that the read-only `POST=0` proxy blocks a write. It is gated on `CHECKSTACK_IT` **and** a live Docker daemon (`describe.skipIf(!process.env.CHECKSTACK_IT || !dockerAvailable)`), so it runs in the same `integration` CI job (whose `ubuntu-latest` runner has Docker) and skips cleanly anywhere Docker is absent.

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

## createMockDb versus withTestDb

The integration lane hosts two kinds of test, both gated behind `CHECKSTACK_IT=1`:

- **External-runtime seam tests** pin third-party semantics fakes cannot model (advisory locks, claim races, BullMQ delivery). These are the fixed set in the table below.
- **Query-correctness tests** pin SQL whose correctness is the risk: case-insensitive uniqueness lookups, team/visibility scoping, window-overlap predicates, joins, and aggregations.

Most service tests stay in the unit lane with [`createMockDb()`](/checkstack/developer-guide/testing/backend-utilities/), which returns canned results for the common chainable Drizzle shapes. That proves the caller's branch logic, but it never executes the `where`/`join`/`order` against a database, so it cannot prove the SQL selects the right rows. When the query itself is the risk, reach for `withTestDb()` instead.

`withTestDb()` (in [`core/test-utils-backend/src/with-test-db.ts`](/core/test-utils-backend/src/with-test-db.ts)) provisions an isolated, migration-fresh Postgres schema and returns a typed `SafeDatabase` bound to it. Each call creates a uniquely named throwaway schema, runs the package's Drizzle migrations into it, and tears everything down on `dispose()`. Wrap the suite in `describe.skipIf(!isIntegrationEnabled())(...)` so the default `bun test` never tries to reach a database (the helper also throws if `CHECKSTACK_IT` is unset, so a misconfigured suite fails loudly instead of hitting a developer's working DB).

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  isIntegrationEnabled,
  withTestDb,
  type TestDb,
} from "@checkstack/test-utils-backend";
import * as schema from "./schema";
import { MyService } from "./service";

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

describe.skipIf(!isIntegrationEnabled())("MyService (real Postgres)", () => {
  let testDb: TestDb<typeof schema>;
  let service: MyService;

  beforeAll(async () => {
    testDb = await withTestDb({ schema, migrationsFolder });
    service = new MyService(testDb.db);
  });

  afterAll(async () => {
    await testDb.dispose();
  });

  it("scopes the lookup to the right rows", async () => {
    await testDb.db.insert(schema.things).values({ id: "a", name: "Api" });
    // A case-insensitive lookup must collide with a differently-cased name.
    expect((await service.getByName("api"))?.id).toBe("a");
  });
});
```

Reference query-correctness suites:

| Suite | File | Asserts |
|-------|------|---------|
| Catalog entity scoping | `core/catalog-backend/src/services/entity-service.it.test.ts` | Case-insensitive `getSystemByName`, and the compound `(id AND systemId)` scoping that stops a manager of one system from deleting another system's contact/link. |
| SLO downtime window | `core/slo-backend/src/service.it.test.ts` | The `getDowntimeForWindow` overlap predicate (in-window clamping, `includeOpen` toggle, objective scoping) and the attribution-scoped open-event filters. |

## The five external-runtime seams

The seam tests pin exactly these external-runtime contracts:

| Seam | File | Asserts |
|------|------|---------|
| Advisory-lock affinity + release | `core/backend-api/src/advisory-lock.it.test.ts` | Two `tryAcquire(sameKey)` on real Postgres: the first returns a handle, the second returns `null`; after `release()` a third succeeds; killing the holding connection auto-releases the lock. |
| Atomic dwell claim | `core/automation-backend/src/dispatch/dwell.it.test.ts` | Two concurrent `delete(id)` claims on real Postgres - exactly one returns a row (`RETURNING`), the other empty. |
| Wake-index ON CONFLICT race | `core/automation-backend/src/entity/wake-index.it.test.ts` | Concurrent inserts of the same `(waitLockId, ref)` under `ON CONFLICT DO NOTHING` yield exactly one row; the intersection lookup returns the wait. |
| BullMQ consumer-group exactly-once | `core/automation-backend/src/dispatch/stage1.it.test.ts` | Two workers, one `ENTITY_CHANGED` emit on real Redis/BullMQ - the handler runs exactly once. |
| BullMQ stalled redelivery | `core/automation-backend/src/dispatch/stage2-stalled.it.test.ts` | A Stage-2 worker that dies holding a job - after lock expiry another worker redelivers and completes it once. |

These back the durability model in [the reactive dispatch pipeline](/checkstack/developer-guide/backend/automations/reactive-dispatch/): the advisory-lock and claim-race seams guard idempotency, and the BullMQ seams guard exactly-once dispatch and crash recovery.
