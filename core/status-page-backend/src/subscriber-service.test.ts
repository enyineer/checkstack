import { describe, test, expect } from "bun:test";
import { z } from "zod";
import type { Logger, RpcClient, SafeDatabase } from "@checkstack/backend-api";
import { SubscriberService } from "./subscriber-service";
import type { SubscriberMailer } from "./subscriber-mailer";
import type {
  RegisteredWidgetType,
  WidgetTypeRegistry,
  WidgetResolveContext,
} from "./widget-registry";
import * as schema from "./schema";
import { statusPages, statusPageSubscribers } from "./schema";

/**
 * SEND-TIME SCOPING regression: `notifyForSystems` must email a page's
 * subscribers ONLY when one of the page's event-feed widgets CURRENTLY surfaces
 * an affected system, resolved through the widget's own `resolveScopedSystems`
 * (single source, the same expansion the widget renders from). A system outside
 * that live scope must never reach the page's subscribers.
 */

interface PageRow {
  id: string;
  slug: string;
  publishedLayout: Array<{ id: string; type: string; config: unknown }> | null;
  visibility: string;
  emailSubscriptionsEnabled: boolean;
  /** Published environment scope; null/absent = all environments. */
  publishedEnvironmentIds?: string[] | null;
}
interface SubRow {
  email: string;
  unsubscribeToken: string;
  /** null/undefined = legacy "every category"; a list restricts to those. */
  categories?: string[] | null;
  /** null/undefined/empty = all systems; a list restricts to those. */
  systemIds?: string[] | null;
}

/** Fake db that answers the two selects notifyForSystems issues, by table. */
function fakeDb({
  pages,
  subsByPage,
}: {
  pages: PageRow[];
  subsByPage: Map<string, SubRow[]>;
}): SafeDatabase<typeof schema> {
  return {
    select: () => ({
      from: (table: unknown) => {
        if (table === statusPages) {
          // pages query is awaited straight off `.from()`.
          return Promise.resolve(pages);
        }
        if (table === statusPageSubscribers) {
          // subscribers: `.from().where(...)` — capture the page id from the
          // last equality by returning a where() that inspects nothing and
          // yields ALL rows; the test uses a single page per scenario so the
          // map has one entry.
          return {
            where: () =>
              Promise.resolve([...subsByPage.values()].flat()),
          };
        }
        throw new Error("unexpected table");
      },
    }),
  } as unknown as SafeDatabase<typeof schema>;
}

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

const noRpc: RpcClient = { forPlugin: () => ({}) as never };

/** A widget whose live scope is a fixed set, standing in for incidents/maintenance. */
function scopedWidget(scope: string[]): RegisteredWidgetType {
  return {
    id: "incidents",
    qualifiedId: "statuspage.incidents",
    ownerPluginId: "statuspage",
    displayName: "Incidents",
    description: "",
    category: "Events",
    binding: "systems",
    configSchema: z.unknown(),
    dtoSchema: z.object({}),
    boundResources: () => [],
    resolvePublic: async () => ({}),
    resolveScopedSystems: async (_args: {
      config: unknown;
      ctx: WidgetResolveContext;
    }) => new Set(scope),
  };
}

function registryOf(widgets: RegisteredWidgetType[]): WidgetTypeRegistry {
  const map = new Map(widgets.map((w) => [w.qualifiedId, w]));
  return { register: () => {}, get: (id) => map.get(id), list: () => [...map.values()] };
}

function recordingMailer(): { mailer: SubscriberMailer; sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    mailer: { sendRaw: async ({ to }) => { sent.push(to); } },
  };
}

function makeService({
  pages,
  subsByPage,
  widgets,
  mailer,
}: {
  pages: PageRow[];
  subsByPage: Map<string, SubRow[]>;
  widgets: RegisteredWidgetType[];
  mailer: SubscriberMailer;
}): SubscriberService {
  return new SubscriberService({
    db: fakeDb({ pages, subsByPage }),
    logger: noopLogger,
    mailer,
    baseUrl: "https://status.example.com",
    registry: registryOf(widgets),
    rpcClient: noRpc,
  });
}

const publishedPage = (over: Partial<PageRow> = {}): PageRow => ({
  id: "p1",
  slug: "acme",
  publishedLayout: [
    { id: "b1", type: "statuspage.incidents", config: {} },
  ],
  visibility: "public",
  emailSubscriptionsEnabled: true,
  ...over,
});

