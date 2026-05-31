/**
 * Integration test (real Postgres): cross-pod heartbeat-lost detection.
 *
 * This is the DETERMINISTIC backstop for `.agent/rules/state-and-scale.md` that
 * the single-process unit suite structurally cannot provide for the heartbeat
 * monitor. The prior fix made connection STATUS durable but left the
 * online→offline transition DETECTION pod-local (an in-memory `previousStatuses`
 * map): under N pods, the heartbeat-check job runs on a VARYING pod, so a pod
 * with an empty map never observed the satellite online and therefore never
 * fired the `heartbeat_lost` edge — leaving `connectionStatus` stuck `online`
 * forever after a pod crash. This test proves that bug cannot recur.
 *
 * ## Two-pod model (faithful proxy)
 *
 * We model TWO independent "pods" as two independent `SatelliteService` +
 * `HeartbeatMonitor` instances, EACH over its OWN `pg.Pool`, BOTH pointed at the
 * SAME Postgres database + schema (mirroring the automation-backend cross-pod
 * read-consistency IT). Separate pools = separate processes for the property
 * under test (no shared JS heap, so no shared in-memory baseline), one DB =
 * the shared durable substrate N pods share in production.
 *
 *   - pod A — the pod that handled the satellite's WS connection.
 *   - pod B — a DIFFERENT pod that later claims the heartbeat-check job and has
 *     NEVER seen this satellite online in memory.
 *
 * ## What it asserts
 *
 *   1. Pod A connects the satellite (durable write: lastHeartbeatAt=now,
 *      lastConnectionEvent="connected"). Pod B's entity read sees it ONLINE.
 *   2. The satellite's heartbeat ages out (we backdate lastHeartbeatAt past the
 *      offline threshold — a crashed pod that stopped heartbeating). Pod B's
 *      read now self-heals to OFFLINE purely from compute-on-read.
 *   3. Pod B's heartbeat monitor — fresh heap, no prior in-memory knowledge —
 *      DETECTS the heartbeat_lost edge from durable state and drives the entity
 *      mutate (flips lastConnectionEvent="heartbeat_lost").
 *   4. Re-running the monitor on EITHER pod is a no-op (idempotent across pods +
 *      redelivery).
 *
 * Gated behind `CHECKSTACK_IT=1`; connection from `CHECKSTACK_IT_PG_URL`. Each
 * run isolates itself in a freshly created Postgres schema and cleans up.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { SafeDatabase } from "@checkstack/backend-api";
import {
  createMockLogger,
  createMockSignalService,
} from "@checkstack/test-utils-backend";

import * as schema from "./schema";
import { SatelliteService } from "./service";
import { HeartbeatMonitor } from "./heartbeat-monitor";
import { OFFLINE_THRESHOLD_MS } from "@checkstack/satellite-common";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";

const SCHEMA = `it_sat_heartbeat_${crypto.randomUUID().replace(/-/g, "")}`;

/**
 * One simulated pod: an independent `SatelliteService` + `HeartbeatMonitor` over
 * its OWN pool to the shared DB. The monitor's entity sink performs the REAL
 * durable write via this pod's service (no framework handle needed — the
 * property under test is whether DETECTION reads durable state, not the
 * transition-log append).
 */
