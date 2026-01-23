import { describe, it, expect, mock, beforeEach } from "bun:test";
import { HealthCheckService } from "./service";
import { createMockDb } from "@checkstack/test-utils-backend";

describe("HealthCheckService - pause/resume", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let service: HealthCheckService;
  let mockUpdate: ReturnType<typeof mock>;
  let mockSet: ReturnType<typeof mock>;
  let mockWhere: ReturnType<typeof mock>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockWhere = mock(() => Promise.resolve());
    mockSet = mock(() => ({ where: mockWhere }));
    mockUpdate = mock(() => ({ set: mockSet }));
    (mockDb.update as any) = mockUpdate;
    service = new HealthCheckService(mockDb as never, {} as never, {} as never);
  });

  describe("pauseConfiguration", () => {
    it("should update paused to true and set updatedAt", async () => {
      await service.pauseConfiguration("config-123");

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          paused: true,
          updatedAt: expect.any(Date),
        }),
      );
      expect(mockWhere).toHaveBeenCalled();
    });
  });

  describe("resumeConfiguration", () => {
    it("should update paused to false and set updatedAt", async () => {
      await service.resumeConfiguration("config-456");

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          paused: false,
          updatedAt: expect.any(Date),
        }),
      );
      expect(mockWhere).toHaveBeenCalled();
    });
  });
});
