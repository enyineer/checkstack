import { describe, expect, test } from "bun:test";
import type { CatalogHealthStatuses } from "@checkstack/catalog-common";
import {
  computeGroupRollup,
  matchesHealth,
  resolveSectionTone,
  resolveSystemHealth,
} from "./healthRollup.logic";
import type { GroupHealthRollup } from "./healthRollup.logic";

describe("resolveSystemHealth", () => {
  test("returns the reported status", () => {
    const statuses: CatalogHealthStatuses = { a: "degraded" };
    expect(resolveSystemHealth({ systemId: "a", statuses })).toBe("degraded");
  });

  test("absent system is 'unknown', never healthy", () => {
    expect(resolveSystemHealth({ systemId: "x", statuses: {} })).toBe("unknown");
    expect(
      resolveSystemHealth({ systemId: "x", statuses: undefined }),
    ).toBe("unknown");
  });
});

describe("computeGroupRollup", () => {
  test("all members healthy → allHealthy, derived from data not badges", () => {
    const statuses: CatalogHealthStatuses = { a: "healthy", b: "healthy" };
    const rollup = computeGroupRollup({ memberIds: ["a", "b"], statuses });
    expect(rollup.allHealthy).toBe(true);
    expect(rollup.hasData).toBe(true);
    expect(rollup.worst).toBe("healthy");
    expect(rollup.degraded).toBe(0);
    expect(rollup.unhealthy).toBe(0);
  });

  test("one degraded → warning rollup with count, not allHealthy", () => {
    const statuses: CatalogHealthStatuses = { a: "healthy", b: "degraded" };
    const rollup = computeGroupRollup({ memberIds: ["a", "b"], statuses });
    expect(rollup.allHealthy).toBe(false);
    expect(rollup.worst).toBe("degraded");
    expect(rollup.degraded).toBe(1);
    expect(rollup.unhealthy).toBe(0);
  });

  test("unhealthy outranks degraded for worst-of", () => {
    const statuses: CatalogHealthStatuses = {
      a: "degraded",
      b: "unhealthy",
      c: "degraded",
    };
    const rollup = computeGroupRollup({
      memberIds: ["a", "b", "c"],
      statuses,
    });
    expect(rollup.worst).toBe("unhealthy");
    expect(rollup.unhealthy).toBe(1);
    expect(rollup.degraded).toBe(2);
  });

  test("no data at all → hasData false, worst unknown, not allHealthy", () => {
    const rollup = computeGroupRollup({
      memberIds: ["a", "b"],
      statuses: undefined,
    });
    expect(rollup.hasData).toBe(false);
    expect(rollup.worst).toBe("unknown");
    expect(rollup.allHealthy).toBe(false);
  });

  test("mixed healthy + unknown is NOT allHealthy (absence ≠ healthy)", () => {
    const statuses: CatalogHealthStatuses = { a: "healthy" };
    const rollup = computeGroupRollup({ memberIds: ["a", "b"], statuses });
    expect(rollup.allHealthy).toBe(false);
    expect(rollup.hasData).toBe(true);
    // No degraded/unhealthy, but b is unknown → worst is healthy (a), unknown
    // ranks below healthy.
    expect(rollup.worst).toBe("healthy");
  });

  test("empty group is not allHealthy", () => {
    const rollup = computeGroupRollup({ memberIds: [], statuses: {} });
    expect(rollup.allHealthy).toBe(false);
    expect(rollup.hasData).toBe(false);
  });
});

describe("matchesHealth", () => {
  const statuses: CatalogHealthStatuses = {
    h: "healthy",
    d: "degraded",
    u: "unhealthy",
  };

  test("'all' matches everything", () => {
    for (const id of ["h", "d", "u", "missing"]) {
      expect(matchesHealth({ systemId: id, health: "all", statuses })).toBe(
        true,
      );
    }
  });

  test("'degraded' hides healthy rows, keeps degraded", () => {
    expect(matchesHealth({ systemId: "d", health: "degraded", statuses })).toBe(
      true,
    );
    expect(matchesHealth({ systemId: "h", health: "degraded", statuses })).toBe(
      false,
    );
  });

  test("'unknown' matches only no-data systems", () => {
    expect(
      matchesHealth({ systemId: "missing", health: "unknown", statuses }),
    ).toBe(true);
    expect(matchesHealth({ systemId: "h", health: "unknown", statuses })).toBe(
      false,
    );
  });

  test("non-'all' filter with undefined statuses → everything unknown", () => {
    expect(
      matchesHealth({ systemId: "h", health: "healthy", statuses: undefined }),
    ).toBe(false);
    expect(
      matchesHealth({ systemId: "h", health: "unknown", statuses: undefined }),
    ).toBe(true);
  });
});

describe("resolveSectionTone", () => {
  const base: GroupHealthRollup = {
    worst: "unknown",
    degraded: 0,
    unhealthy: 0,
    allHealthy: false,
    hasData: false,
  };

  test("no reported data → unknown", () => {
    expect(resolveSectionTone(base)).toBe("unknown");
  });

  test("all members healthy → ok", () => {
    expect(
      resolveSectionTone({ ...base, hasData: true, allHealthy: true }),
    ).toBe("ok");
  });

  test("any unhealthy member → down (worst wins over degraded)", () => {
    expect(
      resolveSectionTone({
        ...base,
        hasData: true,
        unhealthy: 1,
        degraded: 2,
        worst: "unhealthy",
      }),
    ).toBe("down");
  });

  test("degraded but no unhealthy → warn", () => {
    expect(
      resolveSectionTone({
        ...base,
        hasData: true,
        degraded: 1,
        worst: "degraded",
      }),
    ).toBe("warn");
  });

  test("mixed healthy + unknown with no failures → unknown", () => {
    expect(resolveSectionTone({ ...base, hasData: true })).toBe("unknown");
  });
});
