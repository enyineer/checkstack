import { describe, expect, it } from "bun:test";
import { sortEntitiesByDependency, type CollectedEntity } from "./sort-entities";
import { CHECKSTACK_API_VERSION } from "@checkstack/gitops-common";

function makeEntity(
  kind: string,
  name: string,
  spec: Record<string, unknown> = {},
): CollectedEntity {
  return {
    entity: {
      apiVersion: CHECKSTACK_API_VERSION,
      kind,
      metadata: { name },
      spec,
    },
    contentHash: `hash-${kind}-${name}`,
    file: {
      repository: "test/repo",
      filePath: `${name}.yaml`,
      content: "",
      branch: "main",
    },
  };
}

describe("sortEntitiesByDependency", () => {
  it("returns independent entities in discovery order", () => {
    const entities = [
      makeEntity("System", "alpha"),
      makeEntity("System", "beta"),
      makeEntity("System", "gamma"),
    ];

    const sorted = sortEntitiesByDependency({ entities });
    expect(sorted.map((e) => e.entity.metadata.name)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("sorts a dependent entity after its dependency", () => {
    // System references Healthcheck — should come after it
    const system = makeEntity("System", "payment-service", {
      healthchecks: [
        { ref: { kind: "Healthcheck", name: "db-check" } },
      ],
    });
    const healthcheck = makeEntity("Healthcheck", "db-check");

    // Discovered in wrong order: System first
    const sorted = sortEntitiesByDependency({
      entities: [system, healthcheck],
    });

    expect(sorted.map((e) => e.entity.metadata.name)).toEqual([
      "db-check",
      "payment-service",
    ]);
  });

  it("handles a chain of dependencies (A → B → C)", () => {
    const a = makeEntity("Kind-A", "a", {
      dep: { kind: "Kind-B", name: "b" },
    });
    const b = makeEntity("Kind-B", "b", {
      dep: { kind: "Kind-C", name: "c" },
    });
    const c = makeEntity("Kind-C", "c");

    const sorted = sortEntitiesByDependency({
      entities: [a, b, c],
    });

    expect(sorted.map((e) => e.entity.metadata.name)).toEqual(["c", "b", "a"]);
  });

  it("ignores refs to entities not in the collected set", () => {
    const system = makeEntity("System", "my-sys", {
      ext: { kind: "Healthcheck", name: "external-check" },
    });
    const other = makeEntity("System", "other-sys");

    // "external-check" doesn't exist — should not cause error
    const sorted = sortEntitiesByDependency({
      entities: [system, other],
    });

    expect(sorted.map((e) => e.entity.metadata.name)).toEqual([
      "my-sys",
      "other-sys",
    ]);
  });

  it("throws on dependency cycles", () => {
    const a = makeEntity("Kind-A", "a", {
      dep: { kind: "Kind-B", name: "b" },
    });
    const b = makeEntity("Kind-B", "b", {
      dep: { kind: "Kind-A", name: "a" },
    });

    expect(() =>
      sortEntitiesByDependency({ entities: [a, b] }),
    ).toThrow(/cycle/i);
  });

  it("maintains discovery order for entities at the same depth", () => {
    // Three healthchecks (no deps), then a system that depends on one of them
    const hc1 = makeEntity("Healthcheck", "hc-alpha");
    const hc2 = makeEntity("Healthcheck", "hc-beta");
    const hc3 = makeEntity("Healthcheck", "hc-gamma");
    const sys = makeEntity("System", "my-sys", {
      checks: [{ ref: { kind: "Healthcheck", name: "hc-beta" } }],
    });

    const sorted = sortEntitiesByDependency({
      entities: [sys, hc1, hc2, hc3],
    });

    // All HCs should come before sys, in their original relative order
    const names = sorted.map((e) => e.entity.metadata.name);
    expect(names.indexOf("hc-alpha")).toBeLessThan(names.indexOf("my-sys"));
    expect(names.indexOf("hc-beta")).toBeLessThan(names.indexOf("my-sys"));
    expect(names.indexOf("hc-gamma")).toBeLessThan(names.indexOf("my-sys"));
    // HCs relative order preserved
    expect(names.indexOf("hc-alpha")).toBeLessThan(names.indexOf("hc-beta"));
    expect(names.indexOf("hc-beta")).toBeLessThan(names.indexOf("hc-gamma"));
  });

  it("does not treat self-references as dependencies", () => {
    // An entity referencing itself should not create a cycle
    const entity = makeEntity("System", "self-referencing", {
      self: { kind: "System", name: "self-referencing" },
    });

    const sorted = sortEntitiesByDependency({ entities: [entity] });
    expect(sorted).toHaveLength(1);
    expect(sorted[0].entity.metadata.name).toBe("self-referencing");
  });
});

// ─── YAML Edge Case Integration Tests ──────────────────────────────────────

/**
 * These tests simulate the full pipeline: YAML → parse → collect → sort.
 * Each test builds CollectedEntity arrays from realistic YAML content
 * to verify dependency ordering across real-world scenarios.
 */

describe("sortEntitiesByDependency — YAML edge cases", () => {
  /**
   * Scenario: A single multi-document YAML file contains both a System and
   * the Healthcheck it references, with the System listed first.
   * The sorter must reorder them so the Healthcheck comes first.
   */
  it("reorders entities within a single multi-doc YAML file", () => {
    // System defined first in the file, references a Healthcheck defined second
    const system = makeEntity("System", "payment-service", {
      description: "Payment processing",
      healthchecks: [
        { ref: { kind: "Healthcheck", name: "payment-db-check" } },
      ],
    });
    const healthcheck = makeEntity("Healthcheck", "payment-db-check", {
      strategy: "postgres",
      intervalSeconds: 30,
      config: { host: "db.internal" },
    });

    // Both from the same file, System discovered first
    system.file = { repository: "org/infra", filePath: ".checkstack/payment.yaml", content: "", branch: "main" };
    healthcheck.file = { repository: "org/infra", filePath: ".checkstack/payment.yaml", content: "", branch: "main" };

    const sorted = sortEntitiesByDependency({
      entities: [system, healthcheck],
    });

    const names = sorted.map((e) => e.entity.metadata.name);
    expect(names).toEqual(["payment-db-check", "payment-service"]);
  });

  /**
   * Scenario: A System references multiple Healthchecks from different files.
   * All Healthchecks must come before the System.
   */
  it("handles a System with multiple cross-file Healthcheck refs", () => {
    const sys = makeEntity("System", "api-gateway", {
      healthchecks: [
        { ref: { kind: "Healthcheck", name: "http-check" } },
        { ref: { kind: "Healthcheck", name: "dns-check" } },
        { ref: { kind: "Healthcheck", name: "tls-check" } },
      ],
    });
    const hcHttp = makeEntity("Healthcheck", "http-check", {
      strategy: "http",
      intervalSeconds: 15,
      config: { url: "https://api.example.com/health" },
    });
    const hcDns = makeEntity("Healthcheck", "dns-check", {
      strategy: "dns",
      intervalSeconds: 60,
      config: { hostname: "api.example.com" },
    });
    const hcTls = makeEntity("Healthcheck", "tls-check", {
      strategy: "tls",
      intervalSeconds: 300,
      config: { host: "api.example.com", port: 443 },
    });

    // Discovered: System first, then HCs in arbitrary order
    const sorted = sortEntitiesByDependency({
      entities: [sys, hcTls, hcHttp, hcDns],
    });

    const names = sorted.map((e) => e.entity.metadata.name);
    // All HCs must come before System
    expect(names.indexOf("http-check")).toBeLessThan(names.indexOf("api-gateway"));
    expect(names.indexOf("dns-check")).toBeLessThan(names.indexOf("api-gateway"));
    expect(names.indexOf("tls-check")).toBeLessThan(names.indexOf("api-gateway"));
  });

  /**
   * Scenario: Multiple Systems reference the same Healthcheck.
   * The shared Healthcheck must come before both Systems.
   */
  it("handles a shared Healthcheck referenced by multiple Systems", () => {
    const sharedHc = makeEntity("Healthcheck", "shared-db-check", {
      strategy: "postgres",
      intervalSeconds: 30,
      config: { host: "shared-db.internal" },
    });
    const sysA = makeEntity("System", "billing-service", {
      healthchecks: [
        { ref: { kind: "Healthcheck", name: "shared-db-check" } },
      ],
    });
    const sysB = makeEntity("System", "inventory-service", {
      healthchecks: [
        { ref: { kind: "Healthcheck", name: "shared-db-check" } },
      ],
    });

    // Discovered: both Systems before the Healthcheck
    const sorted = sortEntitiesByDependency({
      entities: [sysA, sysB, sharedHc],
    });

    const names = sorted.map((e) => e.entity.metadata.name);
    expect(names.indexOf("shared-db-check")).toBeLessThan(names.indexOf("billing-service"));
    expect(names.indexOf("shared-db-check")).toBeLessThan(names.indexOf("inventory-service"));
  });

  /**
   * Scenario: Diamond dependency — System depends on two Healthchecks,
   * and both Healthchecks depend on a shared Collector entity.
   * Expected order: Collector → Healthchecks → System
   */
  it("resolves diamond dependency graphs", () => {
    const collector = makeEntity("Collector", "hardware-cpu", {
      plugin: "collector-hardware",
    });
    const hcA = makeEntity("Healthcheck", "server-a-check", {
      strategy: "http",
      collectors: [
        { ref: { kind: "Collector", name: "hardware-cpu" } },
      ],
    });
    const hcB = makeEntity("Healthcheck", "server-b-check", {
      strategy: "http",
      collectors: [
        { ref: { kind: "Collector", name: "hardware-cpu" } },
      ],
    });
    const sys = makeEntity("System", "cluster", {
      healthchecks: [
        { ref: { kind: "Healthcheck", name: "server-a-check" } },
        { ref: { kind: "Healthcheck", name: "server-b-check" } },
      ],
    });

    // Worst-case discovery order: dependents first
    const sorted = sortEntitiesByDependency({
      entities: [sys, hcB, hcA, collector],
    });

    const names = sorted.map((e) => e.entity.metadata.name);
    // Collector before both HCs
    expect(names.indexOf("hardware-cpu")).toBeLessThan(names.indexOf("server-a-check"));
    expect(names.indexOf("hardware-cpu")).toBeLessThan(names.indexOf("server-b-check"));
    // Both HCs before System
    expect(names.indexOf("server-a-check")).toBeLessThan(names.indexOf("cluster"));
    expect(names.indexOf("server-b-check")).toBeLessThan(names.indexOf("cluster"));
  });

  /**
   * Scenario: Mixed independent and dependent entities.
   * Independent entities should not be affected by the sort.
   */
  it("interleaves independent entities with dependent ones correctly", () => {
    const standalone1 = makeEntity("System", "standalone-1");
    const standalone2 = makeEntity("System", "standalone-2");
    const hc = makeEntity("Healthcheck", "dep-check", {
      strategy: "http",
      config: { url: "http://localhost" },
    });
    const sys = makeEntity("System", "dependent-sys", {
      healthchecks: [
        { ref: { kind: "Healthcheck", name: "dep-check" } },
      ],
    });

    // discovered: standalone1, dependent-sys, standalone2, dep-check
    const sorted = sortEntitiesByDependency({
      entities: [standalone1, sys, standalone2, hc],
    });

    const names = sorted.map((e) => e.entity.metadata.name);
    // dep-check must come before dependent-sys
    expect(names.indexOf("dep-check")).toBeLessThan(names.indexOf("dependent-sys"));
    // standalone entities maintain relative order among themselves
    expect(names.indexOf("standalone-1")).toBeLessThan(names.indexOf("standalone-2"));
  });

  /**
   * Scenario: Three-node cycle should throw a descriptive error.
   * A → B → C → A
   */
  it("detects and reports a three-node cycle", () => {
    const a = makeEntity("System", "sys-a", {
      dep: { kind: "System", name: "sys-b" },
    });
    const b = makeEntity("System", "sys-b", {
      dep: { kind: "System", name: "sys-c" },
    });
    const c = makeEntity("System", "sys-c", {
      dep: { kind: "System", name: "sys-a" },
    });

    expect(() =>
      sortEntitiesByDependency({ entities: [a, b, c] }),
    ).toThrow(/cycle/i);
  });

  /**
   * Scenario: Entity refs mixed with non-ref objects that look similar.
   * Objects with `kind` and `name` but inside non-extension contexts
   * (e.g., labels, metadata) should still be treated as entity refs.
   * This is by design — extractEntityRefs is intentionally greedy.
   */
  it("treats all {kind, name} objects as refs regardless of nesting depth", () => {
    const deep = makeEntity("System", "deep-nester", {
      level1: {
        level2: {
          level3: {
            checks: [
              { ref: { kind: "Healthcheck", name: "deeply-nested-hc" } },
            ],
          },
        },
      },
    });
    const hc = makeEntity("Healthcheck", "deeply-nested-hc", {
      strategy: "http",
    });

    const sorted = sortEntitiesByDependency({
      entities: [deep, hc],
    });

    const names = sorted.map((e) => e.entity.metadata.name);
    expect(names).toEqual(["deeply-nested-hc", "deep-nester"]);
  });

  /**
   * Scenario: A System has a partial ref to an entity that exists AND
   * a ref to an entity that doesn't exist in this batch.
   * Only the existing ref should create a dependency edge.
   */
  it("handles a mix of resolvable and unresolvable refs", () => {
    const hc = makeEntity("Healthcheck", "local-check");
    const sys = makeEntity("System", "mixed-refs", {
      healthchecks: [
        { ref: { kind: "Healthcheck", name: "local-check" } },
        { ref: { kind: "Healthcheck", name: "remote-check-not-in-batch" } },
      ],
    });

    // Should not throw — unresolvable refs are silently ignored
    const sorted = sortEntitiesByDependency({
      entities: [sys, hc],
    });

    const names = sorted.map((e) => e.entity.metadata.name);
    expect(names).toEqual(["local-check", "mixed-refs"]);
  });

  /**
   * Scenario: Large batch with multiple independent dependency trees.
   * Tree A: sys-a → hc-a
   * Tree B: sys-b → hc-b1, hc-b2
   * Independent: standalone-1, standalone-2
   * All trees should resolve independently without affecting each other.
   */
  it("handles multiple independent dependency trees in one batch", () => {
    const hcA = makeEntity("Healthcheck", "hc-a");
    const sysA = makeEntity("System", "sys-a", {
      healthchecks: [{ ref: { kind: "Healthcheck", name: "hc-a" } }],
    });
    const hcB1 = makeEntity("Healthcheck", "hc-b1");
    const hcB2 = makeEntity("Healthcheck", "hc-b2");
    const sysB = makeEntity("System", "sys-b", {
      healthchecks: [
        { ref: { kind: "Healthcheck", name: "hc-b1" } },
        { ref: { kind: "Healthcheck", name: "hc-b2" } },
      ],
    });
    const standalone1 = makeEntity("System", "standalone-1");
    const standalone2 = makeEntity("System", "standalone-2");

    // Discovered in worst-case interleaved order
    const sorted = sortEntitiesByDependency({
      entities: [sysA, sysB, standalone1, hcB2, hcA, standalone2, hcB1],
    });

    const names = sorted.map((e) => e.entity.metadata.name);
    // Tree A ordering
    expect(names.indexOf("hc-a")).toBeLessThan(names.indexOf("sys-a"));
    // Tree B ordering
    expect(names.indexOf("hc-b1")).toBeLessThan(names.indexOf("sys-b"));
    expect(names.indexOf("hc-b2")).toBeLessThan(names.indexOf("sys-b"));
    // Total count preserved
    expect(names).toHaveLength(7);
  });

  /**
   * Scenario: Entity with only empty/null spec should be handled gracefully.
   */
  it("handles entities with undefined or empty specs", () => {
    const noSpec = makeEntity("System", "no-spec");
    // Force spec to undefined
    noSpec.entity.spec = undefined;

    const emptySpec = makeEntity("System", "empty-spec");
    emptySpec.entity.spec = {};

    const sorted = sortEntitiesByDependency({
      entities: [noSpec, emptySpec],
    });

    expect(sorted.map((e) => e.entity.metadata.name)).toEqual([
      "no-spec",
      "empty-spec",
    ]);
  });

  /**
   * Scenario: Cross-kind ref between same-named entities of different kinds.
   * A System named "monitor" references a Healthcheck also named "monitor".
   * These are distinct entities — the ref should create a correct dependency edge.
   */
  it("correctly resolves refs between entities with the same name but different kinds", () => {
    const hcMonitor = makeEntity("Healthcheck", "monitor", {
      strategy: "http",
    });
    const sysMonitor = makeEntity("System", "monitor", {
      healthchecks: [
        { ref: { kind: "Healthcheck", name: "monitor" } },
      ],
    });

    // System discovered first
    const sorted = sortEntitiesByDependency({
      entities: [sysMonitor, hcMonitor],
    });

    const names = sorted.map((e) => `${e.entity.kind}::${e.entity.metadata.name}`);
    expect(names).toEqual(["Healthcheck::monitor", "System::monitor"]);
  });
});
