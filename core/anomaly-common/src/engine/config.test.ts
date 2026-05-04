import { describe, test, expect } from "bun:test";
import { resolveEffectiveConfig } from "./config";
import type { AnomalySettings } from "../schema";

describe("Anomaly Engine - Config Override Mechanism", () => {
  const defaultTemplate: AnomalySettings = {
    enabled: true,
    baselineWindow: "7d",
    notify: true,
    fieldOverrides: {},
  };

  test("uses engine defaults when nothing is provided", () => {
    const result = resolveEffectiveConfig("some.field");
    expect(result.enabled).toBe(true);
    expect(result.sensitivity).toBe(1);
    expect(result.confirmationWindow).toBe(3);
    expect(result.direction).toBeUndefined();
    expect(result.driftEnabled).toBe(true);
    expect(result.driftThreshold).toBe(2);
    expect(result.minAbsoluteDelta).toBe(0);
    expect(result.minRelativeDelta).toBe(0);
  });

  test("master enabled toggle cascades from template to assignment to field", () => {
    const template: AnomalySettings = { ...defaultTemplate, enabled: false };
    expect(resolveEffectiveConfig("some.field", template).enabled).toBe(false);

    const assignment: Partial<AnomalySettings> = { enabled: true };
    expect(
      resolveEffectiveConfig("some.field", template, assignment).enabled,
    ).toBe(true);

    // Field override beats both globals.
    const templateWithFieldOff: AnomalySettings = {
      ...defaultTemplate,
      enabled: true,
      fieldOverrides: { "some.field": { enabled: false } },
    };
    expect(
      resolveEffectiveConfig("some.field", templateWithFieldOff).enabled,
    ).toBe(false);
  });

  test("template field override drives sensitivity / confirmation / drift", () => {
    const template: AnomalySettings = {
      ...defaultTemplate,
      fieldOverrides: {
        "some.field": {
          sensitivity: 2,
          confirmationWindow: 5,
          driftEnabled: false,
          driftThreshold: 4,
        },
      },
    };
    const result = resolveEffectiveConfig("some.field", template);
    expect(result.sensitivity).toBe(2);
    expect(result.confirmationWindow).toBe(5);
    expect(result.driftEnabled).toBe(false);
    expect(result.driftThreshold).toBe(4);
  });

  test("assignment field override beats template field override", () => {
    const template: AnomalySettings = {
      ...defaultTemplate,
      fieldOverrides: { "some.field": { sensitivity: 2 } },
    };
    const assignment: Partial<AnomalySettings> = {
      fieldOverrides: { "some.field": { sensitivity: 0.5 } },
    };
    const result = resolveEffectiveConfig("some.field", template, assignment);
    expect(result.sensitivity).toBe(0.5);
  });

  test("schema defaults fill in when no field override is set", () => {
    const result = resolveEffectiveConfig(
      "some.field",
      undefined,
      undefined,
      {
        sensitivity: 1.5,
        confirmationWindow: 5,
        driftEnabled: false,
        driftThreshold: 3,
        minAbsoluteDelta: 50,
        minRelativeDelta: 0.5,
      },
    );
    expect(result.sensitivity).toBe(1.5);
    expect(result.confirmationWindow).toBe(5);
    expect(result.driftEnabled).toBe(false);
    expect(result.driftThreshold).toBe(3);
    expect(result.minAbsoluteDelta).toBe(50);
    expect(result.minRelativeDelta).toBe(0.5);
  });

  test("field override beats schema defaults", () => {
    const template: AnomalySettings = {
      ...defaultTemplate,
      fieldOverrides: { "some.field": { sensitivity: 0.7 } },
    };
    const result = resolveEffectiveConfig(
      "some.field",
      template,
      undefined,
      { sensitivity: 1.5 },
    );
    expect(result.sensitivity).toBe(0.7);
  });

  test("template field override sets direction", () => {
    const template: AnomalySettings = {
      ...defaultTemplate,
      fieldOverrides: { "some.field": { direction: "higher-is-better" } },
    };
    expect(resolveEffectiveConfig("some.field", template).direction).toBe(
      "higher-is-better",
    );
  });

  test("direction is undefined when no override sets it (caller falls back to schema)", () => {
    expect(
      resolveEffectiveConfig("some.field", defaultTemplate).direction,
    ).toBeUndefined();
  });

  test("preserves explicit falsy values", () => {
    const template: AnomalySettings = {
      ...defaultTemplate,
      fieldOverrides: { "some.field": { sensitivity: 0 } },
    };
    expect(resolveEffectiveConfig("some.field", template).sensitivity).toBe(0);
  });

  test("explicit 0 floor from field override re-enables noise (overrides schema default)", () => {
    const template: AnomalySettings = {
      ...defaultTemplate,
      fieldOverrides: { "some.field": { minAbsoluteDelta: 0 } },
    };
    const result = resolveEffectiveConfig(
      "some.field",
      template,
      undefined,
      { minAbsoluteDelta: 50 },
    );
    expect(result.minAbsoluteDelta).toBe(0);
  });

  test("globals other than enabled are ignored — only fieldOverrides shape detection", () => {
    // The schema doesn't accept sensitivity/confirmationWindow/drift* at the
    // global level any more, so even if a stale config carries them they
    // would be stripped by Zod parse. This test asserts that the resolver
    // doesn't accidentally read them off the typed AnomalySettings shape.
    const template: AnomalySettings = { ...defaultTemplate };
    const result = resolveEffectiveConfig("some.field", template);
    expect(result.sensitivity).toBe(1);
    expect(result.confirmationWindow).toBe(3);
    expect(result.driftEnabled).toBe(true);
    expect(result.driftThreshold).toBe(2);
  });
});
