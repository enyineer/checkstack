import { describe, it, expect, mock } from "bun:test";
import { MaintenanceService } from "./service";

/**
 * Mock db for hasActiveMaintenance. The method issues two select shapes
 * in order:
 *  1. .select({maintenanceId}).from(maintenanceSystems).where(...) -> ids
 *  2. .select({id}).from(maintenances).where(...).limit(1)         -> match
 * We disambiguate by call order.
 */
function createMockDb(opts: {
  systemMaintenanceIds: string[];
  activeMatch: boolean;
}) {
  let firstSelect = true;
  return {
    select: mock(() => {
      if (firstSelect) {
        firstSelect = false;
        return {
          from: mock(() => ({
            where: mock(() =>
              Promise.resolve(
                opts.systemMaintenanceIds.map((maintenanceId) => ({
                  maintenanceId,
                })),
              ),
            ),
          })),
        };
      }
      return {
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() =>
              Promise.resolve(opts.activeMatch ? [{ id: "m-1" }] : []),
            ),
          })),
        })),
      };
    }),
  };
}

describe("MaintenanceService.hasActiveMaintenance", () => {
  it("returns false when the system has no maintenance memberships", async () => {
    const db = createMockDb({ systemMaintenanceIds: [], activeMatch: false });
    const service = new MaintenanceService(db as never);
    expect(await service.hasActiveMaintenance("system-1")).toBe(false);
  });

  it("returns true when an in_progress maintenance covers the system", async () => {
    const db = createMockDb({
      systemMaintenanceIds: ["m-1"],
      activeMatch: true,
    });
    const service = new MaintenanceService(db as never);
    expect(await service.hasActiveMaintenance("system-1")).toBe(true);
  });

  it("returns false when memberships exist but none are in_progress", async () => {
    const db = createMockDb({
      systemMaintenanceIds: ["m-1", "m-2"],
      activeMatch: false,
    });
    const service = new MaintenanceService(db as never);
    expect(await service.hasActiveMaintenance("system-1")).toBe(false);
  });
});
