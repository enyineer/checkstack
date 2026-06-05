import { describe, expect, it } from "bun:test";
import {
  CHECKSTACK_ENV_PREFIX,
  buildEnvironmentShellEnv,
  toEnvFieldShellKey,
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
});
