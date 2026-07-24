import { describe, it, expect } from "bun:test";
import { resolveHealthBadge } from "./systemHealthBadge.logic";

describe("resolveHealthBadge", () => {
  it("renders no badge for a healthy system", () => {
    expect(resolveHealthBadge({ status: "healthy" })).toBeNull();
  });

  it("renders NO badge for an unknown (unmeasured) system - regression for the false 'Degraded'", () => {
    // A system with no checks (or none run yet) is `unknown`. It must NOT show
    // "Degraded": that was the bug where the badge only excluded `healthy`.
    expect(resolveHealthBadge({ status: "unknown" })).toBeNull();
  });

  it("renders no badge while status is still loading (undefined)", () => {
    expect(resolveHealthBadge({ status: undefined })).toBeNull();
  });

  it("renders a warn 'Degraded' badge for a degraded system", () => {
    expect(resolveHealthBadge({ status: "degraded" })).toEqual({
      tone: "warn",
      label: "Degraded",
    });
  });

  it("renders an error 'Unhealthy' badge for an unhealthy system", () => {
    expect(resolveHealthBadge({ status: "unhealthy" })).toEqual({
      tone: "error",
      label: "Unhealthy",
    });
  });

  it("appends the incident override reason without changing the tone", () => {
    expect(
      resolveHealthBadge({
        status: "unhealthy",
        overrideReason: "Checkout outage",
      }),
    ).toEqual({
      tone: "error",
      label: "Unhealthy - forced by incident: Checkout outage",
    });
  });

  it("does not manufacture a badge from an override reason when the status itself is unknown", () => {
    // The status decides whether there is a badge at all; an override reason on
    // an unmeasured system must not resurrect the false "Degraded".
    expect(
      resolveHealthBadge({ status: "unknown", overrideReason: "stale" }),
    ).toBeNull();
  });
});
