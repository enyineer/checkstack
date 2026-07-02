import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { configString } from "@checkstack/backend-api";
import {
  createMaskingContext,
  type InternalSecretsService,
  type SecretResolverService,
} from "@checkstack/secrets-backend";
import { internalSecretName } from "@checkstack/secrets-common";
import {
  extractConfigurationSecrets,
  inflateConfigSecrets,
  redactSecretFields,
  mergeSecretFields,
  mergeConfigurationSecrets,
  deleteConfigurationSecrets,
  healthcheckSecretMarker,
  isHealthcheckSecretMarker,
} from "./config-secrets";

/** Map-backed fake of the internal secrets store. */
function fakeInternalSecrets(): InternalSecretsService & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    store,
    async set({ parts, value }) {
      store.set(internalSecretName(...parts), value);
    },
    async get({ parts }) {
      return store.get(internalSecretName(...parts));
    },
    async delete({ parts }) {
      store.delete(internalSecretName(...parts));
    },
  };
}

/** Resolver fake: `${{ secrets.NAME }}` resolves to `resolved:NAME`. */
const fakeResolver: Pick<SecretResolverService, "resolveForRun"> = {
  async resolveForRun({ secretEnv }) {
    const env: Record<string, string> = {};
    for (const [key, template] of Object.entries(secretEnv)) {
      const name = /\$\{\{\s*secrets\.([A-Za-z0-9_-]+)\s*\}\}/.exec(
        template,
      )?.[1];
      if (!name) throw new Error(`Unresolvable template: ${template}`);
      env[key] = `resolved:${name}`;
    }
    return { env, masking: createMaskingContext({ values: [] }) };
  },
};

/** HTTP-auth-like strategy schema: two secrets, one plain field. */
const strategySchema = z.object({
  timeout: z.number().optional(),
  authUsername: z.string().optional(),
  authPassword: configString({ "x-secret": true }).optional(),
  authToken: configString({ "x-secret": true }).optional(),
});

const collectorSchema = z.object({
  url: z.string(),
  apiKey: configString({ "x-secret": true }).optional(),
});

const CONFIG_ID = "cfg-1";

describe("extractConfigurationSecrets", () => {
  it("moves inline secrets to internal secrets and stores markers", async () => {
    const internalSecrets = fakeInternalSecrets();
    const result = await extractConfigurationSecrets({
      configurationId: CONFIG_ID,
      strategySchema,
      config: { timeout: 5000, authUsername: "alice", authPassword: "s3cret" },
      collectors: [
        {
          id: "entry-1",
          collectorId: "http.request",
          config: { url: "https://x", apiKey: "collector-key" },
        },
      ],
      getCollectorSchema: () => collectorSchema,
      internalSecrets,
    });

    // Strategy: password extracted, username untouched.
    expect(result.config.authPassword).toBe(
      healthcheckSecretMarker("authPassword"),
    );
    expect(result.config.authUsername).toBe("alice");
    expect(result.extracted).toBe(2);

    // Collector: apiKey extracted.
    expect(result.collectors?.[0].config.apiKey).toBe(
      healthcheckSecretMarker("apiKey"),
    );

    // Values live ONLY in the internal store.
    expect([...internalSecrets.store.values()]).toEqual(
      expect.arrayContaining(["s3cret", "collector-key"]),
    );
    expect(JSON.stringify(result)).not.toContain("s3cret");
  });

  it("is idempotent: markers and references extract nothing", async () => {
    const internalSecrets = fakeInternalSecrets();
    const config = {
      authPassword: healthcheckSecretMarker("authPassword"),
      authToken: "${{ secrets.MY_TOKEN }}",
    };
    const result = await extractConfigurationSecrets({
      configurationId: CONFIG_ID,
      strategySchema,
      config,
      collectors: undefined,
      getCollectorSchema: () => undefined,
      internalSecrets,
    });
    expect(result.extracted).toBe(0);
    expect(result.config).toEqual(config);
    expect(internalSecrets.store.size).toBe(0);
  });

  it("leaves empty strings alone (nothing to protect)", async () => {
    const internalSecrets = fakeInternalSecrets();
    const result = await extractConfigurationSecrets({
      configurationId: CONFIG_ID,
      strategySchema,
      config: { authPassword: "" },
      collectors: undefined,
      getCollectorSchema: () => undefined,
      internalSecrets,
    });
    expect(result.extracted).toBe(0);
    expect(result.config.authPassword).toBe("");
  });
});

