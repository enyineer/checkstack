import { afterEach, describe, expect, it } from "bun:test";
import {
  DEFAULT_SANDBOX_PROFILE,
  mergeSandboxPolicy,
  resolveDefaultSandboxProfile,
  SANDBOX_GID_ENV,
  SANDBOX_UID_ENV,
  sandboxPolicySchema,
} from "./policy";

describe("sandboxPolicySchema", () => {
  it("defaults enabled to true (D1: on-by-default)", () => {
    const parsed = sandboxPolicySchema.parse({});
    expect(parsed.enabled).toBe(true);
  });

  it("applies conservative bare field defaults", () => {
    const parsed = sandboxPolicySchema.parse({});
    expect(parsed.onUnavailable).toBe("degrade");
    expect(parsed.filesystem.mode).toBe("off");
    expect(parsed.network.mode).toBe("unrestricted");
    expect(parsed.network.denyLinkLocalAndMetadata).toBe(true);
    expect(parsed.privilege.mode).toBe("inherit");
    expect(parsed.resources).toEqual({});
  });

  it("rejects unknown top-level keys (.strict)", () => {
    expect(() =>
      sandboxPolicySchema.parse({ bogus: true }),
    ).toThrow();
  });

  it("rejects unknown nested keys (.strict)", () => {
    expect(() =>
      sandboxPolicySchema.parse({ resources: { bogus: 1 } }),
    ).toThrow();
  });

  it("enforces resource bounds", () => {
    expect(() =>
      sandboxPolicySchema.parse({ resources: { cpuSeconds: 0 } }),
    ).toThrow();
    expect(() =>
      sandboxPolicySchema.parse({ resources: { cpuSeconds: 99999 } }),
    ).toThrow();
  });

  it("DEFAULT_SANDBOX_PROFILE round-trips through the schema", () => {
    const reparsed = sandboxPolicySchema.parse(DEFAULT_SANDBOX_PROFILE);
    expect(reparsed).toEqual(DEFAULT_SANDBOX_PROFILE);
    expect(reparsed.filesystem.mode).toBe("scratch-plus-ro");
    expect(reparsed.privilege.mode).toBe("drop-to-uid");
  });

  it("DEFAULT_SANDBOX_PROFILE is secure-by-default (deny egress until allowlisted)", () => {
    // Network is an allowlist with an EMPTY allow list = egress denied until an
    // operator adds entries (NOT unrestricted); plus the always-on
    // metadata/link-local block. Generous resource caps sized as headroom, not
    // work limits; FS confined to scratch + RO node_modules.
    expect(DEFAULT_SANDBOX_PROFILE.enabled).toBe(true);
    // Fail-closed by default: refuse the run when a layer can't be enforced.
    expect(DEFAULT_SANDBOX_PROFILE.onUnavailable).toBe("fail");
    expect(DEFAULT_SANDBOX_PROFILE.network.mode).toBe("allowlist");
    expect(DEFAULT_SANDBOX_PROFILE.network.allow).toEqual([]);
    expect(DEFAULT_SANDBOX_PROFILE.network.denyLinkLocalAndMetadata).toBe(true);
    expect(DEFAULT_SANDBOX_PROFILE.filesystem.mode).toBe("scratch-plus-ro");
    expect(DEFAULT_SANDBOX_PROFILE.resources.cpuSeconds).toBe(60);
    expect(DEFAULT_SANDBOX_PROFILE.resources.memoryBytes).toBe(512 * 1024 * 1024);
    expect(DEFAULT_SANDBOX_PROFILE.resources.maxProcesses).toBe(256);
    // No UID baked into the constant; the dedicated target is seeded at runtime.
    expect(DEFAULT_SANDBOX_PROFILE.privilege.uid).toBeUndefined();
  });

  it("DEFAULT_SANDBOX_PROFILE fails closed (onUnavailable=fail, never silent degrade)", () => {
    // The shipped global default REFUSES a run when a requested layer cannot be
    // enforced rather than silently dropping to a weaker subset. This is the
    // single most security-relevant default: a malicious script must not slip
    // through on a host missing a sandbox primitive.
    expect(DEFAULT_SANDBOX_PROFILE.onUnavailable).toBe("fail");
  });
});

