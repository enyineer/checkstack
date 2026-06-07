import { describe, expect, test } from "bun:test";
import { access, accessPair, isAccessRuleSatisfied } from "./access-utils";

describe("isAccessRuleSatisfied - qualified ids", () => {
  // Granted ids are stored fully-qualified (`{pluginId}.{ruleId}`); rules carry
  // their owning pluginId so the check qualifies before matching. This prevents
  // collisions when two plugins define the same short rule id.
  const incidentRead = access("incident", "read", "", { pluginId: "incident" });
  const incidentManage = access("incident", "manage", "", {
    pluginId: "incident",
  });

  test("matches a qualified granted id", () => {
    expect(
      isAccessRuleSatisfied(["incident.incident.read"], incidentRead),
    ).toBe(true);
  });

  test("does NOT match the unqualified id when a pluginId is set", () => {
    // The whole point: a bare "incident.read" grant must not satisfy a rule that
    // belongs to the "incident" plugin (collision safety).
    expect(isAccessRuleSatisfied(["incident.read"], incidentRead)).toBe(false);
  });

  test("does not collide across plugins with the same short id", () => {
    // Plugin A granted; plugin B's identically-named rule must NOT be satisfied.
    const ruleA = access("thing", "read", "", { pluginId: "plugin-a" });
    const ruleB = access("thing", "read", "", { pluginId: "plugin-b" });
    const granted = ["plugin-a.thing.read"];
    expect(isAccessRuleSatisfied(granted, ruleA)).toBe(true);
    expect(isAccessRuleSatisfied(granted, ruleB)).toBe(false);
  });

  test("manage grant escalates to read (qualified)", () => {
    expect(
      isAccessRuleSatisfied(["incident.incident.manage"], incidentRead),
    ).toBe(true);
  });

  test("read grant does NOT escalate to manage", () => {
    expect(
      isAccessRuleSatisfied(["incident.incident.read"], incidentManage),
    ).toBe(false);
  });

  test("wildcard satisfies anything", () => {
    expect(isAccessRuleSatisfied(["*"], incidentManage)).toBe(true);
  });

  test("accessPair stamps pluginId on both levels", () => {
    const pair = accessPair(
      "system",
      { read: { description: "" }, manage: { description: "" } },
      { pluginId: "catalog" },
    );
    expect(pair.read.pluginId).toBe("catalog");
    expect(pair.manage.pluginId).toBe("catalog");
    expect(isAccessRuleSatisfied(["catalog.system.read"], pair.read)).toBe(true);
    expect(isAccessRuleSatisfied(["catalog.system.manage"], pair.read)).toBe(
      true,
    ); // escalation
  });

  test("only the qualified form is ever matched (no unqualified fallback)", () => {
    const rule = access("teams", "read", "", { pluginId: "auth" });
    expect(isAccessRuleSatisfied(["auth.teams.read"], rule)).toBe(true);
    // A bare, unqualified grant must NEVER satisfy a qualified rule.
    expect(isAccessRuleSatisfied(["teams.read"], rule)).toBe(false);
    expect(isAccessRuleSatisfied([], rule)).toBe(false);
  });
});
