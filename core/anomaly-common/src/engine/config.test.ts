import { describe, test, expect } from "bun:test";
import { resolveEffectiveConfig } from "./config";
import type { AnomalySettings } from "../schema";

describe("Anomaly Engine - Config Override Mechanism", () => {
  const defaultTemplate: AnomalySettings = {
    enabled: true,
    sensitivity: 1,
    confirmationWindow: 3,
    baselineWindow: "7d",
    notify: true,
    driftEnabled: true,
    driftThreshold: 2,
    fieldOverrides: {},
  };

  test("uses defaults when nothing is provided", () => {
    const result = resolveEffectiveConfig("some.field");
    expect(result.enabled).toBe(true);
    expect(result.sensitivity).toBe(1);
    expect(result.confirmationWindow).toBe(3);
    expect(result.direction).toBeUndefined();
    expect(result.driftEnabled).toBe(true);
    expect(result.driftThreshold).toBe(2);
  });

  test("uses template configuration as base", () => {
    const template: AnomalySettings = {
      ...defaultTemplate,
      enabled: false,
      sensitivity: 2,
      confirmationWindow: 5,
    };
    const result = resolveEffectiveConfig("some.field", template);
    expect(result.enabled).toBe(false);
    expect(result.sensitivity).toBe(2);
    expect(result.confirmationWindow).toBe(5);
  });

  test("assignment overrides template global settings", () => {
    const template: AnomalySettings = {
      ...defaultTemplate,
      sensitivity: 1,
      confirmationWindow: 3,
    };
    const assignment: Partial<AnomalySettings> = {
      sensitivity: 3,
      confirmationWindow: 1,
    };
    const result = resolveEffectiveConfig("some.field", template, assignment);
    expect(result.sensitivity).toBe(3);
    expect(result.confirmationWindow).toBe(1);
    expect(result.enabled).toBe(true); // fallbacks to template
  });

  test("template field override overrides template global", () => {
    const template: AnomalySettings = {
      ...defaultTemplate,
      sensitivity: 1,
      fieldOverrides: {
        "some.field": {
          sensitivity: 5,
        },
      },
    };
    const result = resolveEffectiveConfig("some.field", template);
    expect(result.sensitivity).toBe(5);
  });

  test("assignment field override takes absolute precedence", () => {
    const template: AnomalySettings = {
      ...defaultTemplate,
      sensitivity: 1,
      fieldOverrides: {
        "some.field": {
          sensitivity: 5, // template field level
        },
      },
    };
    const assignment: Partial<AnomalySettings> = {
      sensitivity: 2, // assignment global level
      fieldOverrides: {
        "some.field": {
          sensitivity: 10, // assignment field level
        },
      },
    };
    const result = resolveEffectiveConfig("some.field", template, assignment);
    expect(result.sensitivity).toBe(10);
  });

  test("template field override is not overridden by assignment global", () => {
    // This is intentional: field-level overrides (from any layer) represent
    // more specific intent and take precedence over global overrides.
    // See resolveEffectiveConfig JSDoc for the full resolution order.
    const template: AnomalySettings = {
      ...defaultTemplate,
      fieldOverrides: {
        "some.field": {
          enabled: false,
        },
      },
    };
    const assignment: Partial<AnomalySettings> = {
      enabled: true,
    };
    const result = resolveEffectiveConfig("some.field", template, assignment);
    
    // fieldConfig exists (template field: { enabled: false })
    // So fieldConfig.enabled is false — field-level is more specific than assignment global.
    expect(result.enabled).toBe(false);
  });

  test("template field override sets direction", () => {
    const template: AnomalySettings = {
      ...defaultTemplate,
      fieldOverrides: {
        "some.field": {
          direction: "higher-is-better",
        },
      },
    };
    const result = resolveEffectiveConfig("some.field", template);
    expect(result.direction).toBe("higher-is-better");
  });

  test("assignment field override direction beats template field direction", () => {
    const template: AnomalySettings = {
      ...defaultTemplate,
      fieldOverrides: {
        "some.field": { direction: "lower-is-better" },
      },
    };
    const assignment: Partial<AnomalySettings> = {
      fieldOverrides: {
        "some.field": { direction: "deviation" },
      },
    };
    const result = resolveEffectiveConfig("some.field", template, assignment);
    expect(result.direction).toBe("deviation");
  });

  test("direction is undefined when no override sets it (caller falls back to schema)", () => {
    const result = resolveEffectiveConfig("some.field", defaultTemplate);
    expect(result.direction).toBeUndefined();
  });

  test("preserves explicit falsy values", () => {
    const template: AnomalySettings = {
      ...defaultTemplate,
      sensitivity: 2,
    };
    const assignment: Partial<AnomalySettings> = {
      sensitivity: 0,
    };
    const result = resolveEffectiveConfig("some.field", template, assignment);
    expect(result.sensitivity).toBe(0);
  });

  describe("drift settings", () => {
    test("template driftEnabled is honored", () => {
      const template: AnomalySettings = {
        ...defaultTemplate,
        driftEnabled: false,
      };
      const result = resolveEffectiveConfig("some.field", template);
      expect(result.driftEnabled).toBe(false);
    });

    test("assignment driftEnabled overrides template", () => {
      const template: AnomalySettings = {
        ...defaultTemplate,
        driftEnabled: true,
      };
      const assignment: Partial<AnomalySettings> = { driftEnabled: false };
      const result = resolveEffectiveConfig("some.field", template, assignment);
      expect(result.driftEnabled).toBe(false);
    });

    test("field-level driftEnabled wins over assignment global", () => {
      const template: AnomalySettings = {
        ...defaultTemplate,
        fieldOverrides: {
          "some.field": { driftEnabled: false },
        },
      };
      const assignment: Partial<AnomalySettings> = { driftEnabled: true };
      const result = resolveEffectiveConfig("some.field", template, assignment);
      expect(result.driftEnabled).toBe(false);
    });

    test("driftThreshold cascades through layers", () => {
      const template: AnomalySettings = { ...defaultTemplate, driftThreshold: 3 };
      const assignment: Partial<AnomalySettings> = { driftThreshold: 1.5 };
      const result = resolveEffectiveConfig("some.field", template, assignment);
      expect(result.driftThreshold).toBe(1.5);
    });

    test("field-level driftThreshold wins over assignment global", () => {
      const template: AnomalySettings = {
        ...defaultTemplate,
        fieldOverrides: {
          "some.field": { driftThreshold: 4 },
        },
      };
      const assignment: Partial<AnomalySettings> = { driftThreshold: 1.5 };
      const result = resolveEffectiveConfig("some.field", template, assignment);
      expect(result.driftThreshold).toBe(4);
    });
  });
});
