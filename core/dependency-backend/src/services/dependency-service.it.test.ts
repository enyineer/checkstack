/**
 * Integration test (real Postgres) for the DependencyService write layer.
 *
 * These pin the persisted RESULTS of the set-based query rewrites whose
 * correctness a fake db cannot prove: the per-rule insert loop in
 * `createDependency` / `updateDependency` collapsed into ONE multi-row insert,
 * and `saveNodePositions`' delete-then-N-inserts collapsed into a single
 * multi-row insert under one transaction. The suite asserts the rows actually
 * written match the pre-rewrite behaviour (every rule / position persisted,
 * replace-all semantics intact) and that `createDependency`'s wrapped
 * cycle-detection still rejects a would-be cycle.
 *
 * Gated behind `CHECKSTACK_IT=1` (via `isIntegrationEnabled()`), so the default
 * `bun test` lane skips the whole suite. The `integration` CI job sets the flag
 * and provides a Postgres service container; the connection comes from
 * `CHECKSTACK_IT_PG_URL`. See `core/test-utils-backend/src/with-test-db.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  isIntegrationEnabled,
  withTestDb,
  type TestDb,
} from "@checkstack/test-utils-backend";
import * as schema from "../schema";
import { dependencyHealthCheckRules, nodePositions } from "../schema";
import { DependencyService } from "./dependency-service";

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "drizzle",
);

describe.skipIf(!isIntegrationEnabled())(
  "DependencyService (real Postgres)",
  () => {
    let testDb: TestDb<typeof schema>;
    let service: DependencyService;

    beforeAll(async () => {
      testDb = await withTestDb({ schema, migrationsFolder });
      service = new DependencyService(testDb.db);
    });

    afterAll(async () => {
      await testDb.dispose();
    });

    /** Read the raw rule rows for a dependency, keyed for order-free asserts. */
    async function rawRules(dependencyId: string) {
      const rows = await testDb.db
        .select()
        .from(dependencyHealthCheckRules)
        .where(eq(dependencyHealthCheckRules.dependencyId, dependencyId));
      return rows.map((r) => ({
        dependencyId: r.dependencyId,
        healthCheckId: r.healthCheckId,
        environmentId: r.environmentId,
        overrideImpactType: r.overrideImpactType,
      }));
    }

    describe("createDependency multi-row rule insert", () => {
      it("persists every health-check rule (loop → one multi-row insert)", async () => {
        const source = `sys-${crypto.randomUUID()}`;
        const target = `sys-${crypto.randomUUID()}`;

        const created = await service.createDependency({
          sourceSystemId: source,
          targetSystemId: target,
          impactType: "degraded",
          transitive: false,
          healthCheckRules: [
            { healthCheckId: "hc-1", environmentId: null, overrideImpactType: "critical" },
            { healthCheckId: null, environmentId: "env-1", overrideImpactType: "degraded" },
            { healthCheckId: "hc-2", environmentId: "env-2", overrideImpactType: "informational" },
          ],
        });

        // The returned shape reflects all three rules...
        expect(created.healthCheckRules).toHaveLength(3);
        // ...and so does what actually landed in the table (order-free).
        const persisted = await rawRules(created.id);
        const key = (r: { healthCheckId: string | null; environmentId: string | null }) =>
          `${r.healthCheckId}|${r.environmentId}`;
        expect(persisted.toSorted((a, b) => key(a).localeCompare(key(b)))).toEqual(
          [
            { dependencyId: created.id, healthCheckId: "hc-1", environmentId: null, overrideImpactType: "critical" as const },
            { dependencyId: created.id, healthCheckId: null, environmentId: "env-1", overrideImpactType: "degraded" as const },
            { dependencyId: created.id, healthCheckId: "hc-2", environmentId: "env-2", overrideImpactType: "informational" as const },
          ].toSorted((a, b) => key(a).localeCompare(key(b))),
        );
      });

      it("creates a dependency with no rules (empty array skips the insert)", async () => {
        const created = await service.createDependency({
          sourceSystemId: `sys-${crypto.randomUUID()}`,
          targetSystemId: `sys-${crypto.randomUUID()}`,
          impactType: "critical",
          transitive: false,
          healthCheckRules: [],
        });
        expect(created.healthCheckRules).toBeUndefined();
        expect(await rawRules(created.id)).toHaveLength(0);
      });

      it("still rejects a cycle inside the wrapping transaction", async () => {
        const a = `sys-${crypto.randomUUID()}`;
        const b = `sys-${crypto.randomUUID()}`;
        // a → b
        await service.createDependency({
          sourceSystemId: a,
          targetSystemId: b,
          impactType: "degraded",
          transitive: false,
          healthCheckRules: [],
        });
        // b → a would close a cycle and must throw; nothing must be persisted.
        await expect(
          service.createDependency({
            sourceSystemId: b,
            targetSystemId: a,
            impactType: "degraded",
            transitive: false,
            healthCheckRules: [],
          }),
        ).rejects.toThrow(/circular chain/);
        const remaining = await service.getDependencies({ systemId: b });
        // Only the a → b edge (b as target) exists; the rejected b → a is absent.
        expect(remaining.every((d) => d.sourceSystemId !== b)).toBe(true);
      });
    });

    describe("updateDependency rule replace", () => {
      it("replaces the rule set (delete + one multi-row insert)", async () => {
        const created = await service.createDependency({
          sourceSystemId: `sys-${crypto.randomUUID()}`,
          targetSystemId: `sys-${crypto.randomUUID()}`,
          impactType: "degraded",
          transitive: false,
          healthCheckRules: [
            { healthCheckId: "old-1", environmentId: null, overrideImpactType: "critical" },
          ],
        });

        const updated = await service.updateDependency({
          id: created.id,
          systemId: created.sourceSystemId,
          healthCheckRules: [
            { healthCheckId: "new-1", environmentId: null, overrideImpactType: "degraded" },
            { healthCheckId: "new-2", environmentId: null, overrideImpactType: "informational" },
          ],
        });

        expect(updated?.healthCheckRules).toHaveLength(2);
        const persisted = await rawRules(created.id);
        expect(persisted.map((r) => r.healthCheckId).toSorted()).toEqual([
          "new-1",
          "new-2",
        ]);
        // The old rule is gone (replace-all, not append).
        expect(persisted.some((r) => r.healthCheckId === "old-1")).toBe(false);
      });

      it("clears all rules when passed an empty array", async () => {
        const created = await service.createDependency({
          sourceSystemId: `sys-${crypto.randomUUID()}`,
          targetSystemId: `sys-${crypto.randomUUID()}`,
          impactType: "degraded",
          transitive: false,
          healthCheckRules: [
            { healthCheckId: "hc", environmentId: null, overrideImpactType: "critical" },
          ],
        });
        const updated = await service.updateDependency({
          id: created.id,
          systemId: created.sourceSystemId,
          healthCheckRules: [],
        });
        expect(updated?.healthCheckRules).toBeUndefined();
        expect(await rawRules(created.id)).toHaveLength(0);
      });
    });

    describe("saveNodePositions replace-all", () => {
      it("persists all positions in one multi-row insert and replaces the prior set", async () => {
        const userId = `user-${crypto.randomUUID()}`;

        await service.saveNodePositions({
          userId,
          positions: [
            { systemId: "s1", x: 1, y: 2 },
            { systemId: "s2", x: 3, y: 4 },
            { systemId: "s3", x: 5, y: 6 },
          ],
        });

        const first = await service.getNodePositions(userId);
        expect(first.toSorted((a, b) => a.systemId.localeCompare(b.systemId))).toEqual([
          { systemId: "s1", x: 1, y: 2 },
          { systemId: "s2", x: 3, y: 4 },
          { systemId: "s3", x: 5, y: 6 },
        ]);

        // Replace-all: a second save wipes the prior set and writes the new one.
        await service.saveNodePositions({
          userId,
          positions: [{ systemId: "s9", x: 9, y: 9 }],
        });
        const second = await service.getNodePositions(userId);
        expect(second).toEqual([{ systemId: "s9", x: 9, y: 9 }]);

        // Sanity: exactly one row remains in the table for this user.
        const rows = await testDb.db
          .select()
          .from(nodePositions)
          .where(eq(nodePositions.userId, userId));
        expect(rows).toHaveLength(1);
      });

      it("saving an empty set clears the user's positions", async () => {
        const userId = `user-${crypto.randomUUID()}`;
        await service.saveNodePositions({
          userId,
          positions: [{ systemId: "s1", x: 1, y: 1 }],
        });
        await service.saveNodePositions({ userId, positions: [] });
        expect(await service.getNodePositions(userId)).toHaveLength(0);
      });
    });
  },
);
