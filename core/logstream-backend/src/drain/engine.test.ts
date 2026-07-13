import { describe, it, expect } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import {
  createDrainEngine,
  HYDRATION_ROW_LIMIT,
  type DrainEngine,
} from "./engine";
import type { Storage, PatternUpsert } from "../storage";

/** A persisted `log_patterns` row as far as hydration reads it. */
interface HydrationRow {
  template: string;
  /** Defaults to a 'mined'-style row when omitted. */
  origin?: "mined" | "user";
  /** The pattern id; only read for user rows (to install the protected cluster). */
  id?: string;
}

/**
 * Minimal `Storage` fake exercising ONLY the `db` read path Drain uses for
 * hydration (`select({id, template, origin}).from(logPatterns).where(...)`). The
 * drizzle builder is stubbed to a thenable that resolves the seeded rows;
 * nothing else on Storage is touched by the engine, so a partial fake is sound.
 */
function fakeStorage(rows: HydrationRow[]): Storage {
  const builder = {
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => Promise.resolve(rows),
  };
  const db = { select: () => builder };
  // Cast: this is a test double that implements only the surface the engine
  // reads; building a real SafeDatabase would require a live Postgres.
  return { db } as unknown as Storage;
}

function makeEngine(rows: HydrationRow[] = []): DrainEngine {
  return createDrainEngine({
    storage: fakeStorage(rows),
    // The engine ignores these on the classify/hydrate paths under test.
    cacheManager: undefined as never,
    instanceRuntime: undefined as never,
    logger: undefined as never,
  });
}

const AT = new Date("2026-07-12T10:00:00Z");

