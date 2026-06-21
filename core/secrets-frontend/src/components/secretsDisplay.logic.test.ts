import { describe, expect, it } from "bun:test";
import type { BackendConfigDto } from "@checkstack/secrets-common";
import {
  classifyBackendPosture,
  presentWritability,
  summarizeSecrets,
} from "./secretsDisplay.logic";

describe("summarizeSecrets", () => {
  it("returns all-zero for an empty list", () => {
    expect(summarizeSecrets([])).toEqual({
      total: 0,
      withValue: 0,
      missingValue: 0,
    });
  });

  it("counts set vs. missing-value secrets", () => {
    const result = summarizeSecrets([
      { hasValue: true },
      { hasValue: true },
      { hasValue: false },
    ]);
    expect(result).toEqual({ total: 3, withValue: 2, missingValue: 1 });
  });

  it("handles all secrets having a value", () => {
    expect(summarizeSecrets([{ hasValue: true }, { hasValue: true }])).toEqual({
      total: 2,
      withValue: 2,
      missingValue: 0,
    });
  });

  it("handles all secrets missing a value", () => {
    expect(summarizeSecrets([{ hasValue: false }])).toEqual({
      total: 1,
      withValue: 0,
      missingValue: 1,
    });
  });
});

const baseConfig = (
  overrides: Partial<BackendConfigDto> = {},
): BackendConfigDto => ({
  activeBackend: "local",
  availableBackends: ["local"],
  writable: true,
  ...overrides,
});

describe("classifyBackendPosture", () => {
  it("is unknown while config is loading", () => {
    expect(classifyBackendPosture(undefined)).toBe("unknown");
  });

  it("is ok for an active local backend", () => {
    expect(classifyBackendPosture(baseConfig())).toBe("ok");
  });

  it("is warn when Vault is active but plugin is unavailable", () => {
    expect(
      classifyBackendPosture(
        baseConfig({
          activeBackend: "vault",
          availableBackends: ["local"],
        }),
      ),
    ).toBe("warn");
  });

  it("is warn when Vault is active and available but has no address", () => {
    expect(
      classifyBackendPosture(
        baseConfig({
          activeBackend: "vault",
          availableBackends: ["local", "vault"],
          writable: false,
        }),
      ),
    ).toBe("warn");
  });

  it("is ok when Vault is active, available, and has an address", () => {
    expect(
      classifyBackendPosture(
        baseConfig({
          activeBackend: "vault",
          availableBackends: ["local", "vault"],
          writable: false,
          vault: {
            address: "https://vault.example.com:8200",
            mount: "secret",
            authMethod: "token",
            hasCredential: true,
          },
        }),
      ),
    ).toBe("ok");
  });
});

describe("presentWritability", () => {
  it("is loading/unknown without config", () => {
    expect(presentWritability(undefined)).toEqual({
      label: "loading",
      tone: "unknown",
    });
  });

  it("is writable for a writable backend", () => {
    expect(presentWritability(baseConfig())).toEqual({
      label: "writable",
      tone: "ok",
    });
  });

  it("is read-through for a non-writable backend", () => {
    expect(presentWritability(baseConfig({ writable: false }))).toEqual({
      label: "read-through",
      tone: "warn",
    });
  });
});
