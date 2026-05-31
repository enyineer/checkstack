import { describe, it, expect } from "bun:test";
import { createDefaultFilterRegistry } from "@checkstack/template-engine";
import {
  ConditionSchema,
  type Condition,
} from "@checkstack/automation-common";
import { evaluateCondition } from "./condition";
import { evaluateTimeCondition } from "./structured-conditions";

const filters = createDefaultFilterRegistry();

function evalCond(
  condition: Condition,
  scope: Record<string, unknown>,
): boolean {
  return evaluateCondition(condition, scope, filters);
}

// Scope mirroring the engine's pre-resolved `health.*` namespace.
function healthScope(
  systems: Record<
    string,
    { status: string; in_status_for_ms?: number }
  >,
): Record<string, unknown> {
  return { health: { systems, system: undefined } };
}

describe("numeric_state condition", () => {
  it("compares a literal number value", () => {
    expect(
      evalCond({ numeric_state: { value: 600, above: 500 } }, {}),
    ).toBe(true);
    expect(
      evalCond({ numeric_state: { value: 400, above: 500 } }, {}),
    ).toBe(false);
  });

  it("resolves a path/template string against scope", () => {
    const scope = healthScope({ "sys-1": { status: "unhealthy" } });
    (scope.health as Record<string, unknown>).system = {
      p95_latency_ms: 700,
    };
    expect(
      evalCond(
        { numeric_state: { value: "health.system.p95_latency_ms", below: 800 } },
        scope,
      ),
    ).toBe(true);
    expect(
      evalCond(
        { numeric_state: { value: "health.system.p95_latency_ms", below: 500 } },
        scope,
      ),
    ).toBe(false);
  });

  it("is false when the value resolves to non-numeric", () => {
    expect(
      evalCond({ numeric_state: { value: "missing.path", above: 1 } }, {}),
    ).toBe(false);
  });
});

describe("state condition", () => {
  it("true when the entity is in the status (no dwell)", () => {
    const scope = healthScope({ "sys-1": { status: "unhealthy" } });
    expect(
      evalCond({ state: { entity: "sys-1", status: "unhealthy" } }, scope),
    ).toBe(true);
  });

  it("false when the entity is in a different status", () => {
    const scope = healthScope({ "sys-1": { status: "healthy" } });
    expect(
      evalCond({ state: { entity: "sys-1", status: "unhealthy" } }, scope),
    ).toBe(false);
  });

  it("respects the dwell (in_status_for_ms >= for)", () => {
    const scope = healthScope({
      "sys-1": { status: "unhealthy", in_status_for_ms: 31 * 60_000 },
    });
    expect(
      evalCond(
        { state: { entity: "sys-1", status: "unhealthy", for: { minutes: 30 } } },
        scope,
      ),
    ).toBe(true);

    const shortScope = healthScope({
      "sys-1": { status: "unhealthy", in_status_for_ms: 10 * 60_000 },
    });
    expect(
      evalCond(
        { state: { entity: "sys-1", status: "unhealthy", for: { minutes: 30 } } },
        shortScope,
      ),
    ).toBe(false);
  });

  it("false when the entity is absent from scope", () => {
    expect(
      evalCond(
        { state: { entity: "nope", status: "unhealthy" } },
        healthScope({}),
      ),
    ).toBe(false);
  });
});