describe("SubscriberService.notifyForSystems (send-time scoping)", () => {
  test("does NOT email when the affected system is outside the page's live scope", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage()],
      subsByPage: new Map([["p1", [{ email: "a@x.com", unsubscribeToken: "u1" }]]]),
      widgets: [scopedWidget(["in-scope-sys"])], // widget surfaces only this system
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "Incident",
      body: "down",
      systemIds: ["OTHER-sys"], // not in the widget's scope
      sourcePluginId: "incident",
    });
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });

  test("emails verified subscribers when an affected system IS in the live scope", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage()],
      subsByPage: new Map([["p1", [{ email: "a@x.com", unsubscribeToken: "u1" }]]]),
      widgets: [scopedWidget(["sys-1"])],
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "Incident",
      body: "down",
      systemIds: ["sys-1"],
      sourcePluginId: "incident",
    });
    expect(n).toBe(1);
    expect(sent).toEqual(["a@x.com"]);
  });

  test("never emails a page that disabled email subscriptions, even if in scope", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage({ emailSubscriptionsEnabled: false })],
      subsByPage: new Map([["p1", [{ email: "a@x.com", unsubscribeToken: "u1" }]]]),
      widgets: [scopedWidget(["sys-1"])],
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "t",
      body: "b",
      systemIds: ["sys-1"],
      sourcePluginId: "incident",
    });
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });

  test("never emails a non-public page", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage({ visibility: "authenticated" })],
      subsByPage: new Map([["p1", [{ email: "a@x.com", unsubscribeToken: "u1" }]]]),
      widgets: [scopedWidget(["sys-1"])],
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "t",
      body: "b",
      systemIds: ["sys-1"],
      sourcePluginId: "incident",
    });
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });
});

describe("SubscriberService.notifyForSystems (category + system scope)", () => {
  test("a category-scoped subscriber does NOT get an out-of-category event", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage()],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", categories: ["incident"] }]],
      ]),
      widgets: [scopedWidget(["sys-1"])],
      mailer,
    });
    // A maintenance notification must not reach an incident-only subscriber.
    const n = await svc.notifyForSystems({
      title: "Maintenance",
      body: "window",
      systemIds: ["sys-1"],
      sourcePluginId: "maintenance",
    });
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });

  test("a category-scoped subscriber gets NOTHING for an uncategorized source", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage()],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", categories: ["incident"] }]],
      ]),
      widgets: [scopedWidget(["sys-1"])],
      mailer,
    });
    // An uncategorized source (anomaly -> category null) reaches only legacy
    // (NULL-categories) subscribers, never a category-scoped one.
    const n = await svc.notifyForSystems({
      title: "Anomaly",
      body: "spike",
      systemIds: ["sys-1"],
      sourcePluginId: "anomaly",
    });
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });

  test("a system-scoped subscriber is NOT emailed about a system the page no longer surfaces", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage()],
      // The subscriber scoped to sys-B, but the page's widget now surfaces only
      // sys-A (sys-B was removed from the layout).
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", systemIds: ["sys-B"] }]],
      ]),
      widgets: [scopedWidget(["sys-A"])],
      mailer,
    });
    // The event affects both A and B; the page gate passes on A (surfaced), but
    // the subscriber's [B] must be matched against affected ∩ surfaced = {A}, so
    // they are NOT emailed about their now-hidden system.
    const n = await svc.notifyForSystems({
      title: "Incident",
      body: "down",
      systemIds: ["sys-A", "sys-B"],
      sourcePluginId: "incident",
    });
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });

  test("a category-scoped subscriber DOES get an in-category event", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage()],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", categories: ["incident"] }]],
      ]),
      widgets: [scopedWidget(["sys-1"])],
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "Incident",
      body: "down",
      systemIds: ["sys-1"],
      sourcePluginId: "incident",
    });
    expect(n).toBe(1);
    expect(sent).toEqual(["a@x.com"]);
  });

  test("healthcheck source maps to the 'health' category", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage()],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", categories: ["health"] }]],
      ]),
      widgets: [scopedWidget(["sys-1"])],
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "Status change",
      body: "degraded",
      systemIds: ["sys-1"],
      sourcePluginId: "healthcheck",
    });
    expect(n).toBe(1);
    expect(sent).toEqual(["a@x.com"]);
  });

  test("a system-scoped subscriber does NOT get an event for a different system", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage()],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", systemIds: ["sys-A"] }]],
      ]),
      // The page surfaces both systems, but the subscriber restricted to A.
      widgets: [scopedWidget(["sys-A", "sys-B"])],
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "Incident",
      body: "down",
      systemIds: ["sys-B"],
      sourcePluginId: "incident",
    });
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });

  test("a system-scoped subscriber DOES get an event intersecting its systems", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage()],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", systemIds: ["sys-A"] }]],
      ]),
      widgets: [scopedWidget(["sys-A", "sys-B"])],
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "Incident",
      body: "down",
      systemIds: ["sys-A", "sys-B"],
      sourcePluginId: "incident",
    });
    expect(n).toBe(1);
    expect(sent).toEqual(["a@x.com"]);
  });

  test("combined category + system filter: both must match", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage()],
      subsByPage: new Map([
        [
          "p1",
          [
            {
              email: "a@x.com",
              unsubscribeToken: "u1",
              categories: ["incident"],
              systemIds: ["sys-A"],
            },
          ],
        ],
      ]),
      widgets: [scopedWidget(["sys-A", "sys-B"])],
      mailer,
    });
    // Right category, wrong system -> no email.
    expect(
      await svc.notifyForSystems({
        title: "Incident",
        body: "down",
        systemIds: ["sys-B"],
        sourcePluginId: "incident",
      }),
    ).toBe(0);
    // Right system, wrong category -> no email.
    expect(
      await svc.notifyForSystems({
        title: "Maintenance",
        body: "window",
        systemIds: ["sys-A"],
        sourcePluginId: "maintenance",
      }),
    ).toBe(0);
    // Both match -> email.
    expect(
      await svc.notifyForSystems({
        title: "Incident",
        body: "down",
        systemIds: ["sys-A"],
        sourcePluginId: "incident",
      }),
    ).toBe(1);
    expect(sent).toEqual(["a@x.com"]);
  });

  test("a legacy subscriber (NULL categories AND NULL systemIds) still gets everything", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage()],
      subsByPage: new Map([
        [
          "p1",
          [
            {
              email: "legacy@x.com",
              unsubscribeToken: "u1",
              categories: null,
              systemIds: null,
            },
          ],
        ],
      ]),
      widgets: [scopedWidget(["sys-A"])],
      mailer,
    });
    // Every category reaches the legacy subscriber, including an uncategorized
    // source and one it never explicitly opted into.
    for (const sourcePluginId of ["incident", "maintenance", "healthcheck", "anomaly"]) {
      expect(
        await svc.notifyForSystems({
          title: "t",
          body: "b",
          systemIds: ["sys-A"],
          sourcePluginId,
        }),
      ).toBe(1);
    }
    expect(sent).toEqual([
      "legacy@x.com",
      "legacy@x.com",
      "legacy@x.com",
      "legacy@x.com",
    ]);
  });
});

