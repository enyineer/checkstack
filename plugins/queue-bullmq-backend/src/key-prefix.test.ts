import { describe, expect, it } from "bun:test";
import { composeEffectiveKeyPrefix } from "./key-prefix";

describe("composeEffectiveKeyPrefix", () => {
  it("returns the configured prefix verbatim for the default instance", () => {
    expect(
      composeEffectiveKeyPrefix({ keyPrefix: "checkstack:", namespace: "" }),
    ).toBe("checkstack:");
    expect(
      composeEffectiveKeyPrefix({ keyPrefix: "myapp", namespace: "" }),
    ).toBe("myapp");
  });

  it("inserts the namespace as its own colon-delimited segment", () => {
    expect(
      composeEffectiveKeyPrefix({
        keyPrefix: "checkstack:",
        namespace: "preview",
      }),
    ).toBe("checkstack:preview:");
  });

  it("normalizes a missing trailing colon on the configured prefix", () => {
    expect(
      composeEffectiveKeyPrefix({ keyPrefix: "myapp", namespace: "preview" }),
    ).toBe("myapp:preview:");
  });

  it("never produces a doubled separator", () => {
    const result = composeEffectiveKeyPrefix({
      keyPrefix: "checkstack:",
      namespace: "pr-380",
    });
    expect(result).not.toContain("::");
    expect(result).toBe("checkstack:pr-380:");
  });

  it("keeps default and secondary key spaces disjoint (neither a prefix that scans the other's operational keys)", () => {
    const def = composeEffectiveKeyPrefix({
      keyPrefix: "checkstack:",
      namespace: "",
    });
    const sec = composeEffectiveKeyPrefix({
      keyPrefix: "checkstack:",
      namespace: "preview",
    });
    // BullMQ operational keys are `${prefix}:${queueName}:...`. The default's
    // per-queue scan pattern `${def}:<q>:*` cannot match a secondary key, since
    // after `checkstack:` the secondary has `preview`, not the queue name.
    expect(sec.startsWith(`${def}preview`)).toBe(true);
    expect(def).not.toBe(sec);
  });
});
