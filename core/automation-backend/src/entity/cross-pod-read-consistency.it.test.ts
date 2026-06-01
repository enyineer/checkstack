/**
 * Integration test (real Postgres): cross-pod reactive-entity read consistency.
 *
 * This is the DETERMINISTIC backstop for `.claude/rules/state-and-scale.md`
 * that the single-process unit suite structurally cannot provide: "Does a read
 * return the same answer on every pod?". The unit suite runs in one process, so
 * a value written in that process is trivially visible to the same process —
 * green typecheck/lint/tests do NOT prove scale-correctness. This test catches
 * the class of bug where a reactive entity's CURRENT state is stored
 * process-local (pod-local) memory instead of shared durable storage.
 *
 * ## Two-pod model (faithful proxy, justified)
 *
 * A full second platform boot per case is unnecessary to expose the bug: the
 * bug is purely about WHERE the `read` accessor resolves state from. We model
 * TWO independent "pods" as two independent entity registries, each with its
 * OWN `EntityStore` over its OWN `pg.Pool` connection, BOTH pointed at the SAME
 * Postgres database + schema:
 *
 *   - instance A — registry A + store A + pool A
 *   - instance B — registry B + store B + pool B
 *
 * Separate pools/registries = separate processes for the property under test
 * (no shared JS heap between A and B), while one DB + schema = the shared
 * durable substrate N pods share in production. A mutation driven on A's handle
 * (the pod that "claims the dispatch job") must be visible to B's `read` (the
 * pod that later runs scope enrichment / `wait_until` re-eval).
 *
 * ## What it asserts
 *
 *   1. DURABLE kind (`it-shared`): `read` resolves from a shared table. A write
 *      on A is visible to B's `get` AND B's `getMany` (scope-resolution shape).
 *      This is the property a correct reactive entity MUST have.
 *
 *   2. POD-LOCAL kind (`it-pod-local`, NEGATIVE CONTROL): `read` resolves from a
 *      per-instance in-memory Map. A write on A is INVISIBLE to B's read. We
 *      ASSERT the inconsistency, so the test documents the bug shape and proves
 *      it has teeth — a pod-local `read` for a real entity WOULD fail assertion
 *      (1). If durable storage ever silently aliased the in-memory map (e.g. a
 *      shared module singleton), this control would start failing.
 *
 * Gated behind `CHECKSTACK_IT=1` so the default `bun test` never runs it.
 * Connection comes from `CHECKSTACK_IT_PG_URL`. Each run isolates itself in a
 * freshly created Postgres schema and cleans up after itself.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { Pool } from "pg";

import type { SafeDatabase } from "@checkstack/backend-api";

import { entityTransitions } from "../schema";
import type { EntityHandle, EntityRead } from "./define-entity";
import { createEntityRegistry } from "./registry";
import { createEntityStore } from "./entity-store";
import { createChangeEmitter } from "./change-emitter";
import { createRunSecretRegistry } from "../dispatch/run-secret-registry";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";

const SCHEMA = `it_crosspod_${crypto.randomUUID().replace(/-/g, "")}`;

/** The representative shared-table state shape. */
const sharedStateSchema = z.object({ status: z.string() });
type SharedState = z.infer<typeof sharedStateSchema>;

const podLocalStateSchema = z.object({ status: z.string() });
type PodLocalState = z.infer<typeof podLocalStateSchema>;

const SHARED_KIND = "it-shared";
const POD_LOCAL_KIND = "it-pod-local";

/** A `SafeDatabase` over a pool (drizzle's NodePgDatabase, query-API omitted). */
type StoreSchema = { entityTransitions: typeof entityTransitions };

/**
 * One simulated pod: an independent registry + store + emitter over its own
 * pool, plus its own pod-local in-memory map (the negative control's backing
 * store). The DURABLE kind reads the shared `it_entities` table; the POD-LOCAL
 * kind reads THIS pod's map.
 */
