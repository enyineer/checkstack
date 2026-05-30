import { describe, test, expect } from "bun:test";
import {
  SatelliteAssignmentSchema,
  CoreToSatelliteMessageSchema,
  SatelliteToCoreMessageSchema,
} from "./protocol";

describe("SatelliteAssignmentSchema", () => {
  const base = {
    configId: "config-1",
    systemId: "system-1",
    strategyId: "http",
    config: {},
    intervalSeconds: 60,
  };

  test("parses an assignment WITH configName and systemName", () => {
    const parsed = SatelliteAssignmentSchema.parse({
      ...base,
      configName: "API health",
      systemName: "Production API",
    });

    expect(parsed.configName).toBe("API health");
    expect(parsed.systemName).toBe("Production API");
  });

  test("parses an assignment WITHOUT configName and systemName (optional)", () => {
    const parsed = SatelliteAssignmentSchema.parse(base);

    expect(parsed.configName).toBeUndefined();
    expect(parsed.systemName).toBeUndefined();
  });
});

describe("script-packages protocol extensions", () => {
  test("authenticated carries an optional scriptPackagesLockfileHash", () => {
    const withHash = CoreToSatelliteMessageSchema.parse({
      type: "authenticated",
      satelliteId: "sat-1",
      assignments: [],
      scriptPackagesLockfileHash: "abc123",
    });
    expect(withHash.type).toBe("authenticated");
    if (withHash.type === "authenticated") {
      expect(withHash.scriptPackagesLockfileHash).toBe("abc123");
    }
  });

  test("authenticated WITHOUT the hash still parses (version-skew safe)", () => {
    const parsed = CoreToSatelliteMessageSchema.parse({
      type: "authenticated",
      satelliteId: "sat-1",
      assignments: [],
    });
    expect(parsed.type).toBe("authenticated");
    if (parsed.type === "authenticated") {
      expect(parsed.scriptPackagesLockfileHash).toBeUndefined();
    }
  });

  test("config_updated carries the optional hash", () => {
    const parsed = CoreToSatelliteMessageSchema.parse({
      type: "config_updated",
      assignments: [],
      scriptPackagesLockfileHash: null,
    });
    if (parsed.type === "config_updated") {
      expect(parsed.scriptPackagesLockfileHash).toBeNull();
    }
  });

  test("refresh_script_packages round-trips", () => {
    const parsed = CoreToSatelliteMessageSchema.parse({
      type: "refresh_script_packages",
      lockfileHash: "deadbeef",
    });
    expect(parsed.type).toBe("refresh_script_packages");
    if (parsed.type === "refresh_script_packages") {
      expect(parsed.lockfileHash).toBe("deadbeef");
    }
  });

  test("script_package_sync_state round-trips (satellite -> core)", () => {
    const parsed = SatelliteToCoreMessageSchema.parse({
      type: "script_package_sync_state",
      lockfileHash: "abc",
      status: "ready",
    });
    expect(parsed.type).toBe("script_package_sync_state");
    if (parsed.type === "script_package_sync_state") {
      expect(parsed.status).toBe("ready");
      expect(parsed.lockfileHash).toBe("abc");
    }
  });

  test("script_package_sync_state carries an error", () => {
    const parsed = SatelliteToCoreMessageSchema.parse({
      type: "script_package_sync_state",
      lockfileHash: null,
      status: "error",
      errorMessage: "blob fetch failed",
    });
    if (parsed.type === "script_package_sync_state") {
      expect(parsed.status).toBe("error");
      expect(parsed.errorMessage).toBe("blob fetch failed");
    }
  });
});

describe("run-secrets request/reply (Phase 3 JIT delivery)", () => {
  test("parses request_run_secrets", () => {
    const parsed = SatelliteToCoreMessageSchema.parse({
      type: "request_run_secrets",
      requestId: "req-1",
      configId: "config-1",
      collectorId: "inline-script",
      runId: "run-1",
    });
    expect(parsed.type).toBe("request_run_secrets");
    if (parsed.type === "request_run_secrets") {
      expect(parsed.requestId).toBe("req-1");
      expect(parsed.collectorId).toBe("inline-script");
    }
  });

  test("parses run_secrets reply with env", () => {
    const parsed = CoreToSatelliteMessageSchema.parse({
      type: "run_secrets",
      requestId: "req-1",
      env: { API_TOKEN: "resolved-value" },
    });
    if (parsed.type === "run_secrets") {
      expect(parsed.env).toEqual({ API_TOKEN: "resolved-value" });
      expect(parsed.error).toBeUndefined();
    }
  });

  test("parses run_secrets reply with error (no env)", () => {
    const parsed = CoreToSatelliteMessageSchema.parse({
      type: "run_secrets",
      requestId: "req-1",
      error: "required secret not available",
    });
    if (parsed.type === "run_secrets") {
      expect(parsed.error).toBe("required secret not available");
      expect(parsed.env).toBeUndefined();
    }
  });
});
