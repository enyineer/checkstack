import { describe, expect, it } from "bun:test";
import {
  buildSubprocessEnv,
  FORBIDDEN_ENV_KEYS,
  isForbiddenEnvKey,
  pickSafeEnv,
  SAFE_ENV_VARS,
} from "./env-guard";

describe("pickSafeEnv", () => {
  it("only forwards keys in the safe whitelist", () => {
    process.env.TEST_LEAK_SECRET = "DO_NOT_LEAK";
    process.env.PATH = process.env.PATH ?? "/usr/bin";
    const env = pickSafeEnv();
    delete process.env.TEST_LEAK_SECRET;

    expect(env.TEST_LEAK_SECRET).toBeUndefined();
    expect(env.PATH).toBeDefined();
    for (const key of Object.keys(env)) {
      expect(SAFE_ENV_VARS).toContain(key as (typeof SAFE_ENV_VARS)[number]);
    }
  });
});

describe("isForbiddenEnvKey", () => {
  it("flags the exact-match denylist keys", () => {
    for (const key of FORBIDDEN_ENV_KEYS) {
      expect(isForbiddenEnvKey(key)).toBe(true);
    }
  });

  it("flags BUN_CONFIG_* by prefix", () => {
    expect(isForbiddenEnvKey("BUN_CONFIG_REGISTRY")).toBe(true);
    expect(isForbiddenEnvKey("BUN_CONFIG_")).toBe(true);
  });

  it("does not flag ordinary keys", () => {
    expect(isForbiddenEnvKey("PAYLOAD_ID")).toBe(false);
    expect(isForbiddenEnvKey("API_TOKEN")).toBe(false);
  });
});

describe("buildSubprocessEnv", () => {
  const base = { PATH: "/safe/bin", HOME: "/home/u" };

  it("drops forbidden override keys when the denylist is applied", () => {
    const { env, dropped } = buildSubprocessEnv({
      base,
      overrides: {
        LD_PRELOAD: "/evil.so",
        NODE_OPTIONS: "--require /evil.js",
        API_TOKEN: "ok",
      },
      applyDenylist: true,
    });

    expect(env.LD_PRELOAD).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.API_TOKEN).toBe("ok");
    // base survives
    expect(env.PATH).toBe("/safe/bin");
    expect(dropped.sort()).toEqual(["LD_PRELOAD", "NODE_OPTIONS"]);
  });

  it("a PATH override is dropped but the safe-base PATH is retained", () => {
    const { env, dropped } = buildSubprocessEnv({
      base,
      overrides: { PATH: "/attacker/bin" },
      applyDenylist: true,
    });
    expect(env.PATH).toBe("/safe/bin");
    expect(dropped).toEqual(["PATH"]);
  });

  it("passes forbidden keys through when the denylist is NOT applied (back-compat)", () => {
    const { env, dropped } = buildSubprocessEnv({
      base,
      overrides: { LD_PRELOAD: "/x.so", NODE_OPTIONS: "--y" },
      applyDenylist: false,
    });
    expect(env.LD_PRELOAD).toBe("/x.so");
    expect(env.NODE_OPTIONS).toBe("--y");
    expect(dropped).toEqual([]);
  });

  it("merges overrides over base with override winning on non-forbidden keys", () => {
    const { env } = buildSubprocessEnv({
      base: { HOME: "/home/u", TZ: "UTC" },
      overrides: { TZ: "Europe/Berlin", EXTRA: "1" },
      applyDenylist: true,
    });
    expect(env.TZ).toBe("Europe/Berlin");
    expect(env.HOME).toBe("/home/u");
    expect(env.EXTRA).toBe("1");
  });
});

describe("PATH override hardening", () => {
  it("PATH is a forbidden caller-override key (curated base PATH survives)", () => {
    expect((FORBIDDEN_ENV_KEYS as readonly string[]).includes("PATH")).toBe(
      true,
    );
    expect(isForbiddenEnvKey("PATH")).toBe(true);
  });
});