interface Pod {
  readonly pool: Pool;
  readonly sharedHandle: EntityHandle<SharedState>;
  readonly podLocalHandle: EntityHandle<PodLocalState>;
  /** This pod's pod-local backing store (per-instance heap state). */
  readonly localMap: Map<string, PodLocalState>;
  end(): Promise<void>;
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "cross-pod reactive-entity read consistency (real Postgres)",
  () => {
    const pods: Pod[] = [];

    /** Build one independent "pod" over its own connection to the shared DB. */
    function makePod(): Pod {
      const pool = new Pool({
        connectionString: PG_URL,
        options: `-c search_path=${SCHEMA}`,
      });
      const db = drizzle({
        client: pool,
        schema: { entityTransitions },
      }) as unknown as SafeDatabase<StoreSchema>;

      const emitter = createChangeEmitter();
      const secretRegistry = createRunSecretRegistry();
      const registry = createEntityRegistry({ secretRegistry, emitter });
      registry.setStore({ store: createEntityStore(db) });

      // DURABLE kind: `read` resolves from the SHARED `it_entities` table, so a
      // write on any pod is visible to every pod. This is the correct shape.
      const sharedRead: EntityRead<SharedState> = async (ids) => {
        if (ids.length === 0) return {};
        const { rows } = await pool.query<{ id: string; status: string }>(
          `SELECT id, status FROM "${SCHEMA}".it_entities WHERE id = ANY($1)`,
          [ids as string[]],
        );
        const out: Record<string, SharedState> = {};
        for (const row of rows) out[row.id] = { status: row.status };
        return out;
      };
      const sharedHandle = registry.defineEntity<SharedState>({
        kind: SHARED_KIND,
        state: sharedStateSchema,
        read: sharedRead,
      });

      // POD-LOCAL kind (NEGATIVE CONTROL): `read` resolves from THIS pod's
      // in-memory map. A write on pod A's map is invisible to pod B — the
      // horizontal-scale bug this whole guard exists to forbid.
      const localMap = new Map<string, PodLocalState>();
      const podLocalRead: EntityRead<PodLocalState> = async (ids) => {
        const out: Record<string, PodLocalState> = {};
        for (const id of ids) {
          const value = localMap.get(id);
          if (value) out[id] = value;
        }
        return out;
      };
      const podLocalHandle = registry.defineEntity<PodLocalState>({
        kind: POD_LOCAL_KIND,
        state: podLocalStateSchema,
        read: podLocalRead,
      });

      return {
        pool,
        sharedHandle,
        podLocalHandle,
        localMap,
        end: () => pool.end(),
      };
    }

    let podA: Pod;
    let podB: Pod;

    beforeAll(async () => {
      const setupPool = new Pool({ connectionString: PG_URL });
      try {
        await setupPool.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
        // The plugin-owned shared state table the DURABLE kind reads from.
        await setupPool.query(`
          CREATE TABLE "${SCHEMA}".it_entities (
            id text PRIMARY KEY,
            status text NOT NULL
          )
        `);
        // The framework transition log every handle appends to (Model B).
        await setupPool.query(`
          CREATE TABLE "${SCHEMA}".entity_transitions (
            id text PRIMARY KEY,
            kind text NOT NULL,
            entity_id text NOT NULL,
            field text NOT NULL,
            from_value text,
            to_value text NOT NULL,
            transitioned_at timestamp NOT NULL DEFAULT now()
          )
        `);
      } finally {
        await setupPool.end();
      }

      podA = makePod();
      podB = makePod();
      pods.push(podA, podB);
    });

    afterAll(async () => {
      await Promise.all(pods.map((p) => p.end()));
      const cleanupPool = new Pool({ connectionString: PG_URL });
      try {
        await cleanupPool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      } finally {
        await cleanupPool.end();
      }
    });

    /** The plugin write for the DURABLE kind: UPSERT the shared table row. */
    function writeShared(pod: Pod, id: string, status: string) {
      return async (): Promise<SharedState> => {
        await pod.pool.query(
          `INSERT INTO "${SCHEMA}".it_entities (id, status) VALUES ($1, $2)
             ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
          [id, status],
        );
        return { status };
      };
    }

    /** The plugin "write" for the POD-LOCAL kind: mutate THIS pod's map only. */
    function writePodLocal(pod: Pod, id: string, status: string) {
      return async (): Promise<PodLocalState> => {
        pod.localMap.set(id, { status });
        return { status };
      };
    }

    it("durable kind: a write on pod A is visible to pod B's read + getMany", async () => {
      const id = `ent-${crypto.randomUUID()}`;

      // Mutate via pod A's handle (the pod that claimed the dispatch).
      await podA.sharedHandle.mutate({ id, apply: writeShared(podA, id, "open") });

      // Pod A sees its own write (sanity).
      expect(await podA.sharedHandle.get(id)).toEqual({ status: "open" });

      // The property under test: pod B — a DIFFERENT registry over a DIFFERENT
      // connection, no shared heap — sees the SAME value.
      expect(await podB.sharedHandle.get(id)).toEqual({ status: "open" });

      // Scope-resolution shape (`getMany`) is consistent across pods too.
      const manyB = await podB.sharedHandle.getMany([id]);
      expect(manyB[id]).toEqual({ status: "open" });

      // A follow-up write on A is likewise visible on B (not just first-write).
      await podA.sharedHandle.mutate({
        id,
        apply: writeShared(podA, id, "resolved"),
      });
      expect(await podB.sharedHandle.get(id)).toEqual({ status: "resolved" });
    });

    it("NEGATIVE CONTROL: a pod-local read does NOT see another pod's write (proves teeth)", async () => {
      const id = `ent-${crypto.randomUUID()}`;

      // Mutate the POD-LOCAL kind on pod A: only pod A's in-memory map changes.
      await podA.podLocalHandle.mutate({
        id,
        apply: writePodLocal(podA, id, "open"),
      });

      // Pod A sees its own pod-local write.
      expect(await podA.podLocalHandle.get(id)).toEqual({ status: "open" });

      // Pod B's read resolves from ITS OWN (empty) map — the write is invisible.
      // This is exactly the horizontal-scale bug the guard forbids. We assert
      // the inconsistency so the test documents the failure shape WITHOUT
      // itself failing: were `it-pod-local` a real reactive entity, the durable
      // assertion above would FAIL for it.
      expect(await podB.podLocalHandle.get(id)).toBeUndefined();
      const manyB = await podB.podLocalHandle.getMany([id]);
      expect(manyB[id]).toBeUndefined();

      // Cross-check: the DURABLE kind would have been visible here — so the
      // difference is purely WHERE state lives, not a test artifact.
      const durableId = `ent-${crypto.randomUUID()}`;
      await podA.sharedHandle.mutate({
        id: durableId,
        apply: writeShared(podA, durableId, "open"),
      });
      expect(await podB.sharedHandle.get(durableId)).toEqual({ status: "open" });
    });
  },
);
