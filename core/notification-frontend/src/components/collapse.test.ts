import { describe, test, expect } from "bun:test";
import type { Notification } from "@checkstack/notification-common";
import { groupByCollapseKey } from "./collapse";

function notification(
  over: Partial<Notification> & { id: string },
): Notification {
  return {
    id: over.id,
    userId: over.userId ?? "u1",
    title: over.title ?? "Title",
    body: over.body ?? "Body",
    action: over.action,
    importance: over.importance ?? "info",
    isRead: over.isRead ?? false,
    collapseKey: over.collapseKey,
    subjects: over.subjects,
    createdAt: over.createdAt ?? new Date("2026-06-01T00:00:00Z"),
  };
}

describe("groupByCollapseKey", () => {
  test("keeps keyless notifications as separate singletons", () => {
    const groups = groupByCollapseKey([
      notification({ id: "a" }),
      notification({ id: "b" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => !g.collapsed && g.count === 1)).toBe(true);
    expect(groups.map((g) => g.representative.id)).toEqual(["a", "b"]);
  });

  test("collapses notifications that share a collapseKey into one group", () => {
    const groups = groupByCollapseKey([
      notification({ id: "a", collapseKey: "incident.1" }),
      notification({ id: "b", collapseKey: "incident.1" }),
      notification({ id: "c", collapseKey: "incident.1" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].collapsed).toBe(true);
    expect(groups[0].count).toBe(3);
    expect(groups[0].notifications).toHaveLength(3);
  });

  test("the representative is the newest notification in the group", () => {
    const groups = groupByCollapseKey([
      notification({
        id: "old",
        collapseKey: "k",
        createdAt: new Date("2026-06-01T00:00:00Z"),
      }),
      notification({
        id: "new",
        collapseKey: "k",
        createdAt: new Date("2026-06-03T00:00:00Z"),
      }),
      notification({
        id: "mid",
        collapseKey: "k",
        createdAt: new Date("2026-06-02T00:00:00Z"),
      }),
    ]);
    expect(groups[0].representative.id).toBe("new");
    // notifications are sorted newest-first within the group.
    expect(groups[0].notifications.map((n) => n.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  test("group order follows first appearance in the input", () => {
    const groups = groupByCollapseKey([
      notification({ id: "x1", collapseKey: "x" }),
      notification({ id: "y1", collapseKey: "y" }),
      notification({ id: "x2", collapseKey: "x" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["x", "y"]);
  });

  test("the group key is the collapseKey, or a namespaced id for keyless rows", () => {
    const groups = groupByCollapseKey([
      notification({ id: "a", collapseKey: "incident.1" }),
      notification({ id: "b" }),
    ]);
    expect(groups[0].key).toBe("incident.1");
    expect(groups[1].key).toBe("__nokey:b");
  });

  test("empty input yields no groups", () => {
    expect(groupByCollapseKey([])).toEqual([]);
  });
});
