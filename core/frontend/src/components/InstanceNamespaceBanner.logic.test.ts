import { describe, expect, it } from "bun:test";
import { describeInstanceBanner } from "./InstanceNamespaceBanner.logic";

describe("describeInstanceBanner", () => {
  it("returns null for the default instance", () => {
    expect(describeInstanceBanner({ namespace: undefined })).toBeNull();
    expect(describeInstanceBanner({ namespace: null })).toBeNull();
    expect(describeInstanceBanner({ namespace: "" })).toBeNull();
    expect(describeInstanceBanner({ namespace: "   " })).toBeNull();
  });

  it("returns a labelled view for a secondary instance", () => {
    const view = describeInstanceBanner({ namespace: "preview" });
    expect(view).not.toBeNull();
    expect(view?.label).toBe("Preview instance: preview");
    expect(view?.title).toContain("preview");
  });

  it("trims surrounding whitespace in the namespace", () => {
    const view = describeInstanceBanner({ namespace: "  pr-380  " });
    expect(view?.label).toBe("Preview instance: pr-380");
  });
});