describe("inflateConfigSecrets", () => {
  it("resolves markers from the internal store and references via the resolver", async () => {
    const internalSecrets = fakeInternalSecrets();
    await internalSecrets.set({
      parts: ["healthcheck", CONFIG_ID, "strategy", "authPassword"],
      value: "s3cret",
    });

    const { config, values } = await inflateConfigSecrets({
      configurationId: CONFIG_ID,
      scope: { kind: "strategy" },
      schema: strategySchema,
      config: {
        authPassword: healthcheckSecretMarker("authPassword"),
        authToken: "${{ secrets.MY_TOKEN }}",
      },
      deps: { internalSecrets, secretResolver: fakeResolver },
    });

    expect(config.authPassword).toBe("s3cret");
    expect(config.authToken).toBe("resolved:MY_TOKEN");
    expect(values).toEqual(expect.arrayContaining(["s3cret", "resolved:MY_TOKEN"]));
  });

  it("passes a legacy bare literal through unchanged", async () => {
    const { config } = await inflateConfigSecrets({
      configurationId: CONFIG_ID,
      scope: { kind: "strategy" },
      schema: strategySchema,
      config: { authPassword: "legacy-plaintext" },
      deps: { internalSecrets: fakeInternalSecrets(), secretResolver: fakeResolver },
    });
    expect(config.authPassword).toBe("legacy-plaintext");
  });

  it("fails closed on a marker whose internal secret is missing", async () => {
    await expect(
      inflateConfigSecrets({
        configurationId: CONFIG_ID,
        scope: { kind: "strategy" },
        schema: strategySchema,
        config: { authPassword: healthcheckSecretMarker("authPassword") },
        deps: { internalSecrets: fakeInternalSecrets(), secretResolver: fakeResolver },
      }),
    ).rejects.toThrow(/internal secret .* not found/);
  });

  it("scopes collector secrets by entry id", async () => {
    const internalSecrets = fakeInternalSecrets();
    await internalSecrets.set({
      parts: ["healthcheck", CONFIG_ID, "collector", "entry-1", "apiKey"],
      value: "collector-key",
    });
    const { config } = await inflateConfigSecrets({
      configurationId: CONFIG_ID,
      scope: { kind: "collector", entryId: "entry-1" },
      schema: collectorSchema,
      config: { url: "https://x", apiKey: healthcheckSecretMarker("apiKey") },
      deps: { internalSecrets, secretResolver: fakeResolver },
    });
    expect(config.apiKey).toBe("collector-key");
  });
});

describe("redactSecretFields", () => {
  it("removes secret fields entirely, keeping everything else", () => {
    const redacted = redactSecretFields({
      schema: strategySchema,
      config: {
        timeout: 5000,
        authUsername: "alice",
        authPassword: healthcheckSecretMarker("authPassword"),
        authToken: "${{ secrets.MY_TOKEN }}",
      },
    });
    expect(redacted).toEqual({ timeout: 5000, authUsername: "alice" });
  });

  it("recurses into arrays of objects", () => {
    const schema = z.object({
      targets: z.array(
        z.object({
          host: z.string(),
          password: configString({ "x-secret": true }),
        }),
      ),
    });
    const redacted = redactSecretFields({
      schema,
      config: {
        targets: [
          { host: "a", password: "p1" },
          { host: "b", password: "p2" },
        ],
      },
    });
    expect(redacted).toEqual({ targets: [{ host: "a" }, { host: "b" }] });
  });
});