describe("DrainEngine.classify", () => {
  it("produces a deterministic patternId for the same line", () => {
    const e1 = makeEngine();
    const e2 = makeEngine();
    const r1 = e1.classify({
      streamId: "s",
      body: "user 42 logged in",
      severityNumber: 9,
      at: AT,
    });
    const r2 = e2.classify({
      streamId: "s",
      body: "user 99 logged in",
      severityNumber: 9,
      at: AT,
    });
    // Same masked template ("user <*> logged in") -> identical id across engines.
    expect(r1.template).toBe("user <*> logged in");
    expect(r2.template).toBe(r1.template);
    expect(r2.patternId).toBe(r1.patternId);
    expect(r1.patternId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("flags the first occurrence of a template as new", () => {
    const e = makeEngine();
    const first = e.classify({
      streamId: "s",
      body: "boot complete",
      severityNumber: 9,
      at: AT,
    });
    const second = e.classify({
      streamId: "s",
      body: "boot complete",
      severityNumber: 9,
      at: AT,
    });
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
  });

  it("scopes patternId by stream (same body, different stream -> different id)", () => {
    const e = makeEngine();
    const a = e.classify({ streamId: "a", body: "hello", severityNumber: 9, at: AT });
    const b = e.classify({ streamId: "b", body: "hello", severityNumber: 9, at: AT });
    expect(a.patternId).not.toBe(b.patternId);
  });

});

describe("DrainEngine.classify wildcardValues", () => {
  it("is empty for a wildcard-free (fully static) template", () => {
    const e = makeEngine();
    const r = e.classify({
      streamId: "s",
      body: "boot complete",
      severityNumber: 9,
      at: AT,
    });
    expect(r.template).toBe("boot complete");
    expect(r.wildcardValues).toEqual([]);
  });

  it("recovers the raw numeric token at a masked wildcard position", () => {
    const e = makeEngine();
    const r = e.classify({
      streamId: "s",
      body: "user 42 in",
      severityNumber: 9,
      at: AT,
    });
    expect(r.template).toBe("user <*> in");
    // The raw pre-mask value, not the masked "<*>", so folding can parse it.
    expect(r.wildcardValues).toEqual(["42"]);
  });

  it("returns values in template order for multiple wildcards", () => {
    const e = makeEngine();
    const r = e.classify({
      streamId: "s",
      body: "req took 42 ms status 500",
      severityNumber: 9,
      at: AT,
    });
    expect(r.template).toBe("req took <*> ms status <*>");
    expect(r.wildcardValues).toEqual(["42", "500"]);
  });

  it("follows the CURRENT template after mid-flush refinement changes wildcard positions", () => {
    const e = makeEngine();
    // First line: 'alice' is a static literal (past the 2-token prefix), only the
    // number is a wildcard.
    const first = e.classify({
      streamId: "s",
      body: "user scored alice 10",
      severityNumber: 9,
      at: AT,
    });
    expect(first.template).toBe("user scored alice <*>");
    expect(first.wildcardValues).toEqual(["10"]);
    // Second line differs at the name -> the template refines, wildcarding that
    // position too. The values now follow the refined (2-wildcard) template.
    const second = e.classify({
      streamId: "s",
      body: "user scored bob 20",
      severityNumber: 9,
      at: AT,
    });
    expect(second.template).toBe("user scored <*> <*>");
    expect(second.wildcardValues).toEqual(["bob", "20"]);
  });

  it("captures a raw literal (non-numeric) value at a merged wildcard position", () => {
    const e = makeEngine();
    // Vary a token PAST the 2-token prefix so the two lines share a leaf and merge.
    e.classify({ streamId: "s", body: "cache lookup hit", severityNumber: 9, at: AT });
    const r = e.classify({
      streamId: "s",
      body: "cache lookup miss",
      severityNumber: 9,
      at: AT,
    });
    expect(r.template).toBe("cache lookup <*>");
    // Non-numeric raw value is still surfaced; folding skips it downstream.
    expect(r.wildcardValues).toEqual(["miss"]);
  });
});

describe("DrainEngine user patterns", () => {
  it("upsertUserPattern derives the same deterministic id as classify", () => {
    const e = makeEngine();
    const template = "user <*> logged in";
    const { patternId } = e.upsertUserPattern({ streamId: "s", template });
    const classified = e.classify({
      streamId: "s",
      body: "user 42 logged in",
      severityNumber: 9,
      at: AT,
    });
    expect(classified.template).toBe(template);
    expect(patternId).toBe(classified.patternId);
    expect(patternId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("classifies a line into a user pattern with precedence over fresh mining", () => {
    const e = makeEngine();
    const template = "GET /api/users <*>";
    const { patternId } = e.upsertUserPattern({ streamId: "s", template });
    // A line that would otherwise mine its own cluster now lands on the user one.
    const r = e.classify({
      streamId: "s",
      body: "GET /api/users 200",
      severityNumber: 9,
      at: AT,
    });
    expect(r.patternId).toBe(patternId);
    expect(r.isNew).toBe(false); // matched the pre-installed protected cluster
    expect(r.template).toBe(template);
    expect(r.wildcardValues).toEqual(["200"]);
  });

  it("a user pattern is never refined by non-matching-but-similar lines", () => {
    const e = makeEngine();
    const template = "job <*> done fast now";
    e.upsertUserPattern({ streamId: "s", template });
    // Same length, high similarity, but 'fast' != 'slow' at a NON-wildcard
    // position -> does NOT match the user cluster (exact match), and must not
    // refine it. It mines its own cluster instead.
    const r = e.classify({
      streamId: "s",
      body: "job 7 done slow now",
      severityNumber: 9,
      at: AT,
    });
    expect(r.template).toBe("job <*> done slow now");
    // The user pattern is intact: a matching line still classifies into it.
    const back = e.classify({
      streamId: "s",
      body: "job 9 done fast now",
      severityNumber: 9,
      at: AT,
    });
    expect(back.template).toBe(template);
  });

  it("removeUserPattern drops the cluster so later lines mine afresh", () => {
    const e = makeEngine();
    const template = "worker <*> restarted";
    const { patternId } = e.upsertUserPattern({ streamId: "s", template });
    const matched = e.classify({
      streamId: "s",
      body: "worker 3 restarted",
      severityNumber: 9,
      at: AT,
    });
    expect(matched.patternId).toBe(patternId);
    expect(matched.isNew).toBe(false);

    e.removeUserPattern({ streamId: "s", patternId });
    // With the protected cluster gone, the next occurrence mines a NEW cluster.
    const afterRemove = e.classify({
      streamId: "s",
      body: "worker 4 restarted",
      severityNumber: 9,
      at: AT,
    });
    expect(afterRemove.isNew).toBe(true);
  });

  it("removeUserPattern is idempotent and does not throw when absent", () => {
    const e = makeEngine();
    expect(() =>
      e.removeUserPattern({ streamId: "s", patternId: "nope" }),
    ).not.toThrow();
  });

  it("setProtectedPatterns is idempotent and does not throw", () => {
    const e = makeEngine();
    expect(() =>
      e.setProtectedPatterns({ streamId: "s", patternIds: ["p1", "p2"] }),
    ).not.toThrow();
    expect(() =>
      e.setProtectedPatterns({ streamId: "s", patternIds: ["p1"] }),
    ).not.toThrow();
  });
});

describe("DrainEngine user-pattern hydration", () => {
  it("seeds an origin='user' row as a protected, match-first cluster", async () => {
    const template = "payment <*> declined";
    // The persisted user row carries the deterministic id classify would derive.
    const probe = makeEngine();
    const id = probe.upsertUserPattern({ streamId: "s", template }).patternId;

    const e = makeEngine([{ id, template, origin: "user" }]);
    await e.hydrateStream({ streamId: "s" });

    const r = e.classify({
      streamId: "s",
      body: "payment 42 declined",
      severityNumber: 9,
      at: AT,
    });
    expect(r.patternId).toBe(id);
    expect(r.isNew).toBe(false); // matched the hydrated protected cluster
    expect(r.template).toBe(template);
    expect(r.wildcardValues).toEqual(["42"]);
  });

  it("a hydrated user pattern keeps precedence and is not refined away", async () => {
    const template = "svc <*> ready";
    const probe = makeEngine();
    const id = probe.upsertUserPattern({ streamId: "s", template }).patternId;
    const e = makeEngine([{ id, template, origin: "user" }]);
    await e.hydrateStream({ streamId: "s" });

    // A non-matching line at the static 'ready' position mines its own cluster.
    const mined = e.classify({
      streamId: "s",
      body: "svc 1 down",
      severityNumber: 9,
      at: AT,
    });
    expect(mined.template).toBe("svc <*> down");
    // The user pattern still classifies its matching lines.
    const hit = e.classify({
      streamId: "s",
      body: "svc 2 ready",
      severityNumber: 9,
      at: AT,
    });
    expect(hit.patternId).toBe(id);
  });
});

describe("DrainEngine.pendingPatternUpserts", () => {
  it("accumulates deltas per pattern, then clears on drain", () => {
    const e = makeEngine();
    for (let i = 0; i < 3; i++) {
      e.classify({ streamId: "s", body: `req ${i} ok`, severityNumber: 9, at: AT });
    }
    const first = e.pendingPatternUpserts();
    expect(first).toHaveLength(1);
    expect(first[0].totalCount).toBe(3);
    expect(first[0].streamId).toBe("s");
    expect(first[0].template).toBe("req <*> ok");

    // Drain cleared the accumulator; a re-drain is empty.
    expect(e.pendingPatternUpserts()).toHaveLength(0);

    // New lines re-accumulate from zero.
    e.classify({ streamId: "s", body: "req 7 ok", severityNumber: 9, at: AT });
    e.classify({ streamId: "s", body: "req 8 ok", severityNumber: 9, at: AT });
    const second = e.pendingPatternUpserts();
    expect(second).toHaveLength(1);
    expect(second[0].totalCount).toBe(2);
  });

  it("tracks severityMax and lastSeenAt monotonically within a batch", () => {
    const e = makeEngine();
    const t1 = new Date("2026-07-12T10:00:00Z");
    const t2 = new Date("2026-07-12T10:05:00Z");
    e.classify({ streamId: "s", body: "flap detected", severityNumber: 9, at: t1 });
    e.classify({ streamId: "s", body: "flap detected", severityNumber: 17, at: t2 });
    e.classify({ streamId: "s", body: "flap detected", severityNumber: 13, at: t1 });
    const [row] = e.pendingPatternUpserts();
    expect(row.totalCount).toBe(3);
    expect(row.severityMax).toBe(17);
    expect(row.lastSeenAt).toEqual(t2);
    expect(row.firstSeenAt).toEqual(t1);
  });
});

describe("DrainEngine.hydrateStream", () => {
  it("is idempotent and cheap once hydrated", async () => {
    const e = makeEngine([{ template: "cached <*> template" }]);
    await e.hydrateStream({ streamId: "s" });
    // Second call must not re-seed / re-read (no throw, no duplicate work).
    await e.hydrateStream({ streamId: "s" });
    const r = e.classify({
      streamId: "s",
      body: "cached 5 template",
      severityNumber: 9,
      at: AT,
    });
    // Matched the hydrated template -> not reported as new.
    expect(r.isNew).toBe(false);
    expect(r.template).toBe("cached <*> template");
  });

  it("round-trips: persist -> new engine hydrates -> same patternId, not new", async () => {
    const producer = makeEngine();
    const original = producer.classify({
      streamId: "s",
      body: "disk 91 percent full",
      severityNumber: 13,
      at: AT,
    });
    const persisted: PatternUpsert[] = producer.pendingPatternUpserts();
    expect(persisted).toHaveLength(1);

    // A fresh engine (new pod) hydrated from the persisted templates.
    const rows = persisted.map((p) => ({ template: p.template }));
    const reloaded = makeEngine(rows);
    await reloaded.hydrateStream({ streamId: "s" });
    const afterReload = reloaded.classify({
      streamId: "s",
      body: "disk 12 percent full",
      severityNumber: 13,
      at: AT,
    });
    expect(afterReload.patternId).toBe(original.patternId);
    expect(afterReload.isNew).toBe(false);
  });
});

describe("DrainEngine.hydrateStream row bound", () => {
  it("warns when a stream's hydration is truncated at the row limit", async () => {
    // The loader is bounded to HYDRATION_ROW_LIMIT rows; a table at (or past)
    // the limit means the coldest patterns were dropped, so we surface a warning.
    const rows = Array.from({ length: HYDRATION_ROW_LIMIT }, (_, i) => ({
      id: `p${i}`,
      template: `tpl ${i} value`,
      origin: "mined",
    }));
    const logger = createMockLogger();
    const engine = createDrainEngine({ loadPatternRows: async () => rows, logger });

    await engine.hydrateStream({ streamId: "s" });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("truncated"));
  });

  it("does not warn when hydration returns fewer rows than the limit", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      template: `tpl ${i} value`,
      origin: "mined",
    }));
    const logger = createMockLogger();
    const engine = createDrainEngine({ loadPatternRows: async () => rows, logger });

    await engine.hydrateStream({ streamId: "s" });

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("DrainEngine performance smoke", () => {
  it(
    "classifies 100k mixed lines quickly with bounded pattern growth",
    () => {
    const e = makeEngine();
    const shapes = [
      (i: number) => `GET /api/users/${i} 200 in ${i % 50}ms`,
      (i: number) => `db query took ${i % 1000}ms rows=${i % 7}`,
      (i: number) => `user ${i} logged in from 10.0.${i % 255}.${i % 255}`,
      (i: number) => `cache ${i % 2 === 0 ? "hit" : "miss"} for key k${i}`,
      (i: number) => `worker ${i % 4} processed job ${i}`,
    ];
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      const shape = shapes[i % shapes.length];
      e.classify({
        streamId: "s",
        body: shape(i),
        severityNumber: 9,
        at: AT,
      });
    }
    const elapsedMs = performance.now() - start;
    const patterns = e.pendingPatternUpserts();
    // The five shapes collapse to a small, bounded set of templates (masking +
    // merging), proving no per-line pattern explosion.
    expect(patterns.length).toBeLessThan(50);
    // Generous ceiling to stay robust on slow CI; a quadratic blowup would blow
    // well past this.
    // Generous ceiling: catches a quadratic blowup (minutes), tolerates
    // scheduler starvation when the whole repo suite runs in parallel
    // (observed >5s of lateness). Pattern-growth above is the strict guard.
    expect(elapsedMs).toBeLessThan(30_000);
    },
    60_000,
  );
});
