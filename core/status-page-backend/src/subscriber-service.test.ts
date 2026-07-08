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
}
interface SubRow { email: string; unsubscribeToken: string }

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
    const n = await svc.notifyForSystems({ title: "t", body: "b", systemIds: ["sys-1"] });
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
    const n = await svc.notifyForSystems({ title: "t", body: "b", systemIds: ["sys-1"] });
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });
});
