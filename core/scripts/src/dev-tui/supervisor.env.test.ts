import { describe, expect, it } from "bun:test";
import { buildChildEnv } from "./supervisor.ts";

describe("buildChildEnv", () => {
  it("returns the parent env unchanged (same reference) with no overrides", () => {
    const parentEnv = { PATH: "/usr/bin", FOO: "1" };
    expect(buildChildEnv({ parentEnv })).toBe(parentEnv);
  });

  it("merges def env over the parent env (def wins on conflict)", () => {
    const parentEnv = { PATH: "/usr/bin", PORT: "3000" };
    const merged = buildChildEnv({
      parentEnv,
      defEnv: { PORT: "41234", CHECKSTACK_INSTANCE_NAMESPACE: "preview" },
    });
    expect(merged.PATH).toBe("/usr/bin");
    expect(merged.PORT).toBe("41234");
    expect(merged.CHECKSTACK_INSTANCE_NAMESPACE).toBe("preview");
  });

  it("does not mutate the parent env when overriding", () => {
    const parentEnv = { PORT: "3000" };
    buildChildEnv({ parentEnv, defEnv: { PORT: "9999" } });
    expect(parentEnv.PORT).toBe("3000");
  });
});
