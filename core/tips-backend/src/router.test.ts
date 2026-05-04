import { describe, it, expect, mock } from "bun:test";
import { createTipsRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import { createMockDb } from "@checkstack/test-utils-backend";
import { call } from "@orpc/server";

describe("Tips Router", () => {
  const mockUser = {
    type: "user" as const,
    id: "test-user-123",
    accessRules: [],
    roles: [],
  } as any;

  const mockDb = createMockDb();
  const router = createTipsRouter(mockDb as any);

  describe("listDismissed", () => {
    it("returns the dismissed tips for the current user", async () => {
      const context = createMockRpcContext({ user: mockUser });

      const dismissedAt = new Date("2026-05-04T00:00:00Z");
      const rows = [
        { tipId: "catalog.systems.create", dismissedAt },
        { tipId: "healthcheck.results.filter", dismissedAt },
      ];
      const mockWhereChain = Promise.resolve(rows);
      const mockFromChain = {
        where: mock(() => mockWhereChain),
      };
      mockDb.select.mockReturnValueOnce({
        from: mock(() => mockFromChain),
      } as any);

      const result = await call(router.listDismissed, undefined, { context });
      expect(result.dismissed).toHaveLength(2);
      expect(result.dismissed[0]?.tipId).toBe("catalog.systems.create");
    });

    it("returns an empty array when the user has not dismissed anything", async () => {
      const context = createMockRpcContext({ user: mockUser });

      const mockWhereChain = Promise.resolve([]);
      const mockFromChain = {
        where: mock(() => mockWhereChain),
      };
      mockDb.select.mockReturnValueOnce({
        from: mock(() => mockFromChain),
      } as any);

      const result = await call(router.listDismissed, undefined, { context });
      expect(result.dismissed).toEqual([]);
    });

    it("requires authentication", async () => {
      const context = createMockRpcContext({ user: undefined });

      await expect(
        call(router.listDismissed, undefined, { context }),
      ).rejects.toThrow("Authentication required");
    });
  });

  describe("dismiss", () => {
    it("inserts a dismissal idempotently", async () => {
      const context = createMockRpcContext({ user: mockUser });

      await call(
        router.dismiss,
        { tipId: "catalog.systems.create" },
        { context },
      );

      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("rejects malformed tip IDs at the contract layer", async () => {
      const context = createMockRpcContext({ user: mockUser });

      await expect(
        call(
          router.dismiss,
          { tipId: "has spaces and !!! illegal chars" } as any,
          { context },
        ),
      ).rejects.toThrow();
    });

    it("requires authentication", async () => {
      const context = createMockRpcContext({ user: undefined });

      await expect(
        call(router.dismiss, { tipId: "catalog.systems.create" }, { context }),
      ).rejects.toThrow("Authentication required");
    });
  });

  describe("reset", () => {
    it("deletes a specific subset of dismissals when tipIds are provided", async () => {
      const context = createMockRpcContext({ user: mockUser });

      await call(
        router.reset,
        { tipIds: ["catalog.systems.create"] },
        { context },
      );

      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("clears every dismissal when tipIds is omitted", async () => {
      const context = createMockRpcContext({ user: mockUser });

      await call(router.reset, {}, { context });

      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("requires authentication", async () => {
      const context = createMockRpcContext({ user: undefined });

      await expect(
        call(router.reset, {}, { context }),
      ).rejects.toThrow("Authentication required");
    });
  });
});
