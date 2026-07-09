import { describe, expect, it } from "bun:test";
import { presentDependencyImpact } from "./impact.logic";

describe("presentDependencyImpact", () => {
  const names = { systemName: "Checkout", neighbourName: "Payments" };

  it("labels the edge as an impact classification, not a status", () => {
    expect(
      presentDependencyImpact({
        impactType: "critical",
        direction: "depends-on",
        ...names,
      }).label,
    ).toBe("Critical impact");
    expect(
      presentDependencyImpact({
        impactType: "degraded",
        direction: "depends-on",
        ...names,
      }).label,
    ).toBe("Degrading impact");
    expect(
      presentDependencyImpact({
        impactType: "informational",
        direction: "depends-on",
        ...names,
      }).label,
    ).toBe("Informational");
  });

  it("maps each impact type to its tone", () => {
    expect(
      presentDependencyImpact({
        impactType: "critical",
        direction: "depends-on",
        ...names,
      }).tone,
    ).toBe("critical");
    expect(
      presentDependencyImpact({
        impactType: "degraded",
        direction: "depends-on",
        ...names,
      }).tone,
    ).toBe("degraded");
    expect(
      presentDependencyImpact({
        impactType: "informational",
        direction: "depends-on",
        ...names,
      }).tone,
    ).toBe("informational");
  });

  it("for 'depends-on', the neighbour is the cause and this system suffers", () => {
    const { description } = presentDependencyImpact({
      impactType: "critical",
      direction: "depends-on",
      ...names,
    });
    // Payments (neighbour/upstream) going down takes Checkout (this system) down.
    expect(description).toBe(
      "Critical dependency. If Payments goes down, Checkout is treated as down.",
    );
  });

  it("for 'depended-on-by', this system is the cause and the neighbour suffers", () => {
    const { description } = presentDependencyImpact({
      impactType: "critical",
      direction: "depended-on-by",
      ...names,
    });
    // Checkout (this system/upstream) going down takes Payments (neighbour) down.
    expect(description).toBe(
      "Critical dependency. If Checkout goes down, Payments is treated as down.",
    );
  });

  it("degraded and informational descriptions are directional too", () => {
    expect(
      presentDependencyImpact({
        impactType: "degraded",
        direction: "depended-on-by",
        ...names,
      }).description,
    ).toBe("If Checkout is affected, Payments is treated as degraded.");
    expect(
      presentDependencyImpact({
        impactType: "informational",
        direction: "depends-on",
        ...names,
      }).description,
    ).toBe("Linked for context only. Payments's status does not affect Checkout.");
  });
});
