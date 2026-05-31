import { describe, it, expect } from "bun:test";
import type { SatelliteAssignment } from "@checkstack/satellite-common";
import type { SecretResolverService } from "@checkstack/secrets-backend";
import { resolveSatelliteRunSecrets } from "./run-secret-resolver";

// A resolver that resolves from a fixed name->value map (mirrors the real
// resolveForRun: substitute ${{ secrets.NAME }} per declared env entry).
function fakeResolver(values: Record<string, string>): SecretResolverService {
  const TEMPLATE_RE = /\$\{\{\s*secrets\.([a-zA-Z0-9_-]+)\s*\}\}/g;
  return {
    resolveSecret: async ({ name }) => {
      if (!(name in values)) throw new Error(`Secret not found: ${name}`);
      return values[name];
    },
    resolveBySchema: async ({ value }) => ({ resolved: value, warnings: [] }),
    resolveForRun: async ({ secretEnv }) => {
      const env: Record<string, string> = {};
      for (const [envName, template] of Object.entries(secretEnv)) {
        TEMPLATE_RE.lastIndex = 0;
        env[envName] = template.replaceAll(TEMPLATE_RE, (_m, name: string) => {
          if (!(name in values)) throw new Error(`Secret not found: ${name}`);
          return values[name];
        });
      }
      return {
        env,
        masking: {
          size: 0,
          maskText: (t) => t,
          maskDeep: (v) => v,
        },
      };
    },
  };
}

function assignment(
  configId: string,
  collectors: SatelliteAssignment["collectors"],
): SatelliteAssignment {
  return {
    configId,
    systemId: "sys-1",
    strategyId: "script",
    config: {},
    collectors,
    intervalSeconds: 60,
  };
}

describe("resolveSatelliteRunSecrets", () => {
  it("resolves ONLY the collector's declared secretEnv from the assignment", async () => {
    const assignments = [
      assignment("config-1", [
        {
          id: "col-1",
          collectorId: "inline-script",
          config: { secretEnv: { API_TOKEN: "${{ secrets.jira_token }}" } },
        },
      ]),
    ];
    const env = await resolveSatelliteRunSecrets({
      satelliteId: "sat-1",
      configId: "config-1",
      collectorId: "col-1",
      getAssignmentsForSatellite: async () => assignments,
      resolver: fakeResolver({ jira_token: "real-value", other: "nope" }),
    });
    expect(env).toEqual({ API_TOKEN: "real-value" });
  });

  it("throws when the assignment is not assigned to this satellite", async () => {
    await expect(
      resolveSatelliteRunSecrets({
        satelliteId: "sat-1",
        configId: "missing",
        collectorId: "col-1",
        getAssignmentsForSatellite: async () => [],
        resolver: fakeResolver({}),
      }),
    ).rejects.toThrow(/No assignment/);
  });

  it("throws when the collector declares no secretEnv (least-privilege)", async () => {
    const assignments = [
      assignment("config-1", [
        { id: "col-1", collectorId: "inline-script", config: {} },
      ]),
    ];
    await expect(
      resolveSatelliteRunSecrets({
        satelliteId: "sat-1",
        configId: "config-1",
        collectorId: "col-1",
        getAssignmentsForSatellite: async () => assignments,
        resolver: fakeResolver({}),
      }),
    ).rejects.toThrow(/no secretEnv/);
  });

  it("propagates a clear error when a required secret cannot resolve", async () => {
    const assignments = [
      assignment("config-1", [
        {
          id: "col-1",
          collectorId: "inline-script",
          config: { secretEnv: { TOKEN: "${{ secrets.absent }}" } },
        },
      ]),
    ];
    await expect(
      resolveSatelliteRunSecrets({
        satelliteId: "sat-1",
        configId: "config-1",
        collectorId: "col-1",
        getAssignmentsForSatellite: async () => assignments,
        resolver: fakeResolver({}),
      }),
    ).rejects.toThrow(/Secret not found: absent/);
  });
});
