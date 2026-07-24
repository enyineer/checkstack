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

describe("sandbox-policy protocol extensions", () => {
  const policy = {
    enabled: true,
    onUnavailable: "degrade" as const,
    resources: { cpuSeconds: 30 },
    filesystem: { mode: "scratch-plus-ro" as const },
    network: {
      mode: "allowlist" as const,
      allow: ["10.0.0.1"],
      denyLinkLocalAndMetadata: true,
    },
    privilege: { mode: "drop-to-uid" as const },
  };

  test("authenticated carries an optional sandboxPolicy that round-trips", () => {
    const parsed = CoreToSatelliteMessageSchema.parse({
      type: "authenticated",
      satelliteId: "sat-1",
      assignments: [],
      sandboxPolicy: policy,
    });
    if (parsed.type === "authenticated") {
      expect(parsed.sandboxPolicy?.network.mode).toBe("allowlist");
      expect(parsed.sandboxPolicy?.network.allow).toEqual(["10.0.0.1"]);
      expect(parsed.sandboxPolicy?.resources.cpuSeconds).toBe(30);
    }
  });

  test("authenticated WITHOUT sandboxPolicy parses (version-skew safety)", () => {
    const parsed = CoreToSatelliteMessageSchema.parse({
      type: "authenticated",
      satelliteId: "sat-1",
      assignments: [],
    });
    if (parsed.type === "authenticated") {
      expect(parsed.sandboxPolicy).toBeUndefined();
    }
  });

  test("sandbox_policy push message round-trips the full policy", () => {
    const parsed = CoreToSatelliteMessageSchema.parse({
      type: "sandbox_policy",
      policy,
    });
    expect(parsed.type).toBe("sandbox_policy");
    if (parsed.type === "sandbox_policy") {
      expect(parsed.policy.network.mode).toBe("allowlist");
      expect(parsed.policy.privilege.mode).toBe("drop-to-uid");
    }
  });
});

describe("telemetry protocol extensions (additive envelopes)", () => {
  test("telemetry_batch round-trips with per-group drop counts", () => {
    const msg = {
      type: "telemetry_batch" as const,
      batchId: "3",
      kind: "logstream",
      payload: { streamToken: "ckls_x", lines: [{ body: "hi" }] },
      droppedByGroup: { ckls_x: 7, ckls_y: 2 },
    };
    const parsed = SatelliteToCoreMessageSchema.parse(msg);
    expect(parsed).toEqual(msg);
  });

  test("telemetry_batch parses without the optional droppedByGroup", () => {
    const parsed = SatelliteToCoreMessageSchema.parse({
      type: "telemetry_batch",
      batchId: "1",
      kind: "metricstream",
      payload: null,
    });
    if (parsed.type === "telemetry_batch") {
      expect(parsed.droppedByGroup).toBeUndefined();
    }
  });

  test("capability_status round-trips (sat -> core)", () => {
    const msg = {
      type: "capability_status" as const,
      kind: "metric-scrape",
      payload: { targetId: "t1", lastError: null },
    };
    expect(SatelliteToCoreMessageSchema.parse(msg)).toEqual(msg);
  });

  test("telemetry_ack round-trips (core -> sat)", () => {
    const msg = {
      type: "telemetry_ack" as const,
      batchId: "9",
      accepted: 5,
      rejected: 2,
      retryable: true,
    };
    expect(CoreToSatelliteMessageSchema.parse(msg)).toEqual(msg);
  });

  test("capability_config round-trips (core -> sat)", () => {
    const msg = {
      type: "capability_config" as const,
      kind: "metric-scrape",
      payload: { targets: [{ id: "t1", url: "http://x/metrics" }] },
    };
    expect(CoreToSatelliteMessageSchema.parse(msg)).toEqual(msg);
  });

  test("authenticate carries optional capabilities[]", () => {
    const parsed = SatelliteToCoreMessageSchema.parse({
      type: "authenticate",
      clientId: "c1",
      token: "csat_x",
      capabilities: ["telemetry", "scrape"],
    });
    if (parsed.type === "authenticate") {
      expect(parsed.capabilities).toEqual(["telemetry", "scrape"]);
    }
  });

  test("heartbeat WITHOUT capabilities parses (version-skew safe)", () => {
    const parsed = SatelliteToCoreMessageSchema.parse({
      type: "heartbeat",
      version: "1.0.0",
      uptimeSeconds: 10,
    });
    if (parsed.type === "heartbeat") {
      expect(parsed.capabilities).toBeUndefined();
    }
  });
});

describe("protocol forward-compatibility (version skew)", () => {
  test("unknown extra fields on a known message are stripped, not fatal", () => {
    const parsed = SatelliteToCoreMessageSchema.parse({
      type: "heartbeat",
      version: "1.0.0",
      uptimeSeconds: 5,
      somethingBrandNew: { nested: true },
    });
    expect(parsed).toEqual({
      type: "heartbeat",
      version: "1.0.0",
      uptimeSeconds: 5,
    });
  });

  test("an unknown message type fails safeParse cleanly (no throw)", () => {
    // The WS handlers guard parse and DROP on failure, so an unknown type from
    // a newer peer is ignored without tearing down the socket.
    expect(
      SatelliteToCoreMessageSchema.safeParse({ type: "future_msg", x: 1 })
        .success,
    ).toBe(false);
    expect(
      CoreToSatelliteMessageSchema.safeParse({ type: "future_msg", x: 1 })
        .success,
    ).toBe(false);
  });
});

describe("per-environment fan-out (version skew)", () => {
  const baseAssignment = {
    configId: "cfg-1",
    systemId: "sys-1",
    strategyId: "http",
    config: {},
    intervalSeconds: 60,
  };

  test("an assignment WITHOUT environments still parses (older core)", () => {
    const parsed = SatelliteAssignmentSchema.safeParse(baseAssignment);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.environments).toBeUndefined();
  });

  test("an assignment carries its resolved environments", () => {
    const parsed = SatelliteAssignmentSchema.safeParse({
      ...baseAssignment,
      environments: [
        { id: "env-prod", name: "Production", fields: { baseUrl: "https://x" } },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.environments?.[0]?.id).toBe("env-prod");
  });

  test("a result WITHOUT environmentId still parses (older satellite)", () => {
    // The core stores such a run env-less, exactly as it always did.
    const parsed = SatelliteToCoreMessageSchema.safeParse({
      type: "result",
      configId: "cfg-1",
      systemId: "sys-1",
      status: "healthy",
      executedAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });

  test("a result carries the environment it ran for, including explicit null", () => {
    for (const environmentId of ["env-prod", null]) {
      const parsed = SatelliteToCoreMessageSchema.safeParse({
        type: "result",
        configId: "cfg-1",
        systemId: "sys-1",
        status: "healthy",
        executedAt: new Date().toISOString(),
        environmentId,
      });
      expect(parsed.success).toBe(true);
    }
  });
});
