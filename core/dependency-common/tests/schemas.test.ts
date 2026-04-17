import { describe, test, expect } from "bun:test";
import {
  CreateDependencyInputSchema,
  ImpactTypeSchema,
  DerivedStateSchema,
} from "@checkstack/dependency-common";

describe("dependency-common schemas", () => {
  describe("ImpactTypeSchema", () => {
    test("accepts valid impact types", () => {
      expect(ImpactTypeSchema.parse("informational")).toBe("informational");
      expect(ImpactTypeSchema.parse("degraded")).toBe("degraded");
      expect(ImpactTypeSchema.parse("critical")).toBe("critical");
    });

    test("rejects invalid impact types", () => {
      expect(() => ImpactTypeSchema.parse("invalid")).toThrow();
    });
  });

  describe("DerivedStateSchema", () => {
    test("accepts valid derived states", () => {
      expect(DerivedStateSchema.parse("info")).toBe("info");
      expect(DerivedStateSchema.parse("degraded")).toBe("degraded");
      expect(DerivedStateSchema.parse("down")).toBe("down");
    });

    test("rejects invalid derived states", () => {
      expect(() => DerivedStateSchema.parse("invalid")).toThrow();
    });
  });

  describe("CreateDependencyInputSchema", () => {
    test("accepts valid input", () => {
      const input = CreateDependencyInputSchema.parse({
        sourceSystemId: "sys-a",
        targetSystemId: "sys-b",
        impactType: "degraded",
      });

      expect(input.sourceSystemId).toBe("sys-a");
      expect(input.targetSystemId).toBe("sys-b");
      expect(input.impactType).toBe("degraded");
      expect(input.transitive).toBe(false); // default
      expect(input.healthCheckRules).toEqual([]); // default
    });

    test("rejects self-referencing dependency", () => {
      expect(() =>
        CreateDependencyInputSchema.parse({
          sourceSystemId: "sys-a",
          targetSystemId: "sys-a",
          impactType: "degraded",
        }),
      ).toThrow("A system cannot depend on itself");
    });

    test("rejects empty source system", () => {
      expect(() =>
        CreateDependencyInputSchema.parse({
          sourceSystemId: "",
          targetSystemId: "sys-b",
          impactType: "degraded",
        }),
      ).toThrow();
    });

    test("rejects empty target system", () => {
      expect(() =>
        CreateDependencyInputSchema.parse({
          sourceSystemId: "sys-a",
          targetSystemId: "",
          impactType: "degraded",
        }),
      ).toThrow();
    });

    test("accepts health check rules", () => {
      const input = CreateDependencyInputSchema.parse({
        sourceSystemId: "sys-a",
        targetSystemId: "sys-b",
        impactType: "degraded",
        healthCheckRules: [
          {
            healthCheckId: "hc-1",
            overrideImpactType: "critical",
          },
        ],
      });

      expect(input.healthCheckRules).toHaveLength(1);
      expect(input.healthCheckRules[0].healthCheckId).toBe("hc-1");
      expect(input.healthCheckRules[0].overrideImpactType).toBe("critical");
    });
  });
});
