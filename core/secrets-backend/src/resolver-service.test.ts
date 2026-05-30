import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { configString } from "@checkstack/backend-api";
import { createSecretResolverService } from "./resolver-service";
import type { SecretStore } from "./secret-resolver";

const store: SecretStore = {
  resolve: async (name) => {
    const values: Record<string, string> = {
      jira_token: "jira-secret-value",
      DB_PASS: "db-secret-value",
      missing: "", // present-but-empty, distinct from absent
    };
    if (!(name in values)) throw new Error(`Secret not found: ${name}`);
    return values[name];
  },
};

describe("SecretResolverService.resolveBySchema", () => {
  it("resolves ${{ secrets.NAME }} only in x-secret fields", async () => {
    const service = createSecretResolverService({ secretStore: store });
    const schema = z.object({
      host: z.string(),
      password: configString({ "x-secret": true }),
    });
    const { resolved, warnings } = await service.resolveBySchema({
      value: { host: "h", password: "${{ secrets.DB_PASS }}" },
      schema,
    });
    expect(resolved).toEqual({ host: "h", password: "db-secret-value" });
    expect(warnings).toEqual([]);
  });
});

describe("SecretResolverService.resolveForRun", () => {
  it("resolves a least-privilege env allowlist + masking context", async () => {
    const service = createSecretResolverService({ secretStore: store });
    const { env, masking } = await service.resolveForRun({
      secretEnv: {
        API_TOKEN: "${{ secrets.jira_token }}",
        DATABASE_PASSWORD: "${{ secrets.DB_PASS }}",
      },
    });
    expect(env).toEqual({
      API_TOKEN: "jira-secret-value",
      DATABASE_PASSWORD: "db-secret-value",
    });
    expect(masking.size).toBe(2);
    // The masking context redacts the resolved values out of output.
    expect(masking.maskText("token=jira-secret-value")).toBe("token=****");
  });

  it("supports inline interpolation in a mapping value", async () => {
    const service = createSecretResolverService({ secretStore: store });
    const { env } = await service.resolveForRun({
      secretEnv: { CONN: "user:${{ secrets.DB_PASS }}@host" },
    });
    expect(env.CONN).toBe("user:db-secret-value@host");
  });

  it("throws when a referenced secret cannot be resolved", async () => {
    const service = createSecretResolverService({ secretStore: store });
    await expect(
      service.resolveForRun({ secretEnv: { X: "${{ secrets.absent }}" } }),
    ).rejects.toThrow("Secret not found: absent");
  });

  it("resolves each distinct secret once even when reused", async () => {
    let calls = 0;
    const counting: SecretStore = {
      resolve: async (name) => {
        calls++;
        return `val-${name}`;
      },
    };
    const service = createSecretResolverService({ secretStore: counting });
    await service.resolveForRun({
      secretEnv: {
        A: "${{ secrets.same }}",
        B: "${{ secrets.same }}",
        C: "${{ secrets.other }}",
      },
    });
    // "same" + "other" → 2 distinct resolutions despite 3 references.
    expect(calls).toBe(2);
  });
});
