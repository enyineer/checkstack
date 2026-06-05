import { describe, it, expect } from "bun:test";
import { resolveEffectiveEnvironments } from "./effective-environments";
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
