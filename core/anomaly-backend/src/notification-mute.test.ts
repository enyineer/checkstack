import { describe, test, expect, mock } from "bun:test";
import { dispatchAnomalyNotification } from "./notification";

/**
 * The mute filter behaviour is the integration point that the per-field
 * opt-out feature hangs on. These tests exercise dispatchAnomalyNotification
 * end-to-end against an in-memory db mock that controls which userIds appear
 * as muted, since AnomalyService.getMutedUserIds is what the dispatcher
 * relies on. The other suites (detector / drift-evaluator) cover the
 * surrounding state-machine logic.
 */

function createMockCatalogClient() {
  return {
    getSystem: mock(async () => ({ name: "Production API" })),
  };
}

function createMockNotificationClient(subscriberIds: string[]) {
  // The new dispatch goes through notifyForSubscription. This mock
  // simulates the server-side resolution by emitting a synthetic
  // "userIds passed to notify" surface that tests assert on. Includes
  // simulated mute filtering since the dispatcher applies excludeUserIds.
  return {
    notifyForSubscription: mock(async (input: {
      excludeUserIds?: string[];
    }) => {
      const excluded = new Set(input.excludeUserIds ?? []);
      const recipients = subscriberIds.filter((id) => !excluded.has(id));
      return { notifiedCount: recipients.length, recipients };
    }),
  };
}

/**
 * Minimal Drizzle-shaped mock that only answers the one query
 * AnomalyService.getMutedUserIds issues. Returns the supplied muted ids.
 */
function createDbWithMutes(mutedUserIds: string[]) {
  const rows = mutedUserIds.map((userId) => ({ userId }));
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => Promise.resolve(rows)),
      })),
    })),
  };
}

const baseInput = {
  systemId: "sys-1",
  fieldPath: "collectors.http.request.responseTimeMs",
  observedValue: 250,
  baselineMean: 100,
  logger: { warn: mock(() => undefined), debug: mock(() => undefined) },
};

describe("dispatchAnomalyNotification — mute filtering", () => {
  test("notifies all subscribers when none have muted the field", async () => {
    const catalogClient = createMockCatalogClient();
    const notificationClient = createMockNotificationClient([
      "alice",
      "bob",
      "carol",
    ]);
    const db = createDbWithMutes([]);

    await dispatchAnomalyNotification({
      ...baseInput,
      action: "confirmed",
      catalogClient: catalogClient as never,
      notificationClient: notificationClient as never,
      db: db as never,
      logger: baseInput.logger as never,
    });

    expect(notificationClient.notifyForSubscription).toHaveBeenCalledTimes(1);
    const payload = (
      notificationClient.notifyForSubscription.mock.calls[0] as unknown[]
    )[0] as { excludeUserIds?: string[]; resourceKeys: string[] };
    expect(payload.excludeUserIds ?? []).toEqual([]);
    expect(payload.resourceKeys).toEqual(["sys-1"]);
  });

  test("excludes users who muted the specific field", async () => {
    const catalogClient = createMockCatalogClient();
    const notificationClient = createMockNotificationClient([
      "alice",
      "bob",
      "carol",
    ]);
    const db = createDbWithMutes(["bob"]);

    await dispatchAnomalyNotification({
      ...baseInput,
      action: "confirmed",
      catalogClient: catalogClient as never,
      notificationClient: notificationClient as never,
      db: db as never,
      logger: baseInput.logger as never,
    });

    expect(notificationClient.notifyForSubscription).toHaveBeenCalledTimes(1);
    const payload = (
      notificationClient.notifyForSubscription.mock.calls[0] as unknown[]
    )[0] as { excludeUserIds?: string[] };
    expect(payload.excludeUserIds ?? []).toEqual(["bob"]);
  });

  test("forwards every muted user as excludeUserIds", async () => {
    const catalogClient = createMockCatalogClient();
    const notificationClient = createMockNotificationClient(["alice", "bob"]);
    const db = createDbWithMutes(["alice", "bob"]);

    await dispatchAnomalyNotification({
      ...baseInput,
      action: "confirmed",
      catalogClient: catalogClient as never,
      notificationClient: notificationClient as never,
      db: db as never,
      logger: baseInput.logger as never,
    });

    expect(notificationClient.notifyForSubscription).toHaveBeenCalledTimes(1);
    const payload = (
      notificationClient.notifyForSubscription.mock.calls[0] as unknown[]
    )[0] as { excludeUserIds?: string[] };
    expect((payload.excludeUserIds ?? []).sort()).toEqual(["alice", "bob"]);
  });

  test("delegates dispatch even when there are no mutes — backend resolves subscribers", async () => {
    const catalogClient = createMockCatalogClient();
    const notificationClient = createMockNotificationClient([]);
    const db = createDbWithMutes([]);

    await dispatchAnomalyNotification({
      ...baseInput,
      action: "confirmed",
      catalogClient: catalogClient as never,
      notificationClient: notificationClient as never,
      db: db as never,
      logger: baseInput.logger as never,
    });

    // Anomaly always delegates to the backend now — subscriber-set
    // resolution happens server-side. The mock just needs to have been
    // invoked once with the right specId / resourceKeys.
    expect(notificationClient.notifyForSubscription).toHaveBeenCalledTimes(1);
    const payload = (
      notificationClient.notifyForSubscription.mock.calls[0] as unknown[]
    )[0] as { specId: string; resourceKeys: string[] };
    expect(payload.specId).toBe("anomaly.system");
    expect(payload.resourceKeys).toEqual(["sys-1"]);
  });
});
