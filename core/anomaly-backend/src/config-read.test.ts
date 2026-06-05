import { describe, test, expect, mock } from "bun:test";
import { AnomalyService } from "./service";
import type { SafeDatabase } from "@checkstack/backend-api";
import type * as schema from "./schema";

/**
 * Read-side migrate-then-validate guard. `getAnomalyConfig` and
 * `getAnomalyAssignmentConfig` previously cast the stored jsonb straight to a
 * typed `VersionedRecord`, bypassing the strategy schema entirely. They now run
 * the stored record through `anomalySettingsConfig.parseRecord` /
 * `anomalyAssignmentConfig.parseRecord`, so the data is validated (and migrated
 * once migrations exist) on every read. These tests prove the read path goes
 * through `.parseRecord`: stray keys are stripped and defaults are applied.
 */

function createSelectMockDb({
  storedConfig,
}: {
  storedConfig: unknown | undefined;
}): SafeDatabase<typeof schema> {
  const rows = storedConfig === undefined ? [] : [{ config: storedConfig }];
  const db = {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => Promise.resolve(rows)),
      })),
    })),
  };
  // The service only touches `select().from().where()` on these read paths.
  return db as unknown as SafeDatabase<typeof schema>;
}

describe("getAnomalyConfig read path", () => {
  test("validates the stored record via parseRecord (strips stray keys)", async () => {
    const service = new AnomalyService(
      createSelectMockDb({
        storedConfig: {
          version: 1,
          data: {
            enabled: false,
            baselineWindow: "30d",
            notify: false,
            // Not part of AnomalySettingsSchema — must be stripped by parse.
            legacyField: "should-be-dropped",
          },
        },
      }),
    );

    const result = await service.getAnomalyConfig("cfg-1");

    expect(result.version).toBe(1);
    expect(result.data.enabled).toBe(false);
    expect(result.data.baselineWindow).toBe("30d");
    expect(result.data.notify).toBe(false);
    expect("legacyField" in result.data).toBe(false);
  });

  test("applies schema defaults to a sparse stored record", async () => {
    const service = new AnomalyService(
      createSelectMockDb({ storedConfig: { version: 1, data: {} } }),
    );

    const result = await service.getAnomalyConfig("cfg-1");

    // Defaults come from AnomalySettingsSchema, proving validation ran.
    expect(result.data.enabled).toBe(true);
    expect(result.data.baselineWindow).toBe("7d");
    expect(result.data.notify).toBe(true);
  });

  test("returns a validated default wrapper when no row exists", async () => {
    const service = new AnomalyService(
      createSelectMockDb({ storedConfig: undefined }),
    );

    const result = await service.getAnomalyConfig("cfg-missing");

    expect(result.version).toBe(1);
    expect(result.data.enabled).toBe(true);
  });
});

describe("getAnomalyAssignmentConfig read path", () => {
  test("validates the stored override record via parseRecord", async () => {
    const service = new AnomalyService(
      createSelectMockDb({
        storedConfig: {
          version: 1,
          data: {
            enabled: true,
            // Stray key not on PartialAnomalySettingsSchema — must be stripped.
            bogus: 123,
          },
        },
      }),
    );

    const result = await service.getAnomalyAssignmentConfig("sys-1", "cfg-1");

    expect(result).toBeDefined();
    expect(result?.data.enabled).toBe(true);
    expect(result && "bogus" in result.data).toBe(false);
  });

  test("returns undefined when no override row exists", async () => {
    const service = new AnomalyService(
      createSelectMockDb({ storedConfig: undefined }),
    );

    const result = await service.getAnomalyAssignmentConfig("sys-1", "cfg-1");

    expect(result).toBeUndefined();
  });
});
