import { describe, it, test, expect } from "bun:test";
import {
  resolveEffectiveEnvironments,
  resolveSatelliteEnvironments,
} from "./effective-environments";
import type { Environment } from "@checkstack/catalog-common";

const env = (
  id: string,
  name: string,
  metadata: Record<string, unknown> | null = {},
): Environment => ({
  id,
  name,
  description: null,
  systemIds: [],
  metadata,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("resolveEffectiveEnvironments", () => {
  const membership = [
    env("prod", "Production", { baseUrl: "https://prod" }),
    env("staging", "Staging", { baseUrl: "https://staging" }),
  ];

  it("null selector returns ALL current environments", () => {
    const result = resolveEffectiveEnvironments({
      environmentIds: null,
      membership,
    });
    expect(result.map((e) => e.id)).toEqual(["prod", "staging"]);
    expect(result[0]).toEqual({
      id: "prod",
      name: "Production",
      fields: { baseUrl: "https://prod" },
    });
  });

  it("undefined selector behaves like null (all environments)", () => {
    const result = resolveEffectiveEnvironments({
      environmentIds: undefined,
      membership,
    });
    expect(result.map((e) => e.id)).toEqual(["prod", "staging"]);
  });

  it("empty array selector opts out (env-less single run)", () => {
    const result = resolveEffectiveEnvironments({
      environmentIds: [],
      membership,
    });
    expect(result).toEqual([]);
  });

  it("explicit subset returns exactly those, intersected with membership", () => {
    const result = resolveEffectiveEnvironments({
      environmentIds: ["staging"],
      membership,
    });
    expect(result.map((e) => e.id)).toEqual(["staging"]);
  });

  it("preserves membership order regardless of selector order", () => {
    const result = resolveEffectiveEnvironments({
      environmentIds: ["staging", "prod"],
      membership,
    });
    expect(result.map((e) => e.id)).toEqual(["prod", "staging"]);
  });

  it("silently drops explicit ids no longer in membership (stale-ref prune)", () => {
    const result = resolveEffectiveEnvironments({
      environmentIds: ["prod", "deleted-env"],
      membership,
    });
    expect(result.map((e) => e.id)).toEqual(["prod"]);
  });

  it("null metadata becomes empty fields", () => {
    const result = resolveEffectiveEnvironments({
      environmentIds: null,
      membership: [env("e1", "E1", null)],
    });
    expect(result[0]?.fields).toEqual({});
  });

  it("empty membership under null selector yields env-less (empty result)", () => {
    const result = resolveEffectiveEnvironments({
      environmentIds: null,
      membership: [],
    });
    expect(result).toEqual([]);
  });
});

describe("resolveSatelliteEnvironments", () => {
  const effective = [
    { id: "env-prod", name: "Production", fields: {} },
    { id: "env-stage", name: "Staging", fields: {} },
  ];

  test("an unscoped satellite runs every environment the assignment resolved to", () => {
    // The backfill-free default: a NULL column means no scoping, so existing
    // assignments keep behaving exactly as they did.
    expect(
      resolveSatelliteEnvironments({
        effective,
        satelliteEnvironmentIds: undefined,
      }),
    ).toEqual(effective);
    expect(
      resolveSatelliteEnvironments({ effective, satelliteEnvironmentIds: null }),
    ).toEqual(effective);
  });

  test("a scoped satellite runs only its own environments", () => {
    // The point of the feature: the prod satellite probes prod, and never
    // reaches for a staging endpoint it may have no route to.
    expect(
      resolveSatelliteEnvironments({
        effective,
        satelliteEnvironmentIds: ["env-prod"],
      }).map((e) => e.id),
    ).toEqual(["env-prod"]);
  });

  test("a satellite can NARROW but never widen the assignment's scope", () => {
    // An id the assignment does not cover silently drops - a satellite must not
    // be able to probe an environment the assignment itself excluded.
    expect(
      resolveSatelliteEnvironments({
        effective,
        satelliteEnvironmentIds: ["env-prod", "env-secret"],
      }).map((e) => e.id),
    ).toEqual(["env-prod"]);
  });

  test("an empty selector opts the satellite out into a single env-less run", () => {
    expect(
      resolveSatelliteEnvironments({ effective, satelliteEnvironmentIds: [] }),
    ).toEqual([]);
  });

  test("preserves the assignment's order, so fan-out stays deterministic", () => {
    expect(
      resolveSatelliteEnvironments({
        effective,
        satelliteEnvironmentIds: ["env-stage", "env-prod"],
      }).map((e) => e.id),
    ).toEqual(["env-prod", "env-stage"]);
  });
});
