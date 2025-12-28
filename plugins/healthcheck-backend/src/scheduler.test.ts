import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { Scheduler } from "./scheduler";
import { HealthCheckRegistry, Logger } from "@checkmate/backend-api";
import {
  healthCheckConfigurations,
  systemHealthChecks,
  healthCheckRuns,
} from "./schema";

// Helper to create a thenable mock for Drizzle
const createMockDb = () => {
  const chain: any = {};
  chain.select = mock(() => chain);
  chain.from = mock(() => chain);
  chain.innerJoin = mock(() => chain);
  chain.where = mock(() => chain);
  chain.insert = mock(() => chain);
  chain.values = mock(() => Promise.resolve());

  // Default then implementation
  chain.then = mock((resolve: any) => resolve([]));

  return chain;
};

describe("Scheduler", () => {
  let db: any;
  let registry: any;
  let logger: any;
  let fetch: any;
  let tokenVerification: any;
  let scheduler: Scheduler;

  beforeEach(() => {
    db = createMockDb();
    registry = {
      getStrategy: mock(),
    };
    logger = {
      info: mock(),
      warn: mock(),
      error: mock(),
      debug: mock(),
    };
    fetch = {
      fetch: mock(() => Promise.resolve({ ok: true, text: () => "" })),
    };
    tokenVerification = {
      sign: mock(() => Promise.resolve("mock-token")),
      verify: mock(() => Promise.resolve({})),
    };
    scheduler = new Scheduler(
      db,
      registry as HealthCheckRegistry,
      logger as Logger,
      fetch,
      tokenVerification
    );
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe("start/stop", () => {
    it("should start and stop the interval", () => {
      // Use fake timers or just check if interval is set
      // Since Bun doesn't have a built-in 'useFakeTimers' like Jest yet (it has some support but it's limited in current versions or requires specific setup)
      // we can check internal state if we make it accessible or just verify call to setInterval.
      // Actually, Bun.jest.useFakeTimers() is available.

      const setIntervalSpy = spyOn(globalThis, "setInterval");
      const clearIntervalSpy = spyOn(globalThis, "clearInterval");

      scheduler.start(1000);
      expect(setIntervalSpy).toHaveBeenCalled();

      scheduler.stop();
      expect(clearIntervalSpy).toHaveBeenCalled();

      setIntervalSpy.restore();
      clearIntervalSpy.restore();
    });

    it("should not start multiple intervals", () => {
      const setIntervalSpy = spyOn(globalThis, "setInterval");
      scheduler.start(1000);
      scheduler.start(1000);
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      setIntervalSpy.restore();
    });
  });

  describe("tick", () => {
    it("should fetch enabled checks and execute them", async () => {
      const mockChecks = [
        {
          systemId: "sys-1",
          configId: "cfg-1",
          strategyId: "strat-1",
          config: { url: "http://example.com" },
          interval: 60,
        },
      ];

      db.then.mockImplementation((resolve: any) => resolve(mockChecks));

      const mockStrategy = {
        execute: mock(async () => ({ status: "healthy" })),
      };
      registry.getStrategy.mockReturnValue(mockStrategy);

      // Trigger tick manually since it's private, we'll use (scheduler as any).tick()
      await (scheduler as any).tick();

      expect(db.select).toHaveBeenCalled();
      expect(registry.getStrategy).toHaveBeenCalledWith("strat-1");
      expect(mockStrategy.execute).toHaveBeenCalledWith({
        url: "http://example.com",
      });
      expect(db.insert).toHaveBeenCalledWith(healthCheckRuns);
    });

    it("should pick up configuration updates between ticks", async () => {
      const mockStrategy = {
        execute: mock(async () => ({ status: "healthy" })),
      };
      registry.getStrategy.mockReturnValue(mockStrategy);

      // Tick 1: Config 1
      db.then.mockImplementationOnce((resolve: any) =>
        resolve([
          {
            systemId: "sys-1",
            configId: "cfg-1",
            strategyId: "strat-1",
            config: { url: "v1" },
            interval: 60,
          },
        ])
      );

      await (scheduler as any).tick();
      expect(mockStrategy.execute).toHaveBeenCalledWith({ url: "v1" });

      // Tick 2: Config updated to v2
      db.then.mockImplementationOnce((resolve: any) =>
        resolve([
          {
            systemId: "sys-1",
            configId: "cfg-1",
            strategyId: "strat-1",
            config: { url: "v2" },
            interval: 60,
          },
        ])
      );

      await (scheduler as any).tick();
      expect(mockStrategy.execute).toHaveBeenCalledWith({ url: "v2" });
    });

    it("should handle missing strategy", async () => {
      db.then.mockImplementation((resolve: any) =>
        resolve([
          {
            systemId: "sys-1",
            configId: "cfg-1",
            strategyId: "missing",
            config: {},
            interval: 60,
          },
        ])
      );

      registry.getStrategy.mockReturnValue(undefined);

      await (scheduler as any).tick();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Strategy missing not found")
      );
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("should handle strategy execution errors", async () => {
      db.then.mockImplementation((resolve: any) =>
        resolve([
          {
            systemId: "sys-1",
            configId: "cfg-1",
            strategyId: "strat-1",
            config: {},
            interval: 60,
          },
        ])
      );

      const mockStrategy = {
        execute: mock(async () => {
          throw new Error("Network error");
        }),
      };
      registry.getStrategy.mockReturnValue(mockStrategy);

      await (scheduler as any).tick();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to execute check"),
        expect.any(Error)
      );
      expect(db.insert).toHaveBeenCalledWith(healthCheckRuns);
      // Verify it inserted an 'unhealthy' status
      const insertValuesMatch = db.values.mock.calls[0][0];
      expect(insertValuesMatch.status).toBe("unhealthy");
    });
  });
});

function spyOn(obj: any, prop: string) {
  const original = obj[prop];
  const m = mock((...args: any[]) => original.apply(obj, args));
  obj[prop] = m;
  return Object.assign(m, {
    restore: () => {
      obj[prop] = original;
    },
  });
}
