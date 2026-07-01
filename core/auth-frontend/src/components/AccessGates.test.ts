import { describe, expect, it } from "bun:test";
import { resolveGate } from "./AccessGates";

// Sentinels stand in for React nodes; resolveGate is node-agnostic.
const CHILDREN = "children";
const FALLBACK = "fallback";
const LOADING = "loading";

describe("resolveGate", () => {
  it("shows the loading fallback while loading (fail-closed, ignores allowed)", () => {
    expect(
      resolveGate({
        loading: true,
        allowed: true,
        children: CHILDREN,
        fallback: FALLBACK,
        loadingFallback: LOADING,
      }),
    ).toBe(LOADING);
  });

  it("shows children when allowed", () => {
    expect(
      resolveGate({
        loading: false,
        allowed: true,
        children: CHILDREN,
        fallback: FALLBACK,
        loadingFallback: LOADING,
      }),
    ).toBe(CHILDREN);
  });

  it("shows the fallback when not allowed", () => {
    expect(
      resolveGate({
        loading: false,
        allowed: false,
        children: CHILDREN,
        fallback: FALLBACK,
        loadingFallback: LOADING,
      }),
    ).toBe(FALLBACK);
  });
});
