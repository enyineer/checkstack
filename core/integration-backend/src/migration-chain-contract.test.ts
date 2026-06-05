/**
 * Contract test: every integration provider `connectionSchema` (a Versioned)
 * that is stored UNVERSIONED and read back via assume-v1-on-read MUST have a
 * COMPLETE, contiguous migration chain from version 1 to its current
 * `version`. Pure STRUCTURAL check (`validateMigrationChainFromV1` — no
 * `migrate()` is run), so it carries zero per-config upkeep: the day someone
 * bumps a connection schema's `version` without shipping a covering migration,
 * the connection read path would silently fail at runtime on a genuinely-v1
 * stored connection — this test turns that into a CI failure instead. See the
 * HTTP plugin's equivalent test for the full rationale.
 *
 * Providers are registered by integration plugins (e.g. integration-jira),
 * NOT by this core package, so there are no built-in providers to enumerate.
 * This test asserts the enumeration contract holds for whatever a registry is
 * given (so any future provider's `connectionSchema` is covered automatically)
 * and exercises it with a representative fixture provider.
 */
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";
import { definePluginMetadata } from "@checkstack/common";
import { createIntegrationProviderRegistry } from "./provider-registry";
import type { IntegrationProvider } from "./provider-types";

const meta = definePluginMetadata({ pluginId: "integration-fixture" });

const fixtureProvider: IntegrationProvider<{ baseUrl: string }> = {
  id: "fixture",
  displayName: "Fixture Provider",
  connectionSchema: new Versioned({
    version: 1,
    schema: z.object({ baseUrl: z.string() }),
  }),
};

describe("integration connectionSchema migration-chain contract", () => {
  it("every registered provider connectionSchema has a complete v1->version chain", () => {
    const registry = createIntegrationProviderRegistry();
    registry.register(fixtureProvider, meta);

    const providers = registry.getProviders();
    expect(providers.length).toBeGreaterThan(0);

    for (const provider of providers) {
      if (!provider.connectionSchema) continue;
      const problem = provider.connectionSchema.validateMigrationChainFromV1();
      expect(
        problem,
        `Provider "${provider.qualifiedId}" connectionSchema (version ${provider.connectionSchema.version}) has a broken migration chain: ${problem}`,
      ).toBeUndefined();
    }
  });
});
