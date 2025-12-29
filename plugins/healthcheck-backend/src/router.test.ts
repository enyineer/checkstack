import { describe, it, expect, mock } from "bun:test";
import { router } from "./router";
import { createMockRpcContext } from "@checkmate/backend-api";
import { call } from "@orpc/server";
import { z } from "zod";

describe("HealthCheck Router", () => {
  const mockUser = {
    id: "test-user",
    permissions: ["*"],
    roles: ["admin"],
  };

  it("getStrategies returns strategies from registry", async () => {
    const context = createMockRpcContext({
      user: mockUser,
      healthCheckRegistry: {
        getStrategies: mock().mockReturnValue([
          {
            id: "http",
            displayName: "HTTP",
            description: "Check HTTP",
            configSchema: z.object({}),
          },
        ]),
      } as any,
    });

    const result = await call(router.getStrategies, undefined, { context });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("http");
  });

  it("getConfigurations calls service", async () => {
    const context = createMockRpcContext({
      user: mockUser,
    });

    // Wire up sufficient database mock to not crash
    const mockQuery = mock().mockResolvedValue([]);
    (context.db.select as any) = mock().mockReturnValue({
      from: mockQuery,
    });

    const result = await call(router.getConfigurations, undefined, { context });
    expect(Array.isArray(result)).toBe(true);
  });
});
