import { describe, it, expect } from "bun:test";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";
import {
  createDefaultFilterRegistry,
  evaluateBoolean,
  parseCondition,
} from "@checkstack/template-engine";
import {
  buildFlappingAutomation,
  buildSustainedAutomation,
  planForAssignment,
} from "./from-auto-incident-policies";

type Policy = Parameters<typeof buildSustainedAutomation>[0]["policy"];

function assignment(over: Partial<Policy> = {}) {
  return {
    systemId: "sys-1",
    configurationId: "cfg-1",
    configurationName: "API health",
    policy: {
      autoOpenIncidentOnUnhealthy: true,
      useNotificationSuppression: true,
      skipDuringMaintenance: true,
      sustainedUnhealthyTrigger: { enabled: true, durationMinutes: 30 },
      flappingTrigger: { enabled: true, transitions: 3, windowMinutes: 60 },
      autoCloseAfterMinutes: 30,
      ...over,
    },
  };
}

describe("buildSustainedAutomation", () => {
  it("maps durationMinutes → the trigger `for:` dwell", () => {
    const def = buildSustainedAutomation(assignment())!;
    expect(def.triggers[0]?.event).toBe("healthcheck.system_degraded");
    expect(def.triggers[0]?.for).toEqual({ minutes: 30 });
  });

  it("respects a custom sustained duration", () => {
    const def = buildSustainedAutomation(
      assignment({ sustainedUnhealthyTrigger: { enabled: true, durationMinutes: 5 } }),
    )!;
    expect(def.triggers[0]?.for).toEqual({ minutes: 5 });
  });

  it("maps useNotificationSuppression → incident.create suppressNotifications", () => {
    const on = buildSustainedAutomation(assignment())!;
    const create = on.actions[0] as unknown as {
      config: { suppressNotifications: boolean };
    };
    expect(create.config.suppressNotifications).toBe(true);

    const off = buildSustainedAutomation(
      assignment({ useNotificationSuppression: false }),
    )!;
    const createOff = off.actions[0] as unknown as {
      config: { suppressNotifications: boolean };
    };
    expect(createOff.config.suppressNotifications).toBe(false);
  });

  it("sets dedupe_open_for_system so at most one incident opens per system", () => {
    const create = buildSustainedAutomation(assignment())!.actions[0] as unknown as {
      config: { dedupe_open_for_system: boolean };
    };
    expect(create.config.dedupe_open_for_system).toBe(true);
  });

  it("maps skipDuringMaintenance → the maintenance pre-run condition", () => {
    const on = buildSustainedAutomation(assignment())!;
    expect(on.conditions).toContain("!health.system.in_maintenance");
    const off = buildSustainedAutomation(
      assignment({ skipDuringMaintenance: false }),
    )!;
    expect(off.conditions).toHaveLength(0);
  });

  it("maps autoCloseAfterMinutes → a wait_until + resolve, in the cooldown", () => {
    const def = buildSustainedAutomation(assignment({ autoCloseAfterMinutes: 45 }))!;
    // open, await_recovery (wait_until), resolve
    expect(def.actions).toHaveLength(3);
    const wait = def.actions[1] as {
      wait_until: { condition: { and: string[] } };
    };
    expect(wait.wait_until.condition.and[1]).toContain("45 | minutes");
    const resolve = def.actions[2] as { action: string };
    expect(resolve.action).toBe("incident.resolve");
  });

  it("omits auto-close (no wait/resolve) when cooldown is null", () => {
    const def = buildSustainedAutomation(
      assignment({ autoCloseAfterMinutes: null }),
    )!;
    expect(def.actions).toHaveLength(1); // just the open
  });

  it("uses per-system concurrency dedup", () => {
    const def = buildSustainedAutomation(assignment())!;
    expect(def.concurrency_scope).toBe("context_key");
    expect(def.mode).toBe("single");
  });

  it("returns undefined when auto-open is off or the sustained trigger is disabled", () => {
    expect(
      buildSustainedAutomation(assignment({ autoOpenIncidentOnUnhealthy: false })),
    ).toBeUndefined();
    expect(
      buildSustainedAutomation(
        assignment({ sustainedUnhealthyTrigger: { enabled: false, durationMinutes: 30 } }),
      ),
    ).toBeUndefined();
  });

  it("produces a schema-valid definition", () => {
    const def = buildSustainedAutomation(assignment())!;
    expect(AutomationDefinitionSchema.safeParse(def).success).toBe(true);
  });
});

