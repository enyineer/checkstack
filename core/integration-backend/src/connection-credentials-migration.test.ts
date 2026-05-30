import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { configString } from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type {
  Logger,
  ConfigService,
} from "@checkstack/backend-api";
import type {
  SecretResolverService,
  InternalSecretsService,
} from "@checkstack/secrets-backend";
import {
  migrateConnectionCredentials,
  type ConnectionForMigration,
} from "./connection-credentials-migration";
import { inflateConnectionCredentials } from "./connection-credentials";

const schema = z.object({
  baseUrl: z.string(),
  apiToken: configString({ "x-secret": true }),
});

function fakeInternal(): InternalSecretsService & { store: Map<string, string> } {
  const store = new Map<string, string>();
  const key = (parts: string[]) => parts.join("|");
  return {
    store,
    set: async ({ parts, value }) => {
      store.set(key(parts), value);
    },
    get: async ({ parts }) => store.get(key(parts)),
    delete: async ({ parts }) => {
      store.delete(key(parts));
    },
  };
}

const noopResolver: SecretResolverService = {
  resolveSecret: async () => "",
  resolveBySchema: async ({ value }) => ({ resolved: value, warnings: [] }),
  resolveForRun: async () => ({
    env: {},
    masking: { size: 0, maskText: (t) => t, maskDeep: (v) => v },
  }),
};

/** Minimal in-memory ConfigService for the backup entries. */
function fakeConfigService(): ConfigService {
  const store = new Map<string, unknown>();
  return {
    get: async (id) => store.get(id) as never,
    getRedacted: async (id) => store.get(id) as never,
    set: async (id, _s, _v, data) => {
      store.set(id, data);
    },
    delete: async (id) => {
      store.delete(id);
    },
    list: async () => [...store.keys()],
  };
}

const PROVIDER = "integration-jira.jira";

describe("migrateConnectionCredentials", () => {
  it("migrates an inline credential, backs it up, and is parity-verified + reversible", async () => {
    const internal = fakeInternal();
    const configService = fakeConfigService();
    const persisted = new Map<string, Record<string, unknown>>();

    const conn: ConnectionForMigration = {
      providerId: PROVIDER,
      connectionId: "c1",
      schema,
      schemaVersion: 1,
      config: { baseUrl: "https://x", apiToken: "inline-secret-1" },
    };

    const result = await migrateConnectionCredentials({
      configService,
      internalSecrets: internal,
      secretResolver: noopResolver,
      logger: createMockLogger() as Logger,
      loadConnections: async () => [conn],
      persistConfig: async ({ connectionId, config }) => {
        persisted.set(connectionId, config);
      },
    });

    expect(result).toEqual({ total: 1, migrated: 1, skipped: 0, failed: 0 });

    // Stored config is reference-ized (no plaintext).
    const stored = persisted.get("c1")!;
    expect(JSON.stringify(stored)).not.toContain("inline-secret-1");

    // Reversible: a backup of the original raw config exists.
    const backup = await configService.get(
      "integration_connection_credbackup_integration-jira_jira_c1",
      z.object({ config: z.record(z.string(), z.unknown()) }),
      1,
    );
    expect((backup as { config: Record<string, unknown> }).config.apiToken).toBe(
      "inline-secret-1",
    );

    // Parity: inflating the stored form yields the original plaintext.
    const { config: inflated } = await inflateConnectionCredentials({
      providerId: PROVIDER,
      connectionId: "c1",
      config: stored,
      schema,
      deps: { internalSecrets: internal, secretResolver: noopResolver },
    });
    expect(inflated).toEqual(conn.config);
  });

  it("is idempotent: re-running over the already-migrated (marker) config does nothing", async () => {
    const internal = fakeInternal();
    const configService = fakeConfigService();

    // First pass.
    let stored: Record<string, unknown> = {
      baseUrl: "https://x",
      apiToken: "inline-secret-2",
    };
    const run = (config: Record<string, unknown>) =>
      migrateConnectionCredentials({
        configService,
        internalSecrets: internal,
        secretResolver: noopResolver,
        logger: createMockLogger() as Logger,
        loadConnections: async () => [
          { providerId: PROVIDER, connectionId: "c2", schema, schemaVersion: 1, config },
        ],
        persistConfig: async ({ config: c }) => {
          stored = c;
        },
      });

    const first = await run(stored);
    expect(first.migrated).toBe(1);
    const second = await run(stored); // now reference-ized
    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("skips a connection with no inline secret (already a reference)", async () => {
    const internal = fakeInternal();
    const result = await migrateConnectionCredentials({
      configService: fakeConfigService(),
      internalSecrets: internal,
      secretResolver: noopResolver,
      logger: createMockLogger() as Logger,
      loadConnections: async () => [
        {
          providerId: PROVIDER,
          connectionId: "c3",
          schema,
          schemaVersion: 1,
          config: { baseUrl: "https://x", apiToken: "${{ secrets.jira }}" },
        },
      ],
      persistConfig: async () => {
        throw new Error("should not persist a reference-only connection");
      },
    });
    expect(result.skipped).toBe(1);
    expect(result.migrated).toBe(0);
  });
});
