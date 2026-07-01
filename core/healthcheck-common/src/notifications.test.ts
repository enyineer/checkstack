import { describe, expect, it } from "bun:test";
import { systemHealthCollapseKey } from "./notifications";

/**
 * The collapse-key builder is variadic: per-env notifications append the
 * `environmentId` to scope the collapse identity, so two failing environments
 * of one system generate two independent cards instead of merging into one.
 * The bare `systemHealthCollapseKey(systemId)` form is used by the rollup
 * transition, preserving the pre-existing single-card identity.
 */
describe("systemHealthCollapseKey", () => {
  it("scopes a bare rollup to `<plugin>.system-health.<systemId>`", () => {
    expect(systemHealthCollapseKey("sys-1")).toBe("healthcheck.system-health.sys-1");
  });

  it("appends the environmentId to disambiguate per-env cards", () => {
    expect(systemHealthCollapseKey("sys-1", "prod")).toBe(
      "healthcheck.system-health.sys-1.prod",
    );
    expect(systemHealthCollapseKey("sys-1", "staging")).toBe(
      "healthcheck.system-health.sys-1.staging",
    );
  });

  it("produces distinct keys per env (two envs of one system => two cards)", () => {
    const prodKey = systemHealthCollapseKey("sys-1", "prod");
    const stagingKey = systemHealthCollapseKey("sys-1", "staging");
    const rollupKey = systemHealthCollapseKey("sys-1");
    expect(prodKey).not.toBe(stagingKey);
    // The rollup key is a strict prefix of the per-env keys so a system-scoped
    // group cannot accidentally swallow an env-scoped card.
    expect(prodKey.startsWith(rollupKey + ".")).toBe(true);
  });
});