import { describe, expect, it } from "bun:test";
import {
  clampStepIndex,
  getStepStatus,
  isConnectorComplete,
  isStepSelectable,
} from "./Stepper.logic";

describe("Stepper - step status", () => {
  it("marks indexes before the active step completed", () => {
    expect(getStepStatus({ index: 0, activeStep: 2 })).toBe("completed");
    expect(getStepStatus({ index: 1, activeStep: 2 })).toBe("completed");
  });

  it("marks the active step current and later steps upcoming", () => {
    expect(getStepStatus({ index: 2, activeStep: 2 })).toBe("current");
    expect(getStepStatus({ index: 3, activeStep: 2 })).toBe("upcoming");
  });
});

describe("Stepper - clampStepIndex", () => {
  it("keeps an in-range index untouched", () => {
    expect(clampStepIndex({ index: 2, count: 5 })).toBe(2);
  });

  it("clamps below zero up to the first step", () => {
    expect(clampStepIndex({ index: -3, count: 5 })).toBe(0);
  });

  it("clamps past the end down to the last step", () => {
    expect(clampStepIndex({ index: 9, count: 5 })).toBe(4);
  });

  it("collapses an empty stepper to zero", () => {
    expect(clampStepIndex({ index: 4, count: 0 })).toBe(0);
    expect(clampStepIndex({ index: 4, count: -1 })).toBe(0);
  });
});

describe("Stepper - selectability", () => {
  it("only allows navigating back to completed steps when a handler exists", () => {
    expect(
      isStepSelectable({ index: 0, activeStep: 2, hasSelectHandler: true }),
    ).toBe(true);
  });

  it("never selects the current or an upcoming step", () => {
    expect(
      isStepSelectable({ index: 2, activeStep: 2, hasSelectHandler: true }),
    ).toBe(false);
    expect(
      isStepSelectable({ index: 3, activeStep: 2, hasSelectHandler: true }),
    ).toBe(false);
  });

  it("is never selectable without a handler, even for completed steps", () => {
    expect(
      isStepSelectable({ index: 0, activeStep: 2, hasSelectHandler: false }),
    ).toBe(false);
  });
});

describe("Stepper - connector fill", () => {
  it("fills the segment leaving a completed step", () => {
    expect(isConnectorComplete({ fromIndex: 0, activeStep: 2 })).toBe(true);
    expect(isConnectorComplete({ fromIndex: 1, activeStep: 2 })).toBe(true);
  });

  it("leaves the segment leaving the current or an upcoming step unfilled", () => {
    expect(isConnectorComplete({ fromIndex: 2, activeStep: 2 })).toBe(false);
    expect(isConnectorComplete({ fromIndex: 3, activeStep: 2 })).toBe(false);
  });
});
