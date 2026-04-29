import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createAnnouncementRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import { createMockDb } from "@checkstack/test-utils-backend";
import { ANNOUNCEMENT_UPDATED } from "@checkstack/announcement-common";
import { call } from "@orpc/server";
import type { AnnouncementCache } from "./cache";

const passthroughCache: AnnouncementCache = {
  wrapActive: (_props, loader) => loader(),
  wrapListAll: (loader) => loader(),
  invalidateAllActive: async () => 0,
  invalidateUserActive: async () => 0,
  invalidateListAll: async () => {},
  scope: {} as AnnouncementCache["scope"],
};

describe("Announcement Router", () => {
  const adminUser = {
    type: "user" as const,
    id: "admin-user-1",
    accessRules: ["*"],
    roles: [],
  };

  const regularUser = {
    type: "user" as const,
    id: "regular-user-1",
    accessRules: ["announcement.announcement.read"],
    roles: [],
  };

  let mockDb: ReturnType<typeof createMockDb>;
  let router: ReturnType<typeof createAnnouncementRouter>;

  const mockSignalService = {
    broadcast: mock(() => Promise.resolve()),
    sendToUser: mock(() => Promise.resolve()),
    sendToUsers: mock(() => Promise.resolve()),
    sendToAuthorizedUsers: mock(() => Promise.resolve()),
  };

  const sampleAnnouncement = {
    id: "ann-1",
    title: "Test Announcement",
    message: "This is a **test** announcement.",
    severity: "info",
    visibility: "all",
    displayMode: "both",
    active: true,
    startsAt: undefined,
    expiresAt: undefined,
    createdBy: "admin-user-1",
    createdAt: new Date("2026-04-17T10:00:00Z"),
    updatedAt: new Date("2026-04-17T10:00:00Z"),
  };

  beforeEach(() => {
    mockDb = createMockDb();
    mockSignalService.broadcast.mockClear();
    router = createAnnouncementRouter(
      mockDb as never,
      mockSignalService,
      passthroughCache,
    );
  });

  // ---------------------------------------------------------------------------
  // getActiveAnnouncements
  // ---------------------------------------------------------------------------
  describe("getActiveAnnouncements", () => {
    it("returns active announcements for anonymous users", async () => {
      const context = createMockRpcContext({ user: undefined });

      // Mock select chain for announcements query
      const mockWhereChain = Promise.resolve([sampleAnnouncement]);
      const mockFromChain = Object.assign(
        Promise.resolve([sampleAnnouncement]),
        { where: mock(() => mockWhereChain) },
      );
      mockDb.select.mockReturnValueOnce({
        from: mock(() => mockFromChain),
      } as never);

      const result = await call(router.getActiveAnnouncements, undefined, {
        context,
      });

      expect(result.announcements).toHaveLength(1);
      expect(result.announcements[0].title).toBe("Test Announcement");
    });

    it("filters out authenticated-only announcements for anonymous users", async () => {
      const context = createMockRpcContext({ user: undefined });

      const authenticatedOnly = {
        ...sampleAnnouncement,
        id: "ann-2",
        visibility: "authenticated",
      };

      const mockWhereChain = Promise.resolve([
        sampleAnnouncement,
        authenticatedOnly,
      ]);
      const mockFromChain = Object.assign(
        Promise.resolve([sampleAnnouncement, authenticatedOnly]),
        { where: mock(() => mockWhereChain) },
      );
      mockDb.select.mockReturnValueOnce({
        from: mock(() => mockFromChain),
      } as never);

      const result = await call(router.getActiveAnnouncements, undefined, {
        context,
      });

      // Only the "all" visibility announcement should be returned
      expect(result.announcements).toHaveLength(1);
      expect(result.announcements[0].visibility).toBe("all");
    });

    it("excludes dismissed announcements for authenticated users", async () => {
      const context = createMockRpcContext({ user: adminUser });

      // First query: active announcements
      const mockWhereChain = Promise.resolve([sampleAnnouncement]);
      const mockFromChain = Object.assign(
        Promise.resolve([sampleAnnouncement]),
        { where: mock(() => mockWhereChain) },
      );
      mockDb.select.mockReturnValueOnce({
        from: mock(() => mockFromChain),
      } as never);

      // Second query: dismissals for this user (ann-1 is dismissed)
      const dismissalWhereChain = Promise.resolve([
        { announcementId: "ann-1" },
      ]);
      const dismissalFromChain = Object.assign(
        Promise.resolve([{ announcementId: "ann-1" }]),
        { where: mock(() => dismissalWhereChain) },
      );
      mockDb.select.mockReturnValueOnce({
        from: mock(() => dismissalFromChain),
      } as never);

      const result = await call(router.getActiveAnnouncements, undefined, {
        context,
      });

      expect(result.announcements).toHaveLength(0);
    });

    it("includes dismissed announcements when includeDismissed is true", async () => {
      const context = createMockRpcContext({ user: adminUser });

      // Query returns one active announcement
      const mockWhereChain = Promise.resolve([sampleAnnouncement]);
      const mockFromChain = Object.assign(
        Promise.resolve([sampleAnnouncement]),
        { where: mock(() => mockWhereChain) },
      );
      mockDb.select.mockReturnValueOnce({
        from: mock(() => mockFromChain),
      } as never);

      // No second select should happen (dismissals query is skipped)
      const result = await call(
        router.getActiveAnnouncements,
        { includeDismissed: true },
        { context },
      );

      // ann-1 should still be returned even though it would normally be dismissed
      expect(result.announcements).toHaveLength(1);
      expect(result.announcements[0].id).toBe("ann-1");
      // Only one select call (no dismissal query)
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // dismissAnnouncement
  // ---------------------------------------------------------------------------
  describe("dismissAnnouncement", () => {
    it("creates a dismissal record for authenticated users", async () => {
      const context = createMockRpcContext({ user: regularUser });

      // Mock: check announcement exists
      const mockWhereChain = Object.assign(Promise.resolve([{ id: "ann-1" }]), {
        limit: mock(() => Promise.resolve([{ id: "ann-1" }])),
      });
      const mockFromChain = Object.assign(
        Promise.resolve([{ id: "ann-1" }]),
        { where: mock(() => mockWhereChain) },
      );
      mockDb.select.mockReturnValueOnce({
        from: mock(() => mockFromChain),
      } as never);

      // Mock: insert dismissal with onConflictDoNothing chain
      mockDb.insert.mockReturnValueOnce({
        values: mock(() => ({
          onConflictDoNothing: mock(() => Promise.resolve()),
        })),
      } as never);

      await call(
        router.dismissAnnouncement,
        { announcementId: "ann-1" },
        { context },
      );

      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("rejects unauthenticated users", async () => {
      const context = createMockRpcContext({ user: undefined });

      await expect(
        call(
          router.dismissAnnouncement,
          { announcementId: "ann-1" },
          { context },
        ),
      ).rejects.toThrow("Authentication required");
    });

    it("throws NOT_FOUND for non-existent announcements", async () => {
      const context = createMockRpcContext({ user: regularUser });

      // Mock: announcement not found
      const mockWhereChain = Object.assign(Promise.resolve([]), {
        limit: mock(() => Promise.resolve([])),
      });
      const mockFromChain = Object.assign(Promise.resolve([]), {
        where: mock(() => mockWhereChain),
      });
      mockDb.select.mockReturnValueOnce({
        from: mock(() => mockFromChain),
      } as never);

      await expect(
        call(
          router.dismissAnnouncement,
          { announcementId: "nonexistent" },
          { context },
        ),
      ).rejects.toThrow("Announcement not found");
    });
  });

  // ---------------------------------------------------------------------------
  // Admin: CRUD operations
  // ---------------------------------------------------------------------------
  describe("createAnnouncement", () => {
    it("creates an announcement with all fields", async () => {
      const context = createMockRpcContext({ user: adminUser });

      // Mock: insert with returning chain
      const createdRow = {
        ...sampleAnnouncement,
        id: "new-id",
        title: "New Announcement",
        severity: "warning",
        displayMode: "banner",
        createdBy: adminUser.id,
      };
      mockDb.insert.mockReturnValueOnce({
        values: mock(() => ({
          returning: mock(() => Promise.resolve([createdRow])),
        })),
      } as never);

      const result = await call(
        router.createAnnouncement,
        {
          title: "New Announcement",
          message: "Important update!",
          severity: "warning",
          visibility: "all",
          displayMode: "banner",
          active: true,
        },
        { context },
      );

      expect(mockDb.insert).toHaveBeenCalled();
      expect(result.title).toBe("New Announcement");
      expect(result.severity).toBe("warning");
      expect(result.displayMode).toBe("banner");

      // Verify signal was broadcast
      expect(mockSignalService.broadcast).toHaveBeenCalledWith(
        ANNOUNCEMENT_UPDATED,
        { announcementId: "new-id", action: "created" },
      );
    });

    it("rejects unauthenticated users", async () => {
      const context = createMockRpcContext({ user: undefined });

      await expect(
        call(
          router.createAnnouncement,
          {
            title: "Test",
            message: "Test",
            severity: "info",
            visibility: "all",
            displayMode: "both",
          },
          { context },
        ),
      ).rejects.toThrow("Authentication required");
    });
  });

  describe("updateAnnouncement", () => {
    it("updates an existing announcement", async () => {
      const context = createMockRpcContext({ user: adminUser });

      const updatedRow = { ...sampleAnnouncement, title: "Updated Title" };
      mockDb.update.mockReturnValueOnce({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(() => Promise.resolve([updatedRow])),
          })),
        })),
      } as never);

      const result = await call(
        router.updateAnnouncement,
        { id: "ann-1", title: "Updated Title" },
        { context },
      );

      expect(result.title).toBe("Updated Title");

      // Verify signal was broadcast
      expect(mockSignalService.broadcast).toHaveBeenCalledWith(
        ANNOUNCEMENT_UPDATED,
        { announcementId: "ann-1", action: "updated" },
      );
    });

    it("throws NOT_FOUND for non-existent announcement", async () => {
      const context = createMockRpcContext({ user: adminUser });

      mockDb.update.mockReturnValueOnce({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(() => Promise.resolve([])),
          })),
        })),
      } as never);

      await expect(
        call(
          router.updateAnnouncement,
          { id: "nonexistent", title: "Test" },
          { context },
        ),
      ).rejects.toThrow("Announcement not found");
    });
  });

  describe("deleteAnnouncement", () => {
    it("deletes an announcement and returns success", async () => {
      const context = createMockRpcContext({ user: adminUser });

      // Mock: delete with returning chain
      mockDb.delete.mockReturnValueOnce({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([{ id: "ann-1" }])),
        })),
      } as never);

      const result = await call(
        router.deleteAnnouncement,
        { id: "ann-1" },
        { context },
      );

      expect(result.success).toBe(true);
      expect(mockDb.delete).toHaveBeenCalled();

      // Verify signal was broadcast
      expect(mockSignalService.broadcast).toHaveBeenCalledWith(
        ANNOUNCEMENT_UPDATED,
        { announcementId: "ann-1", action: "deleted" },
      );
    });
  });

  describe("listAllAnnouncements", () => {
    it("returns all announcements for admins", async () => {
      const context = createMockRpcContext({ user: adminUser });

      const mockOrderByChain = Promise.resolve([sampleAnnouncement]);
      const mockFromChain = Object.assign(
        Promise.resolve([sampleAnnouncement]),
        { orderBy: mock(() => mockOrderByChain) },
      );
      mockDb.select.mockReturnValueOnce({
        from: mock(() => mockFromChain),
      } as never);

      const result = await call(router.listAllAnnouncements, undefined, {
        context,
      });

      expect(result.announcements).toHaveLength(1);
    });
  });
});
