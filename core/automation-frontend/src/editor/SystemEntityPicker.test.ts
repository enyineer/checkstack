import { describe, expect, it } from "bun:test";
import { shouldStartManual } from "./system-entity-picker.logic";

describe("shouldStartManual", () => {
  const known = new Set(["payments-api", "billing"]);

  it("uses the picker for a blank value", () => {
    expect(shouldStartManual({ value: "", knownSystemIds: known })).toBe(false);
  });

  it("uses the picker for a known system id", () => {
    expect(
      shouldStartManual({ value: "payments-api", knownSystemIds: known }),
    ).toBe(false);
  });

  it("falls back to manual entry for an unknown id (preserves round-trip)", () => {
    expect(
      shouldStartManual({ value: "future-system", knownSystemIds: known }),
    ).toBe(true);
  });

  it("falls back to manual entry for a template", () => {
    expect(
      shouldStartManual({
        value: "{{ trigger.payload.system }}",
        knownSystemIds: known,
      }),
    ).toBe(true);
  });

  it("treats a template as manual even against an empty catalog", () => {
    expect(
      shouldStartManual({ value: "{{ x }}", knownSystemIds: new Set() }),
    ).toBe(true);
  });
});
