import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { configSecret } from "@checkstack/backend-api";
import { SECRET_CLEAR_SENTINEL } from "@checkstack/common";
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
  pruneOrphanedConfigurationSecrets,
  listPopulatedSecretKeys,
  healthcheckSecretParts,
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
  authPassword: configSecret({ id: "authPassword" }).optional(),
  authToken: configSecret({ id: "authToken" }).optional(),
});

const collectorSchema = z.object({
  url: z.string(),
  apiKey: configSecret({ id: "apiKey" }).optional(),
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

  it("neutralizes a FORGED marker pointing at another field's secret", async () => {
    const internalSecrets = fakeInternalSecrets();
    // A privileged operator set authPassword; its secret lives in the store.
    await internalSecrets.set({
      parts: ["healthcheck", CONFIG_ID, "strategy", "authPassword"],
      value: "admin-password",
    });

    // A lower-privileged editor types the literal marker for authPassword into
    // the authToken field, hoping it inflates to the admin's password.
    const forged = healthcheckSecretMarker("authPassword");
    const result = await extractConfigurationSecrets({
      configurationId: CONFIG_ID,
      strategySchema,
      config: {
        authPassword: healthcheckSecretMarker("authPassword"), // own marker: kept
        authToken: forged, // forged marker in a DIFFERENT field: must be extracted
      },
      collectors: undefined,
      getCollectorSchema: () => undefined,
      internalSecrets,
    });

    // The forged value is extracted as a LITERAL into authToken's own slot,
    // and the field becomes authToken's own marker - not a pass-through.
    expect(result.config.authToken).toBe(healthcheckSecretMarker("authToken"));
    expect(
      internalSecrets.store.get(
        internalSecretName("healthcheck", CONFIG_ID, "strategy", "authToken"),
      ),
    ).toBe(forged);
    // authPassword's own marker passed through untouched; its secret intact.
    expect(result.config.authPassword).toBe(
      healthcheckSecretMarker("authPassword"),
    );

    // At inflate, authToken resolves to its OWN slot (the literal marker
    // string), NEVER the admin password.
    const { config } = await inflateConfigSecrets({
      configurationId: CONFIG_ID,
      scope: { kind: "strategy" },
      schema: strategySchema,
      config: result.config,
      deps: { internalSecrets, secretResolver: fakeResolver },
    });
    expect(config.authToken).toBe(forged);
    expect(config.authToken).not.toBe("admin-password");
    expect(config.authPassword).toBe("admin-password");
  });

  it("a stored forged marker still cannot read another field's slot (inflate keys by own path)", async () => {
    const internalSecrets = fakeInternalSecrets();
    await internalSecrets.set({
      parts: ["healthcheck", CONFIG_ID, "strategy", "authPassword"],
      value: "admin-password",
    });
    // Simulate a forged marker that somehow reached storage in authToken.
    await expect(
      inflateConfigSecrets({
        configurationId: CONFIG_ID,
        scope: { kind: "strategy" },
        schema: strategySchema,
        config: { authToken: healthcheckSecretMarker("authPassword") },
        deps: { internalSecrets, secretResolver: fakeResolver },
      }),
      // authToken has no own-slot secret, so it fails closed rather than
      // leaking authPassword.
    ).rejects.toThrow(/Internal secret for "authToken" not found/);
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
    ).rejects.toThrow(/Internal secret .* not found/);
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
  it("strips inline secret markers but KEEPS references verbatim (UX-8)", () => {
    const redacted = redactSecretFields({
      schema: strategySchema,
      config: {
        timeout: 5000,
        authUsername: "alice",
        authPassword: healthcheckSecretMarker("authPassword"),
        authToken: "${{ secrets.MY_TOKEN }}",
      },
    });
    // The extracted-inline marker is stripped; the `${{ secrets.* }}` reference
    // is a pointer (not a value) and stays so the editor shows the wiring.
    expect(redacted).toEqual({
      timeout: 5000,
      authUsername: "alice",
      authToken: "${{ secrets.MY_TOKEN }}",
    });
  });

  it("recurses into arrays of objects", () => {
    const schema = z.object({
      targets: z.array(
        z.object({
          host: z.string(),
          password: configSecret({ id: "password" }),
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

  it("removes the field on the CLEAR sentinel instead of keeping stored (UX-6)", () => {
    const merged = mergeSecretFields({
      schema: strategySchema,
      incoming: { authUsername: "alice", authPassword: SECRET_CLEAR_SENTINEL },
      stored,
    });
    // Explicit clear wins over keep-existing: the field resolves to undefined,
    // so nothing is persisted (JSONB drops it) and no marker survives for the
    // run path to inflate.
    expect(merged.authPassword).toBeUndefined();
    // Untouched stored secrets are still kept.
    expect(merged.authToken).toBe("${{ secrets.MY_TOKEN }}");
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
      config: { authPassword: healthcheckSecretMarker("authPassword") },
      collectors: [
        {
          id: "entry-1",
          collectorId: "http.request",
          config: { apiKey: healthcheckSecretMarker("apiKey"), url: "https://x" },
        },
      ],
      internalSecrets,
    });

    expect(internalSecrets.store.size).toBe(1);
    expect([...internalSecrets.store.values()]).toEqual(["unrelated"]);
  });

  it("deletes secrets even when the strategy AND collector plugins are UNINSTALLED", async () => {
    // Schema-free enumeration: a deleted check must not orphan secrets just
    // because its plugins are no longer loaded.
    const internalSecrets = fakeInternalSecrets();
    await internalSecrets.set({
      parts: ["healthcheck", CONFIG_ID, "strategy", "authPassword"],
      value: "s3cret",
    });
    await internalSecrets.set({
      parts: ["healthcheck", CONFIG_ID, "collector", "entry-1", "apiKey"],
      value: "collector-key",
    });

    await deleteConfigurationSecrets({
      configurationId: CONFIG_ID,
      config: { authPassword: healthcheckSecretMarker("authPassword") },
      collectors: [
        {
          id: "entry-1",
          collectorId: "gone.collector",
          config: { apiKey: healthcheckSecretMarker("apiKey") },
        },
      ],
      internalSecrets,
    });

    expect(internalSecrets.store.size).toBe(0);
  });
});

describe("pruneOrphanedConfigurationSecrets", () => {
  /** Seed the internal store with the strategy secrets used below. */
  function seed() {
    const internalSecrets = fakeInternalSecrets();
    return internalSecrets;
  }
  const passwordParts = healthcheckSecretParts({
    configurationId: CONFIG_ID,
    scope: { kind: "strategy" },
    secretId: "authPassword",
  });
  const tokenParts = healthcheckSecretParts({
    configurationId: CONFIG_ID,
    scope: { kind: "strategy" },
    secretId: "authToken",
  });

  it("deletes a secret orphaned by a CLEARED/removed field (UX-6 / GitOps)", async () => {
    const internalSecrets = seed();
    await internalSecrets.set({ parts: passwordParts, value: "old-pw" });
    await internalSecrets.set({ parts: tokenParts, value: "keep-token" });

    const deleted = await pruneOrphanedConfigurationSecrets({
      configurationId: CONFIG_ID,
      // authPassword marker dropped; authToken marker retained.
      oldConfig: {
        authPassword: healthcheckSecretMarker("authPassword"),
        authToken: healthcheckSecretMarker("authToken"),
      },
      newConfig: { authToken: healthcheckSecretMarker("authToken") },
      oldCollectors: undefined,
      newCollectors: undefined,
      internalSecrets,
    });

    expect(deleted).toBe(1);
    expect(await internalSecrets.get({ parts: passwordParts })).toBeUndefined();
    expect(await internalSecrets.get({ parts: tokenParts })).toBe("keep-token");
  });

  it("deletes the old inline secret when a field is swapped to a reference", async () => {
    const internalSecrets = seed();
    await internalSecrets.set({ parts: tokenParts, value: "old-inline" });

    const deleted = await pruneOrphanedConfigurationSecrets({
      configurationId: CONFIG_ID,
      oldConfig: { authToken: healthcheckSecretMarker("authToken") },
      newConfig: { authToken: "${{ secrets.MY_TOKEN }}" },
      oldCollectors: undefined,
      newCollectors: undefined,
      internalSecrets,
    });

    expect(deleted).toBe(1);
    expect(await internalSecrets.get({ parts: tokenParts })).toBeUndefined();
  });

  it("keeps a secret that is still referenced (kept / re-typed)", async () => {
    const internalSecrets = seed();
    await internalSecrets.set({ parts: passwordParts, value: "still-here" });

    const deleted = await pruneOrphanedConfigurationSecrets({
      configurationId: CONFIG_ID,
      oldConfig: { authPassword: healthcheckSecretMarker("authPassword") },
      newConfig: { authPassword: healthcheckSecretMarker("authPassword") },
      oldCollectors: undefined,
      newCollectors: undefined,
      internalSecrets,
    });

    expect(deleted).toBe(0);
    expect(await internalSecrets.get({ parts: passwordParts })).toBe("still-here");
  });

  it("deletes secrets of a REMOVED collector entry", async () => {
    const internalSecrets = seed();
    const entryParts = healthcheckSecretParts({
      configurationId: CONFIG_ID,
      scope: { kind: "collector", entryId: "entry-1" },
      secretId: "apiKey",
    });
    await internalSecrets.set({ parts: entryParts, value: "collector-secret" });

    const deleted = await pruneOrphanedConfigurationSecrets({
      configurationId: CONFIG_ID,
      oldConfig: {},
      newConfig: {},
      oldCollectors: [
        {
          id: "entry-1",
          collectorId: "http.request",
          config: { apiKey: healthcheckSecretMarker("apiKey"), url: "https://x" },
        },
      ],
      newCollectors: [],
      internalSecrets,
    });

    expect(deleted).toBe(1);
    expect(await internalSecrets.get({ parts: entryParts })).toBeUndefined();
  });

  it("KEEPS a strategy marker preserved verbatim when the new strategy is unregistered", async () => {
    // Round-2 finding #3: switching to an unregistered strategy preserves the
    // old markers in the row (no schema to enumerate them on the new side). The
    // literal-presence check must recognize the retained marker and NOT delete
    // its still-referenced secret.
    const internalSecrets = seed();
    await internalSecrets.set({ parts: passwordParts, value: "live" });
    const marker = healthcheckSecretMarker("authPassword");

    const deleted = await pruneOrphanedConfigurationSecrets({
      configurationId: CONFIG_ID,
      oldConfig: { authPassword: marker },
      newConfig: { authPassword: marker }, // preserved verbatim (new strategy has no schema)
      oldCollectors: undefined,
      newCollectors: undefined,
      internalSecrets,
    });

    expect(deleted).toBe(0);
    expect(await internalSecrets.get({ parts: passwordParts })).toBe("live");
  });

  it("KEEPS a preserved collector marker when the collector becomes unregistered", async () => {
    const internalSecrets = seed();
    const entryParts = healthcheckSecretParts({
      configurationId: CONFIG_ID,
      scope: { kind: "collector", entryId: "c1" },
      secretId: "apiKey",
    });
    await internalSecrets.set({ parts: entryParts, value: "live" });
    const marker = healthcheckSecretMarker("apiKey");

    const deleted = await pruneOrphanedConfigurationSecrets({
      configurationId: CONFIG_ID,
      oldConfig: {},
      newConfig: {},
      // Old entry registered (schema enumerates the marker); new entry has the
      // SAME preserved config but an unregistered collectorId.
      oldCollectors: [
        { id: "c1", collectorId: "http.request", config: { apiKey: marker, url: "https://x" } },
      ],
      newCollectors: [
        { id: "c1", collectorId: "gone.collector", config: { apiKey: marker, url: "https://x" } },
      ],
      internalSecrets,
    });

    expect(deleted).toBe(0);
    expect(await internalSecrets.get({ parts: entryParts })).toBe("live");
  });

  it("prunes a cleared field whose marker string is a PREFIX of a kept sibling's marker", async () => {
    // Round-3 re-review finding: a serialized-JSON substring presence check
    // (`newText.includes(marker.value)`) false-positives when one x-secret
    // field's walk-path is a prefix of a sibling's (e.g. `token`/`tokenSecret`),
    // because `__hcsecret__:token` is a substring of `__hcsecret__:tokenSecret`.
    // Clearing the shorter field must still delete its now-orphaned secret.
    const internalSecrets = seed();
    const tokenP = healthcheckSecretParts({
      configurationId: CONFIG_ID,
      scope: { kind: "strategy" },
      secretId: "token",
    });
    const tokenSecretP = healthcheckSecretParts({
      configurationId: CONFIG_ID,
      scope: { kind: "strategy" },
      secretId: "tokenSecret",
    });
    await internalSecrets.set({ parts: tokenP, value: "cleared-one" });
    await internalSecrets.set({ parts: tokenSecretP, value: "kept-one" });

    const deleted = await pruneOrphanedConfigurationSecrets({
      configurationId: CONFIG_ID,
      oldConfig: {
        token: healthcheckSecretMarker("token"),
        tokenSecret: healthcheckSecretMarker("tokenSecret"),
      },
      // `token` cleared; `tokenSecret` kept. `tokenSecret`'s marker string
      // literally contains `token`'s marker string.
      newConfig: { tokenSecret: healthcheckSecretMarker("tokenSecret") },
      oldCollectors: undefined,
      newCollectors: undefined,
      internalSecrets,
    });

    expect(deleted).toBe(1);
    expect(await internalSecrets.get({ parts: tokenP })).toBeUndefined();
    expect(await internalSecrets.get({ parts: tokenSecretP })).toBe("kept-one");
  });
});

describe("listPopulatedSecretKeys", () => {
  it("lists only secret keys that actually hold a stored value", () => {
    const keys = listPopulatedSecretKeys({
      schema: strategySchema,
      config: {
        authUsername: "alice",
        authPassword: healthcheckSecretMarker("authPassword"), // inline stored
        // authToken absent -> never set
      },
    });
    expect(keys).toEqual(["authPassword"]);
  });

  it("counts a reference as populated but a blank/absent secret as not", () => {
    expect(
      listPopulatedSecretKeys({
        schema: strategySchema,
        config: { authToken: "${{ secrets.T }}" },
      }),
    ).toEqual(["authToken"]);
    expect(
      listPopulatedSecretKeys({
        schema: strategySchema,
        config: { authPassword: "" },
      }),
    ).toEqual([]);
    expect(
      listPopulatedSecretKeys({ schema: strategySchema, config: {} }),
    ).toEqual([]);
  });

  it("ignores non-secret fields", () => {
    expect(
      listPopulatedSecretKeys({
        schema: strategySchema,
        config: { authUsername: "alice", timeout: 5 },
      }),
    ).toEqual([]);
  });
});

describe("union-typed secret fields (redact + merge descend unions)", () => {
  // An x-secret field nested inside a discriminated union - extract stores a
  // marker here, so redact MUST strip it and merge MUST restore keep-existing.
  const unionSchema = z.object({
    auth: z.discriminatedUnion("type", [
      z.object({ type: z.literal("none") }),
      z.object({
        type: z.literal("basic"),
        password: configSecret({ id: "password" }),
      }),
    ]),
  });

  it("redactSecretFields strips a secret inside a discriminated union", () => {
    const redacted = redactSecretFields({
      schema: unionSchema,
      config: { auth: { type: "basic", password: healthcheckSecretMarker("auth.password") } },
    });
    expect(redacted).toEqual({ auth: { type: "basic" } });
  });

  it("redactSecretFields keeps a reference inside a union", () => {
    const redacted = redactSecretFields({
      schema: unionSchema,
      config: { auth: { type: "basic", password: "${{ secrets.PW }}" } },
    });
    expect(redacted).toEqual({
      auth: { type: "basic", password: "${{ secrets.PW }}" },
    });
  });

  it("mergeSecretFields restores a blank secret inside a union (keep-existing)", () => {
    const merged = mergeSecretFields({
      schema: unionSchema,
      incoming: { auth: { type: "basic", password: "" } },
      stored: { auth: { type: "basic", password: healthcheckSecretMarker("auth.password") } },
    });
    expect((merged.auth as Record<string, unknown>).password).toBe(
      healthcheckSecretMarker("auth.password"),
    );
  });

  it("extractConfigurationSecrets extracts a secret inside a union", async () => {
    const internalSecrets = fakeInternalSecrets();
    const result = await extractConfigurationSecrets({
      configurationId: CONFIG_ID,
      strategySchema: unionSchema,
      config: { auth: { type: "basic", password: "plain-pw" } },
      collectors: undefined,
      getCollectorSchema: () => undefined,
      internalSecrets,
    });
    const auth = result.config.auth as Record<string, unknown>;
    expect(isHealthcheckSecretMarker(auth.password as string)).toBe(true);
    expect([...internalSecrets.store.values()]).toContain("plain-pw");
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
