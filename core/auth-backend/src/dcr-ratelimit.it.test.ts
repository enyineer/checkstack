/**
 * DCR rate-limit shared-Postgres conformance (matrix #10).
 *
 * The DCR endpoint throttle MUST hold across pods, because an in-memory per-pod
 * limiter would let N pods each allow the cap = N x the intended limit. This
 * test simulates TWO pods (two independent pools to the SAME schema) hammering
 * the same key and asserts the combined count respects the single shared cap.
 *
 * Gated behind `CHECKSTACK_IT=1`; connection from `CHECKSTACK_IT_PG_URL`. Runs
 * in a freshly created, self-cleaning schema.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";
import { checkRateLimit } from "./rate-limit";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";

const SCHEMA = `it_dcr_ratelimit_${crypto.randomUUID().replace(/-/g, "")}`;

interface Pod {
  pool: Pool;
  db: SafeDatabase<typeof schema>;
  end(): Promise<void>;
}

function makePod(): Pod {
  const pool = new Pool({
    connectionString: PG_URL,
    options: `-c search_path=${SCHEMA}`,
  });
  const db = drizzle(pool, { schema }) as unknown as SafeDatabase<typeof schema>;
  return { pool, db, end: () => pool.end() };
}

describe.skipIf(!process.env.CHECKSTACK_IT)("DCR rate-limit (shared Postgres)", () => {
  let admin: Pool;
  let podA: Pod;
  let podB: Pod;

  beforeAll(async () => {
    admin = new Pool({ connectionString: PG_URL });
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    await admin.query(
      `CREATE TABLE "${SCHEMA}".ai_rate_limit (
        key text NOT NULL,
        window_start timestamp NOT NULL,
        count integer NOT NULL DEFAULT 0,
        PRIMARY KEY (key, window_start)
      )`,
    );
    podA = makePod();
    podB = makePod();
  });

  afterAll(async () => {
    await podA?.end();
    await podB?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin.end();
  });

  it("enforces ONE shared cap across two pods (no N x cap leak)", async () => {
    const key = `dcr:203.0.113.5`;
    const max = 5;
    const windowSeconds = 3600;
    const now = new Date("2026-06-02T12:00:00.000Z");

    // Alternate pods, sharing the same window. After `max` calls the limit is
    // hit regardless of WHICH pod served the call.
    const results = [];
    for (let i = 0; i < 8; i++) {
      const pod = i % 2 === 0 ? podA : podB;
      results.push(
        await checkRateLimit({ db: pod.db, key, max, windowSeconds, now }),
      );
    }

    const allowedCount = results.filter((r) => r.allowed).length;
    // Exactly `max` allowed across BOTH pods — not `max` per pod.
    expect(allowedCount).toBe(max);
    expect(results[results.length - 1].allowed).toBe(false);
    expect(results[results.length - 1].count).toBe(8);
  });

  it("resets in the next window", async () => {
    const key = `dcr:198.51.100.9`;
    const first = await checkRateLimit({
      db: podA.db,
      key,
      max: 1,
      windowSeconds: 60,
      now: new Date("2026-06-02T12:00:30.000Z"),
    });
    expect(first.allowed).toBe(true);
    const sameWindow = await checkRateLimit({
      db: podB.db,
      key,
      max: 1,
      windowSeconds: 60,
      now: new Date("2026-06-02T12:00:45.000Z"),
    });
    expect(sameWindow.allowed).toBe(false);
    const nextWindow = await checkRateLimit({
      db: podA.db,
      key,
      max: 1,
      windowSeconds: 60,
      now: new Date("2026-06-02T12:01:05.000Z"),
    });
    expect(nextWindow.allowed).toBe(true); // fresh window, counter reset
  });

  it("verifies the counter is visible from a second pod (durable, not pod-local)", async () => {
    const key = `dcr:192.0.2.1`;
    const now = new Date("2026-06-02T13:00:00.000Z");
    await checkRateLimit({ db: podA.db, key, max: 10, windowSeconds: 3600, now });
    // Pod B reads the SAME counter row written by pod A.
    const windowStart = new Date("2026-06-02T13:00:00.000Z");
    const rows = await podB.db
      .select({ count: schema.aiRateLimit.count })
      .from(schema.aiRateLimit)
      .where(
        sql`${schema.aiRateLimit.key} = ${key} AND ${schema.aiRateLimit.windowStart} = ${windowStart}`,
      );
    expect(rows[0]?.count).toBe(1);
  });
});
