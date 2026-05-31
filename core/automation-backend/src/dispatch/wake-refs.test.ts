import { describe, it, expect } from "bun:test";
import type { Condition } from "@checkstack/automation-common";

import { extractWakeRefs, refToString, type WakeRef } from "./wake-refs";

/** Sort + stringify refs for stable comparison. */
function refStrings(refs: ReadonlyArray<WakeRef>): string[] {
  return refs.map(refToString).toSorted();
}

describe("extractWakeRefs — structured `state` conditions", () => {
  it("extracts the health entity ref from a state condition", () => {
    const condition: Condition = {
      state: { entity: "sys-1", status: "healthy" },
    };
    const { refs, indeterminate } = extractWakeRefs(condition);
    expect(refStrings(refs)).toEqual(["health:sys-1"]);
    expect(indeterminate).toBe(false);
  });

  it("carries the `for` dwell without affecting the ref", () => {
    const condition: Condition = {
      state: { entity: "sys-2", status: "degraded", for: { minutes: 5 } },
    };
    expect(refStrings(extractWakeRefs(condition).refs)).toEqual([
      "health:sys-2",
    ]);
  });
});

describe("extractWakeRefs — structured `numeric_state` conditions", () => {
  it("extracts a ref from a health.* value path", () => {
    const condition: Condition = {
      numeric_state: { value: "health.system.p95_latency_ms", above: 500 },
    };
    // health.system has no concrete id → kind wildcard.
    expect(refStrings(extractWakeRefs(condition).refs)).toEqual(["health:*"]);
  });

  it("extracts a concrete ref from a state.<kind>.<id>.<field> value path", () => {
    const condition: Condition = {
      numeric_state: {
        value: "state.slo['obj-1'].budget_remaining_percent",
        below: 20,
      },
    };
    expect(refStrings(extractWakeRefs(condition).refs)).toEqual(["slo:obj-1"]);
  });

  it("a literal numeric value references no entity", () => {
    const condition: Condition = { numeric_state: { value: 42, above: 1 } };
    const { refs, indeterminate } = extractWakeRefs(condition);
    expect(refs).toHaveLength(0);
    // touchedState (numeric_state) but no ref → indeterminate fallback.
    expect(indeterminate).toBe(true);
  });
});

describe("extractWakeRefs — template-string conditions", () => {
  it("extracts state.<kind>.<id> member chains (identifier ids)", () => {
    const condition: Condition = "state.incident.inc9.status == 'resolved'";
    expect(refStrings(extractWakeRefs(condition).refs)).toEqual([
      "incident:inc9",
    ]);
  });

  it("extracts state.<kind>[<id>] index chains (hyphenated ids)", () => {
    const condition: Condition = "state.incident['inc-9'].status == 'resolved'";
    expect(refStrings(extractWakeRefs(condition).refs)).toEqual([
      "incident:inc-9",
    ]);
  });

  it("extracts health.systems[<id>] index chains", () => {
    const condition: Condition =
      "health.systems['sys-7'].status == 'healthy'";
    expect(refStrings(extractWakeRefs(condition).refs)).toEqual(["health:sys-7"]);
  });

  it("treats health.system as a kind wildcard (implicit context id)", () => {
    const condition: Condition = "health.system.status == 'healthy'";
    expect(refStrings(extractWakeRefs(condition).refs)).toEqual(["health:*"]);
  });

  it("collects multiple distinct refs across a boolean expression", () => {
    const condition: Condition =
      "state.incident['inc-1'].status == 'open' && state.health['sys-2'].status == 'degraded'";
    expect(refStrings(extractWakeRefs(condition).refs)).toEqual([
      "health:sys-2",
      "incident:inc-1",
    ]);
  });

  it("de-duplicates repeated refs", () => {
    const condition: Condition =
      "state.health['sys-1'].status == 'healthy' || state.health['sys-1'].latency_ms > 100";
    expect(refStrings(extractWakeRefs(condition).refs)).toEqual(["health:sys-1"]);
  });
});

describe("extractWakeRefs — combinators", () => {
  it("recurses into and/or/not", () => {
    const condition: Condition = {
      and: [
        { state: { entity: "sys-a", status: "healthy" } },
        {
          or: [
            "state.slo['obj-x'].budget_remaining_percent < 10",
            { not: "state.maintenance['win-1'].status == 'active'" },
          ],
        },
      ],
    };
    expect(refStrings(extractWakeRefs(condition).refs)).toEqual([
      "health:sys-a",
      "maintenance:win-1",
      "slo:obj-x",
    ]);
  });
});

describe("extractWakeRefs — wildcard fallback (uncertain id/kind)", () => {
  it("wildcards the kind when the id is a dynamic key", () => {
    const condition: Condition =
      "state.incident[trigger.payload.incidentId].status == 'open'";
    const out = extractWakeRefs(condition);
    // The dynamic index yields the kind wildcard. The dynamic key itself
    // (`trigger.payload.incidentId`) reads no state, so no extra ref.
    expect(refStrings(out.refs)).toEqual(["incident:*"]);
  });

  it("wildcards when state.<kind> is read with no id", () => {
    const condition: Condition = "state.health.systems != null";
    // `state.health.systems`: kind=health, id=systems is treated as the id
    // segment — a concrete (if unusual) ref. Use a bare-kind case instead:
    const bareKind: Condition = "state.incident != null";
    expect(refStrings(extractWakeRefs(condition).refs)).toEqual([
      "health:systems",
    ]);
    expect(refStrings(extractWakeRefs(bareKind).refs)).toEqual(["incident:*"]);
  });

  it("is indeterminate when even the kind is dynamic", () => {
    const condition: Condition = "state[trigger.kind][trigger.id].status == 1";
    const { refs, indeterminate } = extractWakeRefs(condition);
    expect(refs).toHaveLength(0);
    expect(indeterminate).toBe(true);
  });

  it("is indeterminate for an unparseable template that reads no resolvable state", () => {
    // A condition string with no state.* / health.* root and no parse error
    // references no entity at all → not indeterminate, just empty.
    const noState: Condition = "trigger.payload.count > 5";
    const r1 = extractWakeRefs(noState);
    expect(r1.refs).toHaveLength(0);
    expect(r1.indeterminate).toBe(false);
  });
});
