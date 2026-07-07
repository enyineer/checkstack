import { describe, it, expect } from "bun:test";

import { gatedQueryEnabled } from "./orpc-query";

// The guaranteed-403 guard: a gate-fused query must fire ONLY when the caller
// left it enabled AND the authorization gate resolved to `allowed`.
describe("gatedQueryEnabled", () => {
  it("fires when the caller did not touch `enabled` and the gate allows", () => {
    expect(
      gatedQueryEnabled({ callerEnabled: undefined, gateAllowed: true }),
    ).toBe(true);
  });

  it("fires when the caller explicitly enabled it and the gate allows", () => {
    expect(gatedQueryEnabled({ callerEnabled: true, gateAllowed: true })).toBe(
      true,
    );
  });

  it("does NOT fire when the gate denies, even if the caller enabled it", () => {
    // The core guarantee: no guaranteed-403 fetch for an unauthorized caller.
    expect(gatedQueryEnabled({ callerEnabled: true, gateAllowed: false })).toBe(
      false,
    );
    expect(
      gatedQueryEnabled({ callerEnabled: undefined, gateAllowed: false }),
    ).toBe(false);
  });

  it("does NOT fire when the gate is still resolving (allowed=false)", () => {
    // `allowed` is false while the verdict resolves, so the fetch waits for it.
    expect(
      gatedQueryEnabled({ callerEnabled: undefined, gateAllowed: false }),
    ).toBe(false);
  });

  it("respects a caller who explicitly disabled the query, even when allowed", () => {
    expect(gatedQueryEnabled({ callerEnabled: false, gateAllowed: true })).toBe(
      false,
    );
  });
});
