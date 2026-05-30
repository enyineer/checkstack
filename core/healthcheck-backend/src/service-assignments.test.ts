import { describe, it, expect, mock, beforeEach } from "bun:test";
import { HealthCheckService } from "./service";

/**
 * Tests for getAssignmentsForSatellite run-context population:
 * - assignments carry configName (from the config row's name)
 * - systemName resolves via the optional catalog client, falling back to
 *   systemId when no client is wired or the lookup fails.
 */
describe("HealthCheckService.getAssignmentsForSatellite", () => {
  const SATELLITE_ID = "sat-1";

  type Association = {
    systemId: string;
    configurationId: string;
    satelliteIds: string[] | null;
    enabled: boolean;
  };

  type Config = {
    id: string;
    name: string;
    strategyId: string;
    config: Record<string, unknown>;
    collectors: unknown[] | null;
    intervalSeconds: number;
    paused: boolean;
  };

  let associations: Association[] = [];
  let configs: Config[] = [];

  /**
   * Mock db: the method issues two distinct select shapes:
   * - associations: .select({...}).from(systemHealthChecks)  -> awaited array
   * - config:        .select().from(...).where(...)           -> awaited array
   * We disambiguate by call order: the first select() resolves associations,
   * subsequent select().from().where() resolve a single matching config.
   */
  function createMockDb() {
    let firstSelect = true;
    return {
      select: mock(() => {
        if (firstSelect) {
          firstSelect = false;
          return {
            from: mock(() => Promise.resolve([...associations])),
          };
        }
        return {
          from: mock(() => ({
            where: mock(() => {
              // Return the next unmatched config in order; the loop fetches
              // one config per matching association.
              return Promise.resolve(configs.length > 0 ? [configs[0]] : []);
            }),
          })),
        };
      }),
    };
  }

  beforeEach(() => {
    associations = [];
    configs = [];
  });

  it("populates configName and resolves systemName via the catalog client", async () => {
    associations = [
      {
        systemId: "system-1",
        configurationId: "config-1",
        satelliteIds: [SATELLITE_ID],
        enabled: true,
      },
    ];
    configs = [
      {
        id: "config-1",
        name: "API health",
        strategyId: "http",
        config: { url: "https://example.com" },
        collectors: null,
        intervalSeconds: 60,
        paused: false,
      },
    ];

    const getSystem = mock(() =>
      Promise.resolve({ id: "system-1", name: "Production API" }),
    );
    const catalogClient = { getSystem } as never;

    const mockDb = createMockDb();
    const service = new HealthCheckService(
      mockDb as never,
      {} as never,
      {} as never,
      undefined,
      catalogClient,
    );

    const result = await service.getAssignmentsForSatellite(SATELLITE_ID);

    expect(result).toHaveLength(1);
    expect(result[0].configName).toBe("API health");
    expect(result[0].systemName).toBe("Production API");
    expect(getSystem).toHaveBeenCalledWith({ systemId: "system-1" });
  });

  it("falls back to systemId when no catalog client is provided", async () => {
    associations = [
      {
        systemId: "system-1",
        configurationId: "config-1",
        satelliteIds: [SATELLITE_ID],
        enabled: true,
      },
    ];
    configs = [
      {
        id: "config-1",
        name: "API health",
        strategyId: "http",
        config: {},
        collectors: null,
        intervalSeconds: 30,
        paused: false,
      },
    ];

    const mockDb = createMockDb();
    const service = new HealthCheckService(
      mockDb as never,
      {} as never,
      {} as never,
    );

    const result = await service.getAssignmentsForSatellite(SATELLITE_ID);

    expect(result).toHaveLength(1);
    expect(result[0].configName).toBe("API health");
    expect(result[0].systemName).toBe("system-1");
  });

  it("falls back to systemId when the catalog lookup throws", async () => {
    associations = [
      {
        systemId: "system-1",
        configurationId: "config-1",
        satelliteIds: [SATELLITE_ID],
        enabled: true,
      },
    ];
    configs = [
      {
        id: "config-1",
        name: "API health",
        strategyId: "http",
        config: {},
        collectors: null,
        intervalSeconds: 60,
        paused: false,
      },
    ];

    const getSystem = mock(() => Promise.reject(new Error("catalog down")));
    const catalogClient = { getSystem } as never;

    const mockDb = createMockDb();
    const service = new HealthCheckService(
      mockDb as never,
      {} as never,
      {} as never,
      undefined,
      catalogClient,
    );

    const result = await service.getAssignmentsForSatellite(SATELLITE_ID);

    expect(result).toHaveLength(1);
    expect(result[0].systemName).toBe("system-1");
  });
});