/**
 * A widget whose live scope is env-aware: it intersects its bound systems with
 * the systems visible under the page's `ctx.publishedEnvironmentIds`, exactly as
 * the real incident/maintenance widgets do. Proves the fan-out threads each
 * page's env scope into the scope resolver, so a page publishing prod never
 * emails about a staging-only system.
 */
function envAwareWidget(args: {
  bound: string[];
  envSystems: Record<string, string[]>;
}): RegisteredWidgetType {
  return {
    ...scopedWidget([]),
    resolveScopedSystems: async ({ ctx }: { ctx: WidgetResolveContext }) => {
      const envIds = ctx.publishedEnvironmentIds;
      if (!envIds || envIds.length === 0) return new Set(args.bound);
      const visible = new Set<string>();
      for (const e of envIds) for (const s of args.envSystems[e] ?? []) visible.add(s);
      return new Set(args.bound.filter((id) => visible.has(id)));
    },
  };
}

describe("SubscriberService.notifyForSystems (environment scope)", () => {
  const envSystems = { prod: ["prod-sys"], stage: ["stage-sys"] };
  const widgets = [envAwareWidget({ bound: ["prod-sys", "stage-sys"], envSystems })];

  test("a prod-only page does NOT email about a staging-only system", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage({ publishedEnvironmentIds: ["prod"] })],
      subsByPage: new Map([["p1", [{ email: "a@x.com", unsubscribeToken: "u1" }]]]),
      widgets,
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "Incident",
      body: "down",
      systemIds: ["stage-sys"],
      sourcePluginId: "incident",
    });
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });

  test("a prod-only page DOES email about a prod system", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage({ publishedEnvironmentIds: ["prod"] })],
      subsByPage: new Map([["p1", [{ email: "a@x.com", unsubscribeToken: "u1" }]]]),
      widgets,
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "Incident",
      body: "down",
      systemIds: ["prod-sys"],
      sourcePluginId: "incident",
    });
    expect(n).toBe(1);
    expect(sent).toEqual(["a@x.com"]);
  });

  test("an all-environments page (null scope) emails about any surfaced system", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage({ publishedEnvironmentIds: null })],
      subsByPage: new Map([["p1", [{ email: "a@x.com", unsubscribeToken: "u1" }]]]),
      widgets,
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "Incident",
      body: "down",
      systemIds: ["stage-sys"],
      sourcePluginId: "incident",
    });
    expect(n).toBe(1);
    expect(sent).toEqual(["a@x.com"]);
  });
});
