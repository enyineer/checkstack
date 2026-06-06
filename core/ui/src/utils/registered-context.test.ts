import { describe, it, expect } from "bun:test";
import { createRegisteredContext } from "./registered-context";

describe("createRegisteredContext", () => {
  it("returns the SAME context instance for a repeated key (singleton)", () => {
    // Simulates two bundled copies of @checkstack/ui registering the same
    // context: the second call must reuse the first's instance.
    const first = createRegisteredContext<number>("test.same", 1);
    const second = createRegisteredContext<number>("test.same", 999);
    expect(second).toBe(first);
  });

  it("returns distinct contexts for distinct keys", () => {
    const a = createRegisteredContext<number>("test.a", 0);
    const b = createRegisteredContext<number>("test.b", 0);
    expect(a).not.toBe(b);
  });

  it("supports an omitted default for an undefined-capable T", () => {
    const ctx = createRegisteredContext<string | undefined>("test.optional");
    expect(ctx).toBeDefined();
    // Re-registration under the same key still returns the same instance.
    expect(createRegisteredContext<string | undefined>("test.optional")).toBe(
      ctx,
    );
  });
});
