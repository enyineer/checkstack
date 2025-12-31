import { describe, it, expect, mock } from "bun:test";
import { createThemeRouter } from "./router";
import { createMockRpcContext } from "@checkmate/backend-api";
import { createMockDb } from "@checkmate/test-utils-backend";
import { call } from "@orpc/server";

describe("Theme Router", () => {
  const mockUser = {
    type: "user" as const,
    id: "test-user-123",
    permissions: [],
    roles: [],
  } as any;

  const mockDb = createMockDb();
  const router = createThemeRouter(mockDb as any);

  describe("getTheme", () => {
    it("returns user theme preference when it exists", async () => {
      const context = createMockRpcContext({ user: mockUser });

      // Mock the full query chain: select().from().where().limit()
      const mockWhereChain = Object.assign(
        Promise.resolve([{ theme: "dark" }]),
        {
          limit: mock(() => Promise.resolve([{ theme: "dark" }])),
        }
      );
      const mockFromChain = Object.assign(
        Promise.resolve([{ theme: "dark" }]),
        {
          where: mock(() => mockWhereChain),
        }
      );
      mockDb.select.mockReturnValueOnce({
        from: mock(() => mockFromChain),
      } as any);

      const result = await call(router.getTheme, undefined, { context });
      expect(result.theme).toBe("dark");
    });

    it("returns 'system' as default when no preference exists", async () => {
      const context = createMockRpcContext({ user: mockUser });

      // Mock the full query chain returning empty array
      const mockWhereChain = Object.assign(Promise.resolve([]), {
        limit: mock(() => Promise.resolve([])),
      });
      const mockFromChain = Object.assign(Promise.resolve([]), {
        where: mock(() => mockWhereChain),
      });
      mockDb.select.mockReturnValueOnce({
        from: mock(() => mockFromChain),
      } as any);

      const result = await call(router.getTheme, undefined, { context });
      expect(result.theme).toBe("system");
    });

    it("throws error when user is not authenticated", async () => {
      const context = createMockRpcContext({ user: undefined });

      await expect(
        call(router.getTheme, undefined, { context })
      ).rejects.toThrow("Authentication required");
    });
  });

  describe("setTheme", () => {
    it("saves theme preference successfully", async () => {
      const context = createMockRpcContext({ user: mockUser });

      const result = await call(
        router.setTheme,
        { theme: "dark" },
        { context }
      );

      expect(result).toBeUndefined(); // setTheme returns void
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("upserts theme preference with conflict handling", async () => {
      const context = createMockRpcContext({ user: mockUser });

      await call(router.setTheme, { theme: "light" }, { context });

      // Verify insert was called (the mock from test-utils handles onConflictDoUpdate)
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("accepts 'system' theme value", async () => {
      const context = createMockRpcContext({ user: mockUser });

      const result = await call(
        router.setTheme,
        { theme: "system" },
        { context }
      );

      expect(result).toBeUndefined();
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("throws error when user is not authenticated", async () => {
      const context = createMockRpcContext({ user: undefined });

      await expect(
        call(router.setTheme, { theme: "dark" }, { context })
      ).rejects.toThrow("Authentication required");
    });

    it("validates theme enum values", async () => {
      const context = createMockRpcContext({ user: mockUser });

      // This should be caught by Zod validation at the contract level
      // but we can verify the router accepts valid values
      const validThemes = ["light", "dark", "system"];

      for (const theme of validThemes) {
        await call(router.setTheme, { theme: theme as any }, { context });
        expect(mockDb.insert).toHaveBeenCalled();
      }
    });
  });
});
