import { describe, expect, it } from "bun:test";
import {
  CHECKSTACK_ENV_PREFIX,
  CHECKSTACK_SYSTEM_PREFIX,
  buildEnvironmentShellEnv,
  buildSystemShellEnv,
  toEnvFieldShellKey,
  toSystemFieldShellKey,
} from "./shell-env";

describe("toEnvFieldShellKey", () => {
  it("splits camelCase into UPPER_SNAKE with the CHECKSTACK_ENV_ prefix", () => {
    expect(toEnvFieldShellKey("baseUrl")).toBe("CHECKSTACK_ENV_BASE_URL");
  });

  it("normalizes kebab-case and spaces to single underscores", () => {
    expect(toEnvFieldShellKey("my-weird key")).toBe(
      "CHECKSTACK_ENV_MY_WEIRD_KEY",
    );
  });

  it("trims leading/trailing separators", () => {
    expect(toEnvFieldShellKey(".region.")).toBe("CHECKSTACK_ENV_REGION");
  });

  it("handles digit/letter camel boundaries", () => {
    expect(toEnvFieldShellKey("tier2Name")).toBe("CHECKSTACK_ENV_TIER2_NAME");
  });

  it("is ReDoS-safe on a long run of separators", () => {
    // Mirrors the automation-common hardening test: a pathological input of
    // 100k separators must not hang.
    expect(toEnvFieldShellKey(".".repeat(100_000) + "a")).toBe(
      "CHECKSTACK_ENV_A",
    );
    expect(toEnvFieldShellKey(".".repeat(100_000))).toBe(CHECKSTACK_ENV_PREFIX);
  });
});

describe("buildEnvironmentShellEnv", () => {
  it("emits one CHECKSTACK_ENV_<KEY> var per custom field", () => {
    const env = buildEnvironmentShellEnv({
      baseUrl: "https://prod.example.com",
      region: "eu-west-1",
    });
    expect(env).toEqual({
      CHECKSTACK_ENV_BASE_URL: "https://prod.example.com",
      CHECKSTACK_ENV_REGION: "eu-west-1",
    });
  });

  it("stringifies non-string values", () => {
    const env = buildEnvironmentShellEnv({
      replicas: 3,
      enabled: true,
      tags: ["a", "b"],
      missing: null,
    });
    expect(env.CHECKSTACK_ENV_REPLICAS).toBe("3");
    expect(env.CHECKSTACK_ENV_ENABLED).toBe("true");
    expect(env.CHECKSTACK_ENV_TAGS).toBe('["a","b"]');
    expect(env.CHECKSTACK_ENV_MISSING).toBe("");
  });

  it("keeps the first key and skips a later colliding key (no last-write-wins)", () => {
    const collisions: string[] = [];
    const env = buildEnvironmentShellEnv(
      { baseUrl: "first", "base-url": "second" },
      (message) => collisions.push(message),
    );
    // Both keys normalize to CHECKSTACK_ENV_BASE_URL; first wins.
    expect(env.CHECKSTACK_ENV_BASE_URL).toBe("first");
    expect(Object.keys(env)).toHaveLength(1);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toContain("base-url");
    expect(collisions[0]).toContain("CHECKSTACK_ENV_BASE_URL");
  });

  it("skips a field that normalizes to an empty name", () => {
    const collisions: string[] = [];
    const env = buildEnvironmentShellEnv(
      { "...": "ignored", region: "eu" },
      (message) => collisions.push(message),
    );
    expect(env).toEqual({ CHECKSTACK_ENV_REGION: "eu" });
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toContain("empty shell var name");
  });

  it("skips a field that maps to a reserved built-in name", () => {
    const collisions: string[] = [];
    const env = buildEnvironmentShellEnv(
      { id: "should-not-clobber", region: "eu" },
      (message) => collisions.push(message),
    );
    // A field named `id` would otherwise clobber the structural CHECKSTACK_ENV_ID.
    expect(env).toEqual({ CHECKSTACK_ENV_REGION: "eu" });
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toContain("reserved CHECKSTACK_ENV_ID");
  });
});

describe("toSystemFieldShellKey", () => {
  it("splits camelCase into UPPER_SNAKE with the CHECKSTACK_SYSTEM_ prefix", () => {
    expect(toSystemFieldShellKey("baseUrl")).toBe("CHECKSTACK_SYSTEM_BASE_URL");
  });

  it("normalizes kebab-case and spaces to single underscores", () => {
    expect(toSystemFieldShellKey("my-weird key")).toBe(
      "CHECKSTACK_SYSTEM_MY_WEIRD_KEY",
    );
  });

  it("is ReDoS-safe on a long run of separators", () => {
    expect(toSystemFieldShellKey(".".repeat(100_000) + "a")).toBe(
      "CHECKSTACK_SYSTEM_A",
    );
    expect(toSystemFieldShellKey(".".repeat(100_000))).toBe(
      CHECKSTACK_SYSTEM_PREFIX,
    );
  });
});

describe("buildSystemShellEnv", () => {
  it("emits one CHECKSTACK_SYSTEM_<KEY> var per custom field", () => {
    const env = buildSystemShellEnv({
      baseUrl: "https://payments.example.com",
      tier: "1",
    });
    expect(env).toEqual({
      CHECKSTACK_SYSTEM_BASE_URL: "https://payments.example.com",
      CHECKSTACK_SYSTEM_TIER: "1",
    });
  });

  it("stringifies non-string values", () => {
    const env = buildSystemShellEnv({ replicas: 3, enabled: true });
    expect(env.CHECKSTACK_SYSTEM_REPLICAS).toBe("3");
    expect(env.CHECKSTACK_SYSTEM_ENABLED).toBe("true");
  });

  it("keeps the first key and skips a later colliding key", () => {
    const collisions: string[] = [];
    const env = buildSystemShellEnv(
      { baseUrl: "first", "base-url": "second" },
      (message) => collisions.push(message),
    );
    expect(env.CHECKSTACK_SYSTEM_BASE_URL).toBe("first");
    expect(Object.keys(env)).toHaveLength(1);
    expect(collisions[0]).toContain("base-url");
  });

  it("skips a field that maps to a reserved built-in name", () => {
    const collisions: string[] = [];
    const env = buildSystemShellEnv(
      { name: "should-not-clobber", tier: "1" },
      (message) => collisions.push(message),
    );
    // A field named `name` would otherwise clobber CHECKSTACK_SYSTEM_NAME.
    expect(env).toEqual({ CHECKSTACK_SYSTEM_TIER: "1" });
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toContain("reserved CHECKSTACK_SYSTEM_NAME");
  });
});
