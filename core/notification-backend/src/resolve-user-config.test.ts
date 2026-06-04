import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";
import { resolveStrategyUserConfig } from "./resolve-user-config";

/**
 * The per-strategy `userConfig` is stored as a bare blob in the user-preference
 * record and was previously handed to `send()` verbatim, skipping the
 * strategy's own `userConfig` schema. `resolveStrategyUserConfig` closes that
 * gap by treating the stored blob as a `version: 1` record and running it
 * through `strategy.userConfig.parseAssumingV1` (migrate-then-validate).
 */
describe("resolveStrategyUserConfig", () => {
  test("validates the stored blob against the strategy schema (strips stray keys)", async () => {
    const userConfigSchema = new Versioned({
      version: 1,
      schema: z.object({ phoneNumber: z.string() }),
    });

    const result = await resolveStrategyUserConfig({
      userConfigSchema,
      storedUserConfig: {
        phoneNumber: "+15551234567",
        // Not part of the schema — must be stripped by validation.
        legacy: "drop-me",
      },
    });

    expect(result).toEqual({ phoneNumber: "+15551234567" });
  });

  test("applies schema defaults during validation", async () => {
    const userConfigSchema = new Versioned({
      version: 1,
      schema: z.object({
        phoneNumber: z.string(),
        verbose: z.boolean().default(false),
      }),
    });

    const result = await resolveStrategyUserConfig({
      userConfigSchema,
      storedUserConfig: { phoneNumber: "+1" },
    });

    expect(result).toEqual({ phoneNumber: "+1", verbose: false });
  });

  test("migrates a stored v1 blob forward via the strategy migration chain", async () => {
    // A v2 schema that renamed `phone` -> `phoneNumber`. Stored data is the
    // bare v1 shape; assume-v1 + migration must reshape it before validation.
    const userConfigSchema = new Versioned({
      version: 2,
      schema: z.object({ phoneNumber: z.string() }),
      migrations: [
        {
          fromVersion: 1,
          toVersion: 2,
          description: "rename phone -> phoneNumber",
          migrate: (data: unknown) => {
            const old = data as { phone?: string };
            return { phoneNumber: old.phone ?? "" };
          },
        },
      ],
    });

    const result = await resolveStrategyUserConfig({
      userConfigSchema,
      storedUserConfig: { phone: "+15550000000" },
    });

    expect(result).toEqual({ phoneNumber: "+15550000000" });
  });

  test("rejects a stored blob that fails validation", async () => {
    const userConfigSchema = new Versioned({
      version: 1,
      schema: z.object({ phoneNumber: z.string() }),
    });

    await expect(
      resolveStrategyUserConfig({
        userConfigSchema,
        storedUserConfig: { phoneNumber: 123 },
      }),
    ).rejects.toThrow();
  });

  test("returns undefined when the strategy declares no userConfig schema", async () => {
    const result = await resolveStrategyUserConfig({
      userConfigSchema: undefined,
      storedUserConfig: { anything: true },
    });

    expect(result).toBeUndefined();
  });

  test("returns undefined when no userConfig was stored", async () => {
    const userConfigSchema = new Versioned({
      version: 1,
      schema: z.object({ phoneNumber: z.string() }),
    });

    const result = await resolveStrategyUserConfig({
      userConfigSchema,
      storedUserConfig: undefined,
    });

    expect(result).toBeUndefined();
  });
});
