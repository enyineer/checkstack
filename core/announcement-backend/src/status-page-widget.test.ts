import { describe, test, expect } from "bun:test";
import type { RpcClient } from "@checkstack/backend-api";
import type {
  WidgetResolveContext,
  WidgetTypeDefinition,
} from "@checkstack/status-page-backend";
import { registerAnnouncementStatusWidgets } from "./status-page-widget";

function capture(): WidgetTypeDefinition {
  let captured: WidgetTypeDefinition | undefined;
  registerAnnouncementStatusWidgets({
    registerWidgetType: (def) => {
      captured = def;
    },
  });
  if (!captured) throw new Error("no widget registered");
  return captured;
}

const now = new Date("2026-07-08T10:00:00.000Z");

/** A trusted client returning a mix of public + authenticated announcements. */
function ctxWith(
  announcements: Array<Record<string, unknown>>,
): WidgetResolveContext {
  return {
    rpcClient: {
      forPlugin: () => ({
        getActiveAnnouncements: async () => ({ announcements }),
      }),
    } as unknown as RpcClient,
    cache: async (_key, loader) => loader(),
  };
}

describe("announcements widget resolver", () => {
  test("filters to visibility 'all' and strips internal fields", async () => {
    const widget = capture();
    const result = (await widget.resolvePublic({
      config: { limit: 5 },
      ctx: ctxWith([
        {
          id: "a1",
          title: "Public notice",
          message: "hello",
          severity: "info",
          visibility: "all",
          displayMode: "banner",
          active: true,
          createdBy: "user-1",
          startsAt: now,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "a2",
          title: "Internal only",
          message: "secret",
          severity: "warning",
          visibility: "authenticated",
          displayMode: "dashboard",
          active: true,
          createdBy: "user-2",
          createdAt: now,
          updatedAt: now,
        },
      ]),
    })) as { announcements: Array<Record<string, unknown>> };

    expect(result.announcements).toHaveLength(1);
    const item = result.announcements[0];
    expect(item.title).toBe("Public notice");
    // No internal fields leak into the public DTO.
    expect(item).not.toHaveProperty("id");
    expect(item).not.toHaveProperty("createdBy");
    expect(item).not.toHaveProperty("visibility");
    expect(item).not.toHaveProperty("displayMode");
    // No status enum (must not roll into the page rollup).
    expect(item).not.toHaveProperty("status");
  });

  test("caps to the configured limit", async () => {
    const widget = capture();
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`,
      title: `n${i}`,
      message: "m",
      severity: "info",
      visibility: "all",
      displayMode: "banner",
      active: true,
      createdBy: "u",
      createdAt: now,
      updatedAt: now,
    }));
    const result = (await widget.resolvePublic({
      config: { limit: 3 },
      ctx: ctxWith(many),
    })) as { announcements: unknown[] };
    expect(result.announcements).toHaveLength(3);
  });

  test("binds no resources (instance-wide)", () => {
    expect(capture().boundResources({ limit: 5 })).toEqual([]);
  });
});
