import { describe, expect, it } from "bun:test";
import { resolvePersistedConfigId } from "./configEditing.logic";

describe("resolvePersistedConfigId", () => {
  it("returns undefined for the 'new' sentinel so IDE plugin slots do not mount", () => {
    // Regression: a truthy "new" defeated `enabled: !!configurationId` guards,
    // so the Anomaly Defaults panel fired getAnomalyConfig/getConfiguration with
    // id "new" and the parent-scope lookup 400'd until the check was saved.
    expect(resolvePersistedConfigId("new")).toBeUndefined();
  });

  it("returns undefined when there is no id at all", () => {
    expect(resolvePersistedConfigId(undefined)).toBeUndefined();
    expect(resolvePersistedConfigId("")).toBeUndefined();
  });

  it("passes through a real persisted configuration id", () => {
    expect(resolvePersistedConfigId("cfg_123")).toBe("cfg_123");
  });
});
