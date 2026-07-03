import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { configSecret } from "@checkstack/backend-api";
import type {
  SecretResolverService,
  InternalSecretsService,
} from "@checkstack/secrets-backend";
import {
  inflateConnectionCredentials,
  extractInlineCredentials,
  deleteConnectionCredentials,
  pruneConnectionCredentials,
  internalRefMarker,
  isInternalRefMarker,
  connectionSecretParts,
} from "./connection-credentials";

// A Jira-like connection schema: baseUrl (non-secret) + apiToken (x-secret).
const connectionSchema = z.object({
  baseUrl: z.string(),
  email: z.string(),
  apiToken: configSecret({ id: "apiToken" }),
});

/** In-memory internal-secrets fake (the local store). */
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

/** Resolver fake backed by a name->value map (simulates the active backend). */
function fakeResolver(values: Record<string, string>): SecretResolverService {
  const RE = /\$\{\{\s*secrets\.([a-zA-Z0-9_-]+)\s*\}\}/g;
  return {
    resolveSecret: async ({ name }) => values[name] ?? "",
    resolveBySchema: async ({ value }) => ({ resolved: value, warnings: [] }),
    resolveForRun: async ({ secretEnv }) => {
      const env: Record<string, string> = {};
      for (const [k, template] of Object.entries(secretEnv)) {
        RE.lastIndex = 0;
        env[k] = template.replaceAll(RE, (_m, n: string) => values[n] ?? "");
      }
      return {
        env,
        masking: { size: 0, maskText: (t) => t, maskDeep: (v) => v },
      };
    },
  };
}

const PROVIDER = "integration-jira.jira";
const CONN = "conn-1";

describe("extractInlineCredentials", () => {
  it("moves an inline x-secret value into an internal secret + leaves a marker", async () => {
    const internal = fakeInternal();
    const { config, extracted } = await extractInlineCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: { baseUrl: "https://x", email: "a@b.c", apiToken: "tok-INLINE" },
      schema: connectionSchema,
      internalSecrets: internal,
    });
    expect(extracted).toBe(1);
    expect(config.baseUrl).toBe("https://x"); // non-secret untouched
    expect(isInternalRefMarker(config.apiToken as string)).toBe(true);
    expect(config.apiToken).toBe(internalRefMarker("apiToken"));
    // The value moved to the internal store.
    expect(
      internal.store.get(
        connectionSecretParts({
          providerId: PROVIDER,
          connectionId: CONN,
          secretId: "apiToken",
        }).join("|"),
      ),
    ).toBe("tok-INLINE");
  });

  it("is idempotent: a marker or reference extracts nothing", async () => {
    const internal = fakeInternal();
    const { extracted } = await extractInlineCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: {
        baseUrl: "https://x",
        email: "a@b.c",
        apiToken: internalRefMarker("apiToken"),
      },
      schema: connectionSchema,
      internalSecrets: internal,
    });
    expect(extracted).toBe(0);

    const ref = await extractInlineCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: { baseUrl: "https://x", email: "a@b.c", apiToken: "${{ secrets.jira }}" },
      schema: connectionSchema,
      internalSecrets: internal,
    });
    expect(ref.extracted).toBe(0);
  });
});

