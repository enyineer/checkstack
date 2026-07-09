import { describe, test, expect } from "bun:test";
import { z } from "zod";
import type { Logger, RpcClient, SafeDatabase } from "@checkstack/backend-api";
import type { SubscriptionCategory } from "@checkstack/status-page-common";
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
 * subscribers ONLY when one of the page's widgets OF THE NOTIFICATION'S OWN
 * CATEGORY currently surfaces an affected system, resolved through the widget's
 * own `resolveScopedSystems` (single source, the same expansion the widget
 * renders from). A system outside that live scope - or surfaced only by a widget
 * of a DIFFERENT category, or a change in an unpublished environment - must never
 * reach the page's subscribers.
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

/** The widget type id a category's widget registers under (drives the layout). */
function widgetTypeFor(category: SubscriptionCategory): string {
  return `statuspage.${category}`;
}

/**
 * A widget whose live scope is a fixed set, standing in for a category's widget
 * (incidents / maintenance / health). It declares its `subscriptionCategory`, so
 * the send-time fan-out only lets it surface a notification of that same
 * category.
 */
function scopedWidget(
  scope: string[],
  category: SubscriptionCategory = "incident",
): RegisteredWidgetType {
  return {
    id: category,
    qualifiedId: widgetTypeFor(category),
    ownerPluginId: "statuspage",
    displayName: category,
    description: "",
    category: "Status",
    binding: "systems",
    subscriptionCategory: category,
    configSchema: z.unknown(),
    dtoSchema: z.object({}),
    boundResources: () => [],
    resolvePublic: async () => ({}),
    resolveScopedSystems: async () => new Set(scope),
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

/**
 * A published, public, email-enabled page whose layout surfaces exactly the
 * given widgets (one block per widget, referencing its registered type). Defaults
 * to a single incidents widget block.
 */
const publishedPage = (
  widgets: RegisteredWidgetType[] = [scopedWidget([])],
  over: Partial<PageRow> = {},
): PageRow => ({
  id: "p1",
  slug: "acme",
  publishedLayout: widgets.map((w, i) => ({
    id: `b${i}`,
    type: w.qualifiedId,
    config: {},
  })),
  visibility: "public",
  emailSubscriptionsEnabled: true,
  ...over,
});

describe("SubscriberService.notifyForSystems (send-time scoping)", () => {
  test("does NOT email when the affected system is outside the page's live scope", async () => {
    const { mailer, sent } = recordingMailer();
    const widgets = [scopedWidget(["in-scope-sys"])]; // surfaces only this system
    const svc = makeService({
      pages: [publishedPage(widgets)],
      subsByPage: new Map([["p1", [{ email: "a@x.com", unsubscribeToken: "u1" }]]]),
      widgets,
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
    const widgets = [scopedWidget(["sys-1"])];
    const svc = makeService({
      pages: [publishedPage(widgets)],
      subsByPage: new Map([["p1", [{ email: "a@x.com", unsubscribeToken: "u1" }]]]),
      widgets,
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
    const widgets = [scopedWidget(["sys-1"])];
    const svc = makeService({
      pages: [publishedPage(widgets, { emailSubscriptionsEnabled: false })],
      subsByPage: new Map([["p1", [{ email: "a@x.com", unsubscribeToken: "u1" }]]]),
      widgets,
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
    const widgets = [scopedWidget(["sys-1"])];
    const svc = makeService({
      pages: [publishedPage(widgets, { visibility: "authenticated" })],
      subsByPage: new Map([["p1", [{ email: "a@x.com", unsubscribeToken: "u1" }]]]),
      widgets,
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

describe("SubscriberService.notifyForSystems (per-category widget scoping)", () => {
  test("a HEALTH change is NOT surfaced by a page that only has an INCIDENT widget", async () => {
    const { mailer, sent } = recordingMailer();
    // The page shows incidents for sys-1 but never its health. A health change
    // must not email even an all-category subscriber - the author did not choose
    // to display sys-1's health on this page.
    const widgets = [scopedWidget(["sys-1"], "incident")];
    const svc = makeService({
      pages: [publishedPage(widgets)],
      subsByPage: new Map([["p1", [{ email: "a@x.com", unsubscribeToken: "u1" }]]]),
      widgets,
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "Status change",
      body: "degraded",
      systemIds: ["sys-1"],
      sourcePluginId: "healthcheck",
    });
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });

  test("a HEALTH change IS surfaced by a page with a HEALTH widget showing the system", async () => {
    const { mailer, sent } = recordingMailer();
    const widgets = [scopedWidget(["sys-1"], "health")];
    const svc = makeService({
      pages: [publishedPage(widgets)],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", categories: ["health"] }]],
      ]),
      widgets,
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

  test("each category is surfaced only by its OWN widget on a mixed page", async () => {
    const { mailer, sent } = recordingMailer();
    // The page shows incidents for sys-A and health for sys-B (distinct systems).
    const widgets = [
      scopedWidget(["sys-A"], "incident"),
      scopedWidget(["sys-B"], "health"),
    ];
    const svc = makeService({
      pages: [publishedPage(widgets)],
      subsByPage: new Map([["p1", [{ email: "a@x.com", unsubscribeToken: "u1" }]]]),
      widgets,
      mailer,
    });
    // An incident on sys-B (only the HEALTH widget shows sys-B) is not surfaced.
    expect(
      await svc.notifyForSystems({
        title: "Incident",
        body: "down",
        systemIds: ["sys-B"],
        sourcePluginId: "incident",
      }),
    ).toBe(0);
    // A health change on sys-B (its health IS shown) is surfaced.
    expect(
      await svc.notifyForSystems({
        title: "Status change",
        body: "degraded",
        systemIds: ["sys-B"],
        sourcePluginId: "healthcheck",
      }),
    ).toBe(1);
    expect(sent).toEqual(["a@x.com"]);
  });
});

describe("SubscriberService.notifyForSystems (category + system scope)", () => {
  test("a category-scoped subscriber does NOT get an out-of-category event", async () => {
    const { mailer, sent } = recordingMailer();
    // The page surfaces sys-1 via BOTH incident and maintenance widgets, so the
    // maintenance event passes the page gate and the SUBSCRIBER category filter
    // is what excludes the incident-only subscriber.
    const widgets = [
      scopedWidget(["sys-1"], "incident"),
      scopedWidget(["sys-1"], "maintenance"),
    ];
    const svc = makeService({
      pages: [publishedPage(widgets)],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", categories: ["incident"] }]],
      ]),
      widgets,
      mailer,
    });
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
    const widgets = [scopedWidget(["sys-1"])];
    const svc = makeService({
      pages: [publishedPage(widgets)],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", categories: ["incident"] }]],
      ]),
      widgets,
      mailer,
    });
    // An uncategorized source (anomaly -> category null) falls back to every
    // scoping widget for the page gate, but reaches only legacy (NULL-categories)
    // subscribers - never a category-scoped one.
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
    // The subscriber scoped to sys-B, but the page's widget now surfaces only
    // sys-A (sys-B was removed from the layout).
    const widgets = [scopedWidget(["sys-A"])];
    const svc = makeService({
      pages: [publishedPage(widgets)],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", systemIds: ["sys-B"] }]],
      ]),
      widgets,
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
    const widgets = [scopedWidget(["sys-1"])];
    const svc = makeService({
      pages: [publishedPage(widgets)],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", categories: ["incident"] }]],
      ]),
      widgets,
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
    const widgets = [scopedWidget(["sys-1"], "health")];
    const svc = makeService({
      pages: [publishedPage(widgets)],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", categories: ["health"] }]],
      ]),
      widgets,
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
    const widgets = [scopedWidget(["sys-A", "sys-B"])];
    const svc = makeService({
      pages: [publishedPage(widgets)],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", systemIds: ["sys-A"] }]],
      ]),
      widgets,
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
    const widgets = [scopedWidget(["sys-A", "sys-B"])];
    const svc = makeService({
      pages: [publishedPage(widgets)],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", systemIds: ["sys-A"] }]],
      ]),
      widgets,
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
    // Both an incident and a maintenance widget surface sys-A/sys-B, so each
    // event category passes the page gate and the SUBSCRIBER filters decide.
    const widgets = [
      scopedWidget(["sys-A", "sys-B"], "incident"),
      scopedWidget(["sys-A", "sys-B"], "maintenance"),
    ];
    const svc = makeService({
      pages: [publishedPage(widgets)],
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
      widgets,
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
    // The page surfaces sys-A for every category, so a legacy "everything"
    // subscriber receives each source (and an uncategorized one via the null
    // category fallback).
    const widgets = [
      scopedWidget(["sys-A"], "incident"),
      scopedWidget(["sys-A"], "maintenance"),
      scopedWidget(["sys-A"], "health"),
    ];
    const svc = makeService({
      pages: [publishedPage(widgets)],
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
      widgets,
      mailer,
    });
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
 * the real incident/maintenance/health widgets do. Proves the fan-out threads
 * each page's env scope into the scope resolver, so a page publishing prod never
 * emails about a staging-only system.
 */
function envAwareWidget(args: {
  bound: string[];
  envSystems: Record<string, string[]>;
  category?: SubscriptionCategory;
}): RegisteredWidgetType {
  return {
    ...scopedWidget([], args.category ?? "incident"),
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
      pages: [publishedPage(widgets, { publishedEnvironmentIds: ["prod"] })],
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
      pages: [publishedPage(widgets, { publishedEnvironmentIds: ["prod"] })],
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
      pages: [publishedPage(widgets, { publishedEnvironmentIds: null })],
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

/**
 * ORIGIN-ENVIRONMENT gate: a per-environment health transition carries the
 * environment it happened in (`originEnvironmentId`). A page that publishes a
 * SPECIFIC environment set must be skipped for a change in an environment it does
 * not publish - even when the affected system is otherwise surfaced (it belongs
 * to a published environment too). This is the "a development failure must not
 * page prod-only subscribers" boundary.
 */
describe("SubscriberService.notifyForSystems (origin-environment gate)", () => {
  // The system is visible under BOTH prod and dev, and shown via a HEALTH widget,
  // so surfacing is never the reason a change is dropped - only the origin gate.
  const envSystems = { prod: ["sys"], dev: ["sys"] };
  const widgets = [
    envAwareWidget({ bound: ["sys"], envSystems, category: "health" }),
  ];

  test("a prod-only page does NOT email about a change that happened in dev", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage(widgets, { publishedEnvironmentIds: ["prod"] })],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", categories: ["health"] }]],
      ]),
      widgets,
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "Status change",
      body: "degraded",
      systemIds: ["sys"],
      sourcePluginId: "healthcheck",
      originEnvironmentId: "dev",
    });
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });

  test("a prod-only page DOES email about a change that happened in prod", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage(widgets, { publishedEnvironmentIds: ["prod"] })],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", categories: ["health"] }]],
      ]),
      widgets,
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "Status change",
      body: "degraded",
      systemIds: ["sys"],
      sourcePluginId: "healthcheck",
      originEnvironmentId: "prod",
    });
    expect(n).toBe(1);
    expect(sent).toEqual(["a@x.com"]);
  });

  test("an all-environments page emails about a change in any environment", async () => {
    const { mailer, sent } = recordingMailer();
    const svc = makeService({
      pages: [publishedPage(widgets, { publishedEnvironmentIds: null })],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", categories: ["health"] }]],
      ]),
      widgets,
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "Status change",
      body: "degraded",
      systemIds: ["sys"],
      sourcePluginId: "healthcheck",
      originEnvironmentId: "dev",
    });
    expect(n).toBe(1);
    expect(sent).toEqual(["a@x.com"]);
  });

  test("an env-less health notification (system rollup) reaches a prod-only page", async () => {
    const { mailer, sent } = recordingMailer();
    // No originEnvironmentId (the catastrophic/system-rollup path): the origin
    // gate does not apply, so it delivers as long as the system is surfaced.
    const svc = makeService({
      pages: [publishedPage(widgets, { publishedEnvironmentIds: ["prod"] })],
      subsByPage: new Map([
        ["p1", [{ email: "a@x.com", unsubscribeToken: "u1", categories: ["health"] }]],
      ]),
      widgets,
      mailer,
    });
    const n = await svc.notifyForSystems({
      title: "Status change",
      body: "degraded",
      systemIds: ["sys"],
      sourcePluginId: "healthcheck",
    });
    expect(n).toBe(1);
    expect(sent).toEqual(["a@x.com"]);
  });
});