describe("resolveDefaultSandboxProfile", () => {
  afterEach(() => {
    delete process.env[SANDBOX_UID_ENV];
    delete process.env[SANDBOX_GID_ENV];
  });

  it("returns the base profile (no UID) when the env is unset", () => {
    delete process.env[SANDBOX_UID_ENV];
    delete process.env[SANDBOX_GID_ENV];
    const resolved = resolveDefaultSandboxProfile();
    expect(resolved.privilege.uid).toBeUndefined();
    expect(resolved.privilege.gid).toBeUndefined();
    expect(resolved.privilege.mode).toBe("drop-to-uid");
  });

  it("seeds the dedicated low-priv UID/GID from the environment", () => {
    process.env[SANDBOX_UID_ENV] = "65534";
    process.env[SANDBOX_GID_ENV] = "65534";
    const resolved = resolveDefaultSandboxProfile();
    expect(resolved.privilege.uid).toBe(65534);
    expect(resolved.privilege.gid).toBe(65534);
  });

  it("ignores a GID with no UID (a gid-only drop is not meaningful)", () => {
    delete process.env[SANDBOX_UID_ENV];
    process.env[SANDBOX_GID_ENV] = "65534";
    const resolved = resolveDefaultSandboxProfile();
    expect(resolved.privilege.uid).toBeUndefined();
    expect(resolved.privilege.gid).toBeUndefined();
  });

  it("treats a malformed UID as unconfigured (no crash, degrades later)", () => {
    process.env[SANDBOX_UID_ENV] = "not-a-number";
    const resolved = resolveDefaultSandboxProfile();
    expect(resolved.privilege.uid).toBeUndefined();
  });

  it("still validates against the schema", () => {
    process.env[SANDBOX_UID_ENV] = "1000";
    const resolved = resolveDefaultSandboxProfile();
    expect(() => sandboxPolicySchema.parse(resolved)).not.toThrow();
  });
});

describe("mergeSandboxPolicy", () => {
  it("returns base unchanged when override is undefined", () => {
    const merged = mergeSandboxPolicy({ base: DEFAULT_SANDBOX_PROFILE });
    expect(merged).toEqual(DEFAULT_SANDBOX_PROFILE);
  });

  it("per-item override wins per-field without re-widening other layers", () => {
    const merged = mergeSandboxPolicy({
      base: DEFAULT_SANDBOX_PROFILE,
      override: { network: { mode: "deny" } },
    });
    // network.mode overridden...
    expect(merged.network.mode).toBe("deny");
    // ...but the metadata block + other layers stay from the base, NOT the
    // bare zod defaults.
    expect(merged.network.denyLinkLocalAndMetadata).toBe(true);
    expect(merged.resources.cpuSeconds).toBe(60);
    expect(merged.filesystem.mode).toBe("scratch-plus-ro");
    expect(merged.privilege.mode).toBe("drop-to-uid");
  });

  it("a single resource field override keeps the other caps", () => {
    const merged = mergeSandboxPolicy({
      base: DEFAULT_SANDBOX_PROFILE,
      override: { resources: { memoryBytes: 2 * 1024 * 1024 * 1024 } },
    });
    expect(merged.resources.memoryBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(merged.resources.cpuSeconds).toBe(60);
    expect(merged.resources.maxProcesses).toBe(256);
  });

  it("enabled:false override opts out without touching the rest", () => {
    const merged = mergeSandboxPolicy({
      base: DEFAULT_SANDBOX_PROFILE,
      override: { enabled: false },
    });
    expect(merged.enabled).toBe(false);
  });

  it("onUnavailable override is honored", () => {
    const merged = mergeSandboxPolicy({
      base: DEFAULT_SANDBOX_PROFILE,
      override: { onUnavailable: "fail" },
    });
    expect(merged.onUnavailable).toBe("fail");
  });

  it("a fully-resolved override (the global durable default) replaces every layer", () => {
    // This is the call-site shape: the global durable default is itself a
    // fully-resolved SandboxPolicy passed as the override; merging it over the
    // runner's DEFAULT_SANDBOX_PROFILE base must yield exactly that override
    // (idempotent), so the global setting wins end-to-end.
    const globalDefault = mergeSandboxPolicy({
      base: DEFAULT_SANDBOX_PROFILE,
      override: { network: { mode: "deny" }, resources: { cpuSeconds: 30 } },
    });
    const merged = mergeSandboxPolicy({
      base: DEFAULT_SANDBOX_PROFILE,
      override: globalDefault,
    });
    expect(merged).toEqual(globalDefault);
  });
});
