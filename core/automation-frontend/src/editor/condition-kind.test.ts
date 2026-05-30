import { describe, it, expect } from "bun:test";
import {
  ConditionSchema,
  type ConditionInput,
} from "@checkstack/automation-common";
import { defaultForKind, kindOf, type ConditionKind } from "./condition-kind";

describe("defaultForKind", () => {
  const structured: ConditionKind[] = ["numeric_state", "time", "state"];

  // Every structured seed must classify back to its own kind so the
  // editor's kind selector stays consistent after a switch.
  for (const kind of structured) {
    it(`kindOf round-trips its own ${kind} default`, () => {
      expect(kindOf(defaultForKind(kind))).toBe(kind);
    });
  }

  // The `time` seed is fully valid as-is (both bounds are real HH:mm).
  it("seeds a schema-valid time condition", () => {
    expect(ConditionSchema.safeParse(defaultForKind("time")).success).toBe(
      true,
    );
  });

  // numeric_state / state seed an empty required text field (value /
  // entity) the operator fills in - like the bare `expr` empty string.
  // Once filled, they round-trip through zod (the lossless contract).
  it("numeric_state becomes schema-valid once `value` is filled", () => {
    const seed = defaultForKind("numeric_state") as {
      numeric_state: { value: string; above?: number };
    };
    expect(ConditionSchema.safeParse(seed).success).toBe(false);
    seed.numeric_state.value = "health.system.p95_latency_ms";
    expect(ConditionSchema.safeParse(seed).success).toBe(true);
  });

  it("state becomes schema-valid once `entity` is filled", () => {
    const seed = defaultForKind("state") as {
      state: { entity: string; status: string };
    };
    expect(ConditionSchema.safeParse(seed).success).toBe(false);
    seed.state.entity = "payments-api";
    expect(ConditionSchema.safeParse(seed).success).toBe(true);
  });

  it("combinator defaults discriminate correctly", () => {
    expect(kindOf(defaultForKind("and"))).toBe("and");
    expect(kindOf(defaultForKind("or"))).toBe("or");
    expect(kindOf(defaultForKind("not"))).toBe("not");
    expect(kindOf(defaultForKind("expr"))).toBe("expr");
  });
});

describe("kindOf", () => {
  it("classifies a raw expression string as expr", () => {
    expect(kindOf("trigger.payload.x == 1")).toBe("expr");
  });

  it("classifies each structured variant", () => {
    const cases: Array<[ConditionInput, ConditionKind]> = [
      [{ numeric_state: { value: "v", above: 1 } }, "numeric_state"],
      [{ time: { after: "09:00" } }, "time"],
      [{ state: { entity: "s", status: "unhealthy" } }, "state"],
      [{ and: ["a"] }, "and"],
      [{ or: ["a"] }, "or"],
      [{ not: "a" }, "not"],
    ];
    for (const [condition, expected] of cases) {
      expect(kindOf(condition)).toBe(expected);
    }
  });
});
