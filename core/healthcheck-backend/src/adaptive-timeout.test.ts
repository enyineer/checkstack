import { describe, expect, test } from "bun:test";
import {
  adaptiveTimeout,
  DEFAULT_TIMEOUT_ABSOLUTE_FLOOR_MS,
} from "./adaptive-timeout";

describe("adaptiveTimeout", () => {
  const configuredMs = 30_000;

  test("guardrail 1: no baseline => never shrink", () => {
    expect(
      adaptiveTimeout({
        configuredMs,
        healthyBaselineMs: undefined,
        isSuspect: true,
        isRecoveryProbe: false,
      }),
    ).toBe(configuredMs);
  });

  test("non-suspect check keeps the full configured timeout", () => {
    expect(
      adaptiveTimeout({
        configuredMs,
        healthyBaselineMs: 200,
        isSuspect: false,
        isRecoveryProbe: false,
      }),
    ).toBe(configuredMs);
  });

  test("guardrail 3: recovery probe always uses the full configured timeout", () => {
    expect(
      adaptiveTimeout({
        configuredMs,
        healthyBaselineMs: 200,
        isSuspect: true,
        isRecoveryProbe: true,
      }),
    ).toBe(configuredMs);
  });

  test("fast healthy check shrinks toward the floor (200ms => ~1s)", () => {
    // 200 * 1.5 = 300 < floor => clamped to the absolute floor.
    expect(
      adaptiveTimeout({
        configuredMs,
        healthyBaselineMs: 200,
        isSuspect: true,
        isRecoveryProbe: false,
      }),
    ).toBe(DEFAULT_TIMEOUT_ABSOLUTE_FLOOR_MS);
  });

  test("deadlock guard: a slow-but-healthy check (10s) never shrinks below its own latency", () => {
    // 10_000 * 1.5 = 15_000: a recovering 10s run still passes at 15s.
    const t = adaptiveTimeout({
      configuredMs,
      healthyBaselineMs: 10_000,
      isSuspect: true,
      isRecoveryProbe: false,
    });
    expect(t).toBe(15_000);
    expect(t).toBeGreaterThan(10_000);
  });

  test("shrink never exceeds the configured timeout", () => {
    // baseline*factor would exceed configured => clamp down to configured.
    expect(
      adaptiveTimeout({
        configuredMs: 5_000,
        healthyBaselineMs: 8_000,
        isSuspect: true,
        isRecoveryProbe: false,
      }),
    ).toBe(5_000);
  });

  test("honors custom safetyFactor and absoluteFloor", () => {
    expect(
      adaptiveTimeout({
        configuredMs,
        healthyBaselineMs: 1_000,
        isSuspect: true,
        isRecoveryProbe: false,
        safetyFactor: 2,
        absoluteFloorMs: 500,
      }),
    ).toBe(2_000);
  });
});
