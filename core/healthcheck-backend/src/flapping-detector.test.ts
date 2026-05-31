import { describe, it, expect, mock } from "bun:test";
import type { HealthCheckStatus } from "@checkstack/healthcheck-common";
import { createMockLogger } from "@checkstack/test-utils-backend";
import {
  detectAndEmitFlapping,
  isTransitionToUnhealthy,
} from "./flapping-detector";

const logger = createMockLogger();
const ALL: HealthCheckStatus[] = ["healthy", "degraded", "unhealthy"];

describe("isTransitionToUnhealthy", () => {
  it("true on non-unhealthy → unhealthy", () => {
    expect(isTransitionToUnhealthy("healthy", "unhealthy")).toBe(true);
    expect(isTransitionToUnhealthy("degraded", "unhealthy")).toBe(true);
    expect(isTransitionToUnhealthy(undefined, "unhealthy")).toBe(true);
  });
  it("false when staying unhealthy", () => {
    expect(isTransitionToUnhealthy("unhealthy", "unhealthy")).toBe(false);
  });
  it("false transitioning to non-unhealthy", () => {
    for (const next of ALL) {
      if (next === "unhealthy") continue;
      for (const prev of [...ALL, undefined]) {
        expect(isTransitionToUnhealthy(prev, next)).toBe(false);
      }
    }
  });
});

/**
 * Mock db for recordUnhealthyTransition: insert(...).values(...) then
 * select({count}).from(...).where(...) resolving to [{count}].
 */
function makeDb(count: number) {
  const values = mock(() => Promise.resolve());
  const where = mock(() => Promise.resolve([{ count }]));
  return {
    insert: mock(() => ({ values })),
    select: mock(() => ({ from: mock(() => ({ where })) })),
  };
}

const trigger = { enabled: true, transitions: 3, windowMinutes: 60 };

describe("detectAndEmitFlapping", () => {
  it("no-op when not a transition (no insert, no emit)", async () => {
    const db = makeDb(5);
    const emit = mock(async () => {});
    await detectAndEmitFlapping({
      db: db as never,
      configurationId: "c",
      systemId: "s",
      flappingTrigger: trigger,
      isTransition: false,
      getEmitHook: () => emit,
      logger,
    });
    expect(db.insert).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("records the transition but does NOT emit below the threshold", async () => {
    const db = makeDb(2); // below transitions: 3
    const emit = mock(async () => {});
    await detectAndEmitFlapping({
      db: db as never,
      configurationId: "c",
      systemId: "s",
      flappingTrigger: trigger,
      isTransition: true,
      getEmitHook: () => emit,
      logger,
    });
    expect(db.insert).toHaveBeenCalledTimes(1); // transition recorded
    expect(emit).not.toHaveBeenCalled();
  });

  it("emits flapping_detected once the threshold is crossed", async () => {
    const db = makeDb(3);
    const emit = mock(async () => {});
    await detectAndEmitFlapping({
      db: db as never,
      configurationId: "c",
      systemId: "s",
      flappingTrigger: trigger,
      isTransition: true,
      getEmitHook: () => emit,
      logger,
    });
    expect(emit).toHaveBeenCalledTimes(1);
    const call = emit.mock.calls[0] as unknown as [
      { id: string },
      Record<string, unknown>,
    ];
    expect(call[0].id).toBe("healthcheck.flapping_detected");
    expect(call[1].transitionCount).toBe(3);
    expect(call[1].systemId).toBe("s");
  });

  it("records the transition but skips emit when the flapping trigger is disabled", async () => {
    const db = makeDb(9);
    const emit = mock(async () => {});
    await detectAndEmitFlapping({
      db: db as never,
      configurationId: "c",
      systemId: "s",
      flappingTrigger: { ...trigger, enabled: false },
      isTransition: true,
      getEmitHook: () => emit,
      logger,
    });
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  });
});