describe("inflateConnectionCredentials", () => {
  it("inflates an internal-ref marker (inline path) from the local store", async () => {
    const internal = fakeInternal();
    await internal.set({
      parts: connectionSecretParts({ providerId: PROVIDER, connectionId: CONN, secretId: "apiToken" }),
      value: "tok-RESOLVED",
    });
    const { config, values } = await inflateConnectionCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: { baseUrl: "https://x", email: "a@b.c", apiToken: internalRefMarker("apiToken") },
      schema: connectionSchema,
      deps: { internalSecrets: internal, secretResolver: fakeResolver({}) },
    });
    expect(config.apiToken).toBe("tok-RESOLVED");
    expect(values).toContain("tok-RESOLVED");
  });

  it("inflates a ${{ secrets.NAME }} reference (reference path) via the active backend", async () => {
    const internal = fakeInternal();
    const { config } = await inflateConnectionCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: { baseUrl: "https://x", email: "a@b.c", apiToken: "${{ secrets.jira_token }}" },
      schema: connectionSchema,
      deps: {
        internalSecrets: internal,
        secretResolver: fakeResolver({ jira_token: "tok-FROM-VAULT" }),
      },
    });
    expect(config.apiToken).toBe("tok-FROM-VAULT");
  });

  it("round-trips: extract then inflate yields the original plaintext", async () => {
    const internal = fakeInternal();
    const original = { baseUrl: "https://x", email: "a@b.c", apiToken: "round-trip-tok" };
    const { config: stored } = await extractInlineCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: original,
      schema: connectionSchema,
      internalSecrets: internal,
    });
    // Stored form is reference-ized (no plaintext).
    expect(JSON.stringify(stored)).not.toContain("round-trip-tok");
    const { config: inflated } = await inflateConnectionCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: stored,
      schema: connectionSchema,
      deps: { internalSecrets: internal, secretResolver: fakeResolver({}) },
    });
    expect(inflated).toEqual(original);
  });

  it("leaves a bare legacy literal unchanged (pre-migration safety)", async () => {
    const internal = fakeInternal();
    const { config } = await inflateConnectionCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: { baseUrl: "https://x", email: "a@b.c", apiToken: "legacy-inline" },
      schema: connectionSchema,
      deps: { internalSecrets: internal, secretResolver: fakeResolver({}) },
    });
    expect(config.apiToken).toBe("legacy-inline");
  });
});

describe("deleteConnectionCredentials (no orphan on delete)", () => {
  it("removes the extracted internal secret so deleting the connection leaves nothing behind", async () => {
    const internal = fakeInternal();
    const { config: stored } = await extractInlineCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: { baseUrl: "https://x", email: "a@b.c", apiToken: "to-be-deleted" },
      schema: connectionSchema,
      internalSecrets: internal,
    });
    expect(internal.store.size).toBe(1);

    await deleteConnectionCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: stored,
      internalSecrets: internal,
    });
    expect(internal.store.size).toBe(0);
  });

  it("is a no-op for a reference-only config (nothing was extracted)", async () => {
    const internal = fakeInternal();
    await deleteConnectionCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: { baseUrl: "https://x", email: "a@b.c", apiToken: "${{ secrets.jira }}" },
      internalSecrets: internal,
    });
    expect(internal.store.size).toBe(0);
  });
});

describe("pruneConnectionCredentials (no orphan on update)", () => {
  it("prunes the old internal secret when a field switches from inline to a reference", async () => {
    const internal = fakeInternal();
    const { config: oldStored } = await extractInlineCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: { baseUrl: "https://x", email: "a@b.c", apiToken: "old-inline" },
      schema: connectionSchema,
      internalSecrets: internal,
    });
    expect(internal.store.size).toBe(1);

    // Operator replaces the inline value with a ${{ secrets.* }} reference.
    const { config: newStored } = await extractInlineCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: { baseUrl: "https://x", email: "a@b.c", apiToken: "${{ secrets.jira }}" },
      schema: connectionSchema,
      internalSecrets: internal,
    });

    const pruned = await pruneConnectionCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      oldConfig: oldStored,
      newConfig: newStored,
      internalSecrets: internal,
    });
    expect(pruned).toBe(1);
    expect(internal.store.size).toBe(0);
  });

  it("keeps the secret when the inline value is merely rotated (same key)", async () => {
    const internal = fakeInternal();
    const { config: oldStored } = await extractInlineCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: { baseUrl: "https://x", email: "a@b.c", apiToken: "v1" },
      schema: connectionSchema,
      internalSecrets: internal,
    });
    const { config: newStored } = await extractInlineCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      config: { baseUrl: "https://x", email: "a@b.c", apiToken: "v2" },
      schema: connectionSchema,
      internalSecrets: internal,
    });
    const pruned = await pruneConnectionCredentials({
      providerId: PROVIDER,
      connectionId: CONN,
      oldConfig: oldStored,
      newConfig: newStored,
      internalSecrets: internal,
    });
    // Same stable key (id=apiToken): rotated in place, nothing to prune.
    expect(pruned).toBe(0);
    expect(internal.store.size).toBe(1);
    expect(
      internal.store.get(
        connectionSecretParts({
          providerId: PROVIDER,
          connectionId: CONN,
          secretId: "apiToken",
        }).join("|"),
      ),
    ).toBe("v2");
  });
});
