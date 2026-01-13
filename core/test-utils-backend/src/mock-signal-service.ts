import { qualifyAccessRuleId } from "@checkstack/common";
import type { SignalService, Signal } from "@checkstack/signal-common";

/**
 * Recorded signal emission for testing assertions.
 */
export interface RecordedSignal<T = unknown> {
  signal: Signal<T>;
  payload: T;
  targetType: "broadcast" | "user" | "users" | "authorized";
  userIds?: string[];
  accessRule?: string; // For authorized signals
  timestamp: Date;
}

/**
 * Mock SignalService for testing with recording and assertion capabilities.
 */
export interface MockSignalService extends SignalService {
  /**
   * Get all recorded signal emissions.
   */
  getRecordedSignals(): RecordedSignal[];

  /**
   * Get recorded signals filtered by signal ID.
   */
  getRecordedSignalsById(signalId: string): RecordedSignal[];

  /**
   * Get recorded signals sent to a specific user.
   */
  getRecordedSignalsForUser(userId: string): RecordedSignal[];

  /**
   * Clear all recorded signals.
   */
  clearRecordedSignals(): void;

  /**
   * Check if a specific signal was emitted.
   */
  wasSignalEmitted(signalId: string): boolean;

  /**
   * Check if a specific signal was sent to a user.
   */
  wasSignalSentToUser(signalId: string, userId: string): boolean;

  /**
   * Set a access filter function for sendToAuthorizedUsers testing.
   * If not set, sendToAuthorizedUsers will pass through all users.
   */
  setAccessFilter(
    filter: (userIds: string[], accessRule: string) => string[]
  ): void;
}

/**
 * Creates a mock SignalService for testing.
 * Records all signal emissions for later assertions.
 *
 * @returns A mock SignalService with recording capabilities
 *
 * @example
 * ```typescript
 * import { createMockSignalService } from "@checkstack/test-utils-backend";
 * import { NOTIFICATION_RECEIVED } from "@checkstack/notification-common";
 *
 * const mockSignalService = createMockSignalService();
 *
 * // In your code under test
 * await mockSignalService.sendToUser(NOTIFICATION_RECEIVED, "user-123", { ... });
 *
 * // Assertions
 * expect(mockSignalService.wasSignalSentToUser("notification.received", "user-123")).toBe(true);
 * expect(mockSignalService.getRecordedSignalsForUser("user-123")).toHaveLength(1);
 * ```
 */
export function createMockSignalService(): MockSignalService {
  const recordedSignals: RecordedSignal[] = [];
  let accessFilter:
    | ((userIds: string[], accessRule: string) => string[])
    | undefined;

  return {
    async broadcast<T>(signal: Signal<T>, payload: T): Promise<void> {
      recordedSignals.push({
        signal: signal as Signal<unknown>,
        payload,
        targetType: "broadcast",
        timestamp: new Date(),
      });
    },

    async sendToUser<T>(
      signal: Signal<T>,
      userId: string,
      payload: T
    ): Promise<void> {
      recordedSignals.push({
        signal: signal as Signal<unknown>,
        payload,
        targetType: "user",
        userIds: [userId],
        timestamp: new Date(),
      });
    },

    async sendToUsers<T>(
      signal: Signal<T>,
      userIds: string[],
      payload: T
    ): Promise<void> {
      recordedSignals.push({
        signal: signal as Signal<unknown>,
        payload,
        targetType: "users",
        userIds,
        timestamp: new Date(),
      });
    },

    getRecordedSignals(): RecordedSignal[] {
      return [...recordedSignals];
    },

    getRecordedSignalsById(signalId: string): RecordedSignal[] {
      return recordedSignals.filter((r) => r.signal.id === signalId);
    },

    getRecordedSignalsForUser(userId: string): RecordedSignal[] {
      return recordedSignals.filter(
        (r) =>
          r.targetType === "broadcast" ||
          (r.userIds && r.userIds.includes(userId))
      );
    },

    clearRecordedSignals(): void {
      recordedSignals.length = 0;
    },

    wasSignalEmitted(signalId: string): boolean {
      return recordedSignals.some((r) => r.signal.id === signalId);
    },

    wasSignalSentToUser(signalId: string, userId: string): boolean {
      return recordedSignals.some(
        (r) =>
          r.signal.id === signalId && r.userIds && r.userIds.includes(userId)
      );
    },

    async sendToAuthorizedUsers<T>(
      signal: Signal<T>,
      userIds: string[],
      payload: T,
      pluginMetadata: { pluginId: string },
      accessRule: { id: string }
    ): Promise<void> {
      // Construct fully-qualified access rule ID
      const qualifiedAccessRule = qualifyAccessRuleId(
        pluginMetadata,
        accessRule
      );

      // Apply access filter if set
      const filteredUserIds = accessFilter
        ? accessFilter(userIds, qualifiedAccessRule)
        : userIds;

      recordedSignals.push({
        signal: signal as Signal<unknown>,
        payload,
        targetType: "authorized",
        userIds: filteredUserIds,
        accessRule: qualifiedAccessRule,
        timestamp: new Date(),
      });
    },

    setAccessFilter(
      filter: (userIds: string[], accessRule: string) => string[]
    ): void {
      accessFilter = filter;
    },
  };
}