describe("mergeSecretFields", () => {
  const stored = {
    authUsername: "alice",
    authPassword: healthcheckSecretMarker("authPassword"),
    authToken: "${{ secrets.MY_TOKEN }}",
  };

  it("restores stored secrets when incoming is blank or absent", () => {
    const merged = mergeSecretFields({
      schema: strategySchema,
      incoming: { authUsername: "alice", authPassword: "" },
      stored,
    });
    // Blank -> restored marker; absent -> restored reference.
    expect(merged.authPassword).toBe(healthcheckSecretMarker("authPassword"));
    expect(merged.authToken).toBe("${{ secrets.MY_TOKEN }}");
  });

  it("lets a newly typed secret win over the stored one", () => {
    const merged = mergeSecretFields({
      schema: strategySchema,
      incoming: { authPassword: "brand-new" },
      stored,
    });
    expect(merged.authPassword).toBe("brand-new");
  });

  it("keeps incoming untouched when nothing is stored (create-like)", () => {
    const merged = mergeSecretFields({
      schema: strategySchema,
      incoming: { authUsername: "alice", authPassword: "" },
      stored: undefined,
    });
    expect(merged.authPassword).toBe("");
    expect(merged.authToken).toBeUndefined();
  });
});

describe("mergeConfigurationSecrets", () => {
  it("pairs collector entries by id and skips brand-new entries", () => {
    const { collectors } = mergeConfigurationSecrets({
      strategySchema,
      incomingConfig: {},
      storedConfig: {},
      incomingCollectors: [
        {
          id: "entry-1",
          collectorId: "http.request",
          config: { url: "https://x", apiKey: "" },
        },
        {
          id: "entry-2",
          collectorId: "http.request",
          config: { url: "https://y", apiKey: "" },
        },
      ],
      storedCollectors: [
        {
          id: "entry-1",
          collectorId: "http.request",
          config: { url: "https://x", apiKey: healthcheckSecretMarker("apiKey") },
        },
      ],
      getCollectorSchema: () => collectorSchema,
    });

    expect(collectors?.[0].config.apiKey).toBe(
      healthcheckSecretMarker("apiKey"),
    );
    // entry-2 is new: nothing stored to restore.
    expect(collectors?.[1].config.apiKey).toBe("");
  });
});

describe("deleteConfigurationSecrets", () => {
  it("deletes exactly the internal secrets the stored markers point at", async () => {
    const internalSecrets = fakeInternalSecrets();
    await internalSecrets.set({
      parts: ["healthcheck", CONFIG_ID, "strategy", "authPassword"],
      value: "s3cret",
    });
    await internalSecrets.set({
      parts: ["healthcheck", CONFIG_ID, "collector", "entry-1", "apiKey"],
      value: "collector-key",
    });
    await internalSecrets.set({
      parts: ["healthcheck", "other-config", "strategy", "authPassword"],
      value: "unrelated",
    });

    await deleteConfigurationSecrets({
      configurationId: CONFIG_ID,
      strategySchema,
      config: { authPassword: healthcheckSecretMarker("authPassword") },
      collectors: [
        {
          id: "entry-1",
          collectorId: "http.request",
          config: { apiKey: healthcheckSecretMarker("apiKey"), url: "https://x" },
        },
      ],
      getCollectorSchema: () => collectorSchema,
      internalSecrets,
    });

    expect(internalSecrets.store.size).toBe(1);
    expect([...internalSecrets.store.values()]).toEqual(["unrelated"]);
  });
});

describe("marker format", () => {
  it("round-trips and detects markers", () => {
    const marker = healthcheckSecretMarker("authPassword");
    expect(isHealthcheckSecretMarker(marker)).toBe(true);
    expect(isHealthcheckSecretMarker("plain-value")).toBe(false);
    expect(isHealthcheckSecretMarker("${{ secrets.X }}")).toBe(false);
  });
});