describe("time condition", () => {
  // 2026-05-30 is a Saturday. 12:00 UTC.
  const noonUtc = new Date("2026-05-30T12:00:00.000Z");

  it("after/before same-day window", () => {
    expect(
      evaluateTimeCondition(
        { time: { after: "09:00", before: "17:00", timezone: "UTC" } },
        noonUtc,
      ),
    ).toBe(true);
    expect(
      evaluateTimeCondition(
        { time: { after: "13:00", before: "17:00", timezone: "UTC" } },
        noonUtc,
      ),
    ).toBe(false);
  });

  it("overnight window wrapping midnight (22:00 → 06:00)", () => {
    const at23 = new Date("2026-05-30T23:30:00.000Z");
    const at03 = new Date("2026-05-30T03:30:00.000Z");
    const at12 = noonUtc;
    const window = {
      time: { after: "22:00", before: "06:00", timezone: "UTC" },
    } as const;
    expect(evaluateTimeCondition(window, at23)).toBe(true);
    expect(evaluateTimeCondition(window, at03)).toBe(true);
    expect(evaluateTimeCondition(window, at12)).toBe(false);
  });

  it("weekday filter (Saturday = 6)", () => {
    expect(
      evaluateTimeCondition({ time: { weekday: [6], timezone: "UTC" } }, noonUtc),
    ).toBe(true);
    expect(
      evaluateTimeCondition(
        { time: { weekday: [1, 2, 3, 4, 5], timezone: "UTC" } },
        noonUtc,
      ),
    ).toBe(false);
  });

  it("respects timezone (12:00 UTC = 14:00 Europe/Berlin in summer)", () => {
    // 12:00 UTC is 14:00 in Berlin (CEST). after 13:00 Berlin → true.
    expect(
      evaluateTimeCondition(
        { time: { after: "13:00", before: "15:00", timezone: "Europe/Berlin" } },
        noonUtc,
      ),
    ).toBe(true);
    // In UTC the same instant is 12:00, before 13:00 → false.
    expect(
      evaluateTimeCondition(
        { time: { after: "13:00", before: "15:00", timezone: "UTC" } },
        noonUtc,
      ),
    ).toBe(false);
  });

  it("weekday can differ across timezones at the day boundary", () => {
    // 2026-05-30T23:30 UTC is still Saturday(6) in UTC but Sunday(0) in Tokyo.
    const lateUtc = new Date("2026-05-30T23:30:00.000Z");
    expect(
      evaluateTimeCondition({ time: { weekday: [6], timezone: "UTC" } }, lateUtc),
    ).toBe(true);
    expect(
      evaluateTimeCondition(
        { time: { weekday: [0], timezone: "Asia/Tokyo" } },
        lateUtc,
      ),
    ).toBe(true);
  });
});

describe("structured conditions compose with and/or/not", () => {
  it("and combines a state + numeric_state", () => {
    const scope = healthScope({
      "sys-1": { status: "unhealthy", in_status_for_ms: 40 * 60_000 },
    });
    (scope.health as Record<string, unknown>).system = { p95_latency_ms: 900 };
    const condition: Condition = {
      and: [
        { state: { entity: "sys-1", status: "unhealthy", for: { minutes: 30 } } },
        { numeric_state: { value: "health.system.p95_latency_ms", above: 500 } },
      ],
    };
    expect(evalCond(condition, scope)).toBe(true);
  });

  it("not negates a structured variant", () => {
    const scope = healthScope({ "sys-1": { status: "healthy" } });
    expect(
      evalCond(
        { not: { state: { entity: "sys-1", status: "unhealthy" } } },
        scope,
      ),
    ).toBe(true);
  });
});

describe("condition grammar round-trips through zod", () => {
  const cases: Condition[] = [
    "trigger.payload.x == 1",
    { and: ["a == 1", { numeric_state: { value: "v", above: 5 } }] },
    { or: [{ time: { after: "09:00", weekday: [1, 2] } }, "b == 2"] },
    { not: { state: { entity: "sys-1", status: "degraded", for: { hours: 2 } } } },
    { numeric_state: { value: 10, above: 1, below: 100 } },
    { time: { after: "22:00", before: "06:00", timezone: "Europe/Berlin" } },
    { state: { entity: "sys-9", status: "unhealthy" } },
  ];

  for (const [i, c] of cases.entries()) {
    it(`parses + preserves case ${i}`, () => {
      const parsed = ConditionSchema.parse(c);
      expect(parsed).toEqual(c);
    });
  }

  it("rejects numeric_state with no bounds", () => {
    expect(() =>
      ConditionSchema.parse({ numeric_state: { value: 1 } }),
    ).toThrow();
  });

  it("rejects time with no fields", () => {
    expect(() => ConditionSchema.parse({ time: {} })).toThrow();
  });

  it("rejects a malformed HH:mm", () => {
    expect(() =>
      ConditionSchema.parse({ time: { after: "9am" } }),
    ).toThrow();
  });
});
