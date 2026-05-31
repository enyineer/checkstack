import { describe, it, expect } from "bun:test";
import {
  ConditionSchema,
  type ConditionInput,
} from "@checkstack/automation-common";
import {
  CONDITION_KIND_META,
  defaultForKind,
  kindOf,
  type ConditionKind,
  type ConditionKindGroup,
} from "./condition-kind";

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

describe("CONDITION_KIND_META", () => {
  // The full kind union — the picker groups every one of these, so a missing
  // entry would silently drop a condition type from the type picker.
  const ALL_KINDS: ConditionKind[] = [
    "expr",
    "and",
    "or",
    "not",
    "numeric_state",
    "time",
    "state",
  ];
  const VALID_GROUPS: ConditionKindGroup[] = [
    "Structured",
    "Logical",
    "Advanced",
  ];

  it("has exactly one entry per ConditionKind (no missing/extra keys)", () => {
    expect(Object.keys(CONDITION_KIND_META).toSorted()).toEqual(
      [...ALL_KINDS].toSorted(),
    );
  });

  // Every kind reachable from the editor's seed switch must have meta so the
  // picker can render a row for it.
  for (const kind of ALL_KINDS) {
    it(`describes ${kind} with a non-empty label/description and valid group`, () => {
      const meta = CONDITION_KIND_META[kind];
      expect(meta.kind).toBe(kind);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
      expect(VALID_GROUPS).toContain(meta.group);
    });
  }

  // defaultForKind is the editor's source of truth for which kinds exist;
  // assert the meta map covers exactly the same set so they can never drift.
  it("covers every kind defaultForKind can seed", () => {
    for (const kind of ALL_KINDS) {
      expect(defaultForKind(kind)).toBeDefined();
      expect(CONDITION_KIND_META[kind]).toBeDefined();
    }
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