interface Pod {
  readonly pool: Pool;
  readonly service: SatelliteService;
  readonly monitor: HeartbeatMonitor;
  end(): Promise<void>;
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "cross-pod heartbeat-lost detection (real Postgres)",
  () => {
    const pods: Pod[] = [];

    function makePod(): Pod {
      const pool = new Pool({
        connectionString: PG_URL,
        options: `-c search_path=${SCHEMA}`,
      });
      const db = drizzle({
        client: pool,
        schema,
      }) as unknown as SafeDatabase<typeof schema>;
      const service = new SatelliteService(db);
      const logger = createMockLogger();
      const signalService = createMockSignalService();

      // The monitor's entity sink: the REAL durable heartbeat_lost write through
      // this pod's service. This is exactly what `index.ts` wires (minus the
      // framework `handle.mutate` wrapper, which is out of scope for the
      // cross-pod DETECTION property).
      const monitor = new HeartbeatMonitor(service, signalService, logger, {
        mirror: async (satelliteId) => {
          await service.applyConnectionState({
            satelliteId,
            lastEvent: "heartbeat_lost",
          });
        },
      });

      return { pool, service, monitor, end: () => pool.end() };
    }

    let podA: Pod;
    let podB: Pod;

    beforeAll(async () => {
      const setupPool = new Pool({ connectionString: PG_URL });
      try {
        await setupPool.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
        // The satellites table the service reads/writes. Only the columns the
        // service touches are needed.
        await setupPool.query(`
          CREATE TABLE "${SCHEMA}".satellites (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name text NOT NULL,
            region text NOT NULL,
            tags jsonb NOT NULL DEFAULT '{}',
            token_hash text NOT NULL,
            last_heartbeat_at timestamp,
            version text,
            last_connection_event text,
            created_at timestamp NOT NULL DEFAULT now()
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

    /** Insert a satellite row; returns its id. */
    async function insertSatellite(): Promise<string> {
      const { rows } = await podA.pool.query<{ id: string }>(
        `INSERT INTO "${SCHEMA}".satellites (name, region, token_hash)
         VALUES ('eu-west', 'eu-west-1', 'hash') RETURNING id`,
      );
      return rows[0]!.id;
    }

    /** Read the durable connection columns of one satellite (any pod). */
    async function readRow(
      pod: Pod,
      id: string,
    ): Promise<{ lastHeartbeatAt: Date | null; lastConnectionEvent: string | null }> {
      const { rows } = await pod.pool.query<{
        last_heartbeat_at: Date | null;
        last_connection_event: string | null;
      }>(
        `SELECT last_heartbeat_at, last_connection_event
         FROM "${SCHEMA}".satellites WHERE id = $1`,
        [id],
      );
      return {
        lastHeartbeatAt: rows[0]!.last_heartbeat_at,
        lastConnectionEvent: rows[0]!.last_connection_event,
      };
    }

    it("pod B detects heartbeat_lost for a satellite it never saw online, idempotently", async () => {
      const id = await insertSatellite();

      // 1. Pod A connects the satellite: durable write of the connected edge.
      await podA.service.applyConnectionState({
        satelliteId: id,
        lastEvent: "connected",
        lastHeartbeatAt: new Date(),
      });

      // Pod B (different pool/heap) reads it ONLINE via compute-on-read.
      const onlineB = await podB.service.getManyConnectionStates([id]);
      expect(onlineB[id]).toBeDefined();
      expect(onlineB[id]!.status).toBe("online");
      expect(onlineB[id]!.lastEvent).toBe("connected");

      // 2. The owning pod crashes / stops heartbeating: backdate the heartbeat
      //    past the offline threshold (simulating elapsed wall-clock time).
      const aged = new Date(Date.now() - OFFLINE_THRESHOLD_MS - 60_000);
      await podA.pool.query(
        `UPDATE "${SCHEMA}".satellites SET last_heartbeat_at = $1 WHERE id = $2`,
        [aged, id],
      );

      // Pod B's read self-heals to OFFLINE from durable state alone — no pod
      // ever wrote "offline"; the status is computed.
      const offlineB = await podB.service.getManyConnectionStates([id]);
      expect(offlineB[id]!.status).toBe("offline");
      // ...but the last recorded edge is still "connected" — the heartbeat_lost
      // edge has NOT been fired yet (this is the bug surface: under the old
      // pod-local design it would NEVER fire on a fresh pod).
      expect(offlineB[id]!.lastEvent).toBe("connected");

      // 3. Pod B's monitor — fresh heap, never saw this satellite online —
      //    detects the edge from DURABLE state and drives the mutate.
      await podB.monitor.checkHeartbeats();

      const afterDetect = await readRow(podB, id);
      expect(afterDetect.lastConnectionEvent).toBe("heartbeat_lost");
      // The entity read now reports the heartbeat_lost edge globally (pod A too).
      const lostA = await podA.service.getManyConnectionStates([id]);
      expect(lostA[id]!.lastEvent).toBe("heartbeat_lost");
      expect(lostA[id]!.status).toBe("offline");

      // 4. Idempotent: re-running on pod B AND on pod A is a no-op (the durable
      //    lastConnectionEvent="heartbeat_lost" makes the predicate false).
      await podB.monitor.checkHeartbeats();
      await podA.monitor.checkHeartbeats();
      const afterReRun = await readRow(podA, id);
      expect(afterReRun.lastConnectionEvent).toBe("heartbeat_lost");
    });
  },
);