describe("buildFlappingAutomation", () => {
  it("triggers on flapping_detected filtered to the system + config", () => {
    const def = buildFlappingAutomation(assignment())!;
    expect(def.triggers[0]?.event).toBe("healthcheck.flapping_detected");
    expect(def.triggers[0]?.filter).toContain('"sys-1"');
    expect(def.triggers[0]?.filter).toContain('"cfg-1"');
  });

  it("opens a critical, deduped incident referencing the system", () => {
    const def = buildFlappingAutomation(assignment())!;
    const create = def.actions[0] as unknown as {
      action: string;
      config: {
        systemIds: string[];
        severity: string;
        dedupe_open_for_system: boolean;
      };
    };
    expect(create.action).toBe("incident.create");
    expect(create.config.systemIds).toEqual(["{{ trigger.payload.systemId }}"]);
    // critical for parity with the old path + deduped per system.
    expect(create.config.severity).toBe("critical");
    expect(create.config.dedupe_open_for_system).toBe(true);
  });

  it("returns undefined when the flapping trigger is disabled", () => {
    expect(
      buildFlappingAutomation(
        assignment({
          flappingTrigger: { enabled: false, transitions: 3, windowMinutes: 60 },
        }),
      ),
    ).toBeUndefined();
  });

  it("produces a schema-valid definition", () => {
    const def = buildFlappingAutomation(assignment())!;
    expect(AutomationDefinitionSchema.safeParse(def).success).toBe(true);
  });
});

describe("filter id escaping (L3)", () => {
  const filters = createDefaultFilterRegistry();

  /** Evaluate a trigger filter expression against a payload. */
  const matches = (filter: string, payload: Record<string, unknown>) =>
    evaluateBoolean(parseCondition(filter), { trigger: { payload } }, {
      filters,
    });

  it("escapes a systemId containing a double quote so the filter is valid + exact", () => {
    // An id with a quote would, with naive interpolation, produce
    //   trigger.payload.systemId == "sys-"evil"-1"
    // which is a broken/injectable expression. JSON.stringify must escape it.
    const evilId = 'sys-"evil"-1';
    const def = buildSustainedAutomation({
      ...assignment(),
      systemId: evilId,
    })!;
    const filter = def.triggers[0]!.filter!;

    // Parses without throwing and matches ONLY the exact id.
    expect(matches(filter, { systemId: evilId })).toBe(true);
    expect(matches(filter, { systemId: "sys-evil-1" })).toBe(false);
    expect(matches(filter, { systemId: 'sys-"evil"-2' })).toBe(false);
  });

  it("escapes a backslash in the id", () => {
    const backslashId = "sys\\1";
    const def = buildSustainedAutomation({
      ...assignment(),
      systemId: backslashId,
    })!;
    const filter = def.triggers[0]!.filter!;
    expect(matches(filter, { systemId: backslashId })).toBe(true);
    expect(matches(filter, { systemId: "sys1" })).toBe(false);
  });

  it("escapes both systemId and configurationId in the flapping filter", () => {
    const evilSystem = 'sys-"x"';
    const evilConfig = 'cfg-"y"';
    const def = buildFlappingAutomation({
      ...assignment(),
      systemId: evilSystem,
      configurationId: evilConfig,
    })!;
    const filter = def.triggers[0]!.filter!;
    expect(
      matches(filter, { systemId: evilSystem, configurationId: evilConfig }),
    ).toBe(true);
    // Wrong config → no match (the && both-sides escaping holds).
    expect(
      matches(filter, { systemId: evilSystem, configurationId: "cfg-other" }),
    ).toBe(false);
  });
});

describe("planForAssignment", () => {
  it("seeds both sustained + flapping with distinct managed_by tags", () => {
    const plans = planForAssignment(assignment());
    expect(plans).toHaveLength(2);
    const tags = plans.map((p) => p.managedBy);
    expect(tags).toContain("auto-incident:sys-1:cfg-1:sustained");
    expect(tags).toContain("auto-incident:sys-1:cfg-1:flapping");
  });

  it("seeds nothing when auto-open is off", () => {
    expect(
      planForAssignment(assignment({ autoOpenIncidentOnUnhealthy: false })),
    ).toHaveLength(0);
  });

  it("seeds only sustained when flapping is disabled", () => {
    const plans = planForAssignment(
      assignment({
        flappingTrigger: { enabled: false, transitions: 3, windowMinutes: 60 },
      }),
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]?.managedBy).toContain(":sustained");
  });
});
