/**
 * Integration tests for status-page subscriber flows against a REAL Postgres:
 * reconcile-on-deletion, the per-page hourly quota, and the email-verification
 * model (per-page opt-out + the platform-global verified-email registry).
 *
 * Gated on CHECKSTACK_IT so it runs in CI (shared compose Postgres) and is
 * skipped in the default `bun test` run, matching the other *.it.test.ts here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import { DEFAULT_EMAIL_SUBSCRIBERS_HOURLY_QUOTA } from "@checkstack/status-page-common";
import * as schema from "./schema";
import { SubscriberService } from "./subscriber-service";
import type { SubscriberMailer } from "./subscriber-mailer";
import type {
  RegisteredWidgetType,
  WidgetTypeRegistry,
} from "./widget-registry";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";
const SCHEMA = "status_page_it_subscribers";

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

interface SentEmail {
  to: string;
  subject: string;
  body: string;
  unsubscribeUrl: string;
}
// Capturing mailer so tests can assert which emails (verification vs courtesy vs
// none) were sent. Reset in beforeEach.
const sentEmails: SentEmail[] = [];
const capturingMailer: SubscriberMailer = {
  sendRaw: async (m) => {
    sentEmails.push(m);
  },
};

let admin: Pool;
let pool: Pool;
let db: SafeDatabase<typeof schema>;
let service: SubscriberService;

const inertRegistry: WidgetTypeRegistry = {
  register: () => {},
  get: () => undefined,
  list: () => [],
};

/** A widget whose live scope is a fixed set, standing in for the event feeds. */
function scopeRegistry(scope: string[]): WidgetTypeRegistry {
  const widget: RegisteredWidgetType = {
    id: "feed",
    qualifiedId: "test.feed",
    ownerPluginId: "test",
    displayName: "Feed",
    description: "",
    category: "Events",
    // Stands in for an incident event feed: the fan-out per-category gate only
    // surfaces a widget whose subscriptionCategory matches the notification's
    // source category, and the sole notifyForSystems test fans out an incident.
    subscriptionCategory: "incident",
    binding: "systems",
    configSchema: z.unknown(),
    dtoSchema: z.object({}),
    boundResources: () => [],
    resolvePublic: async () => ({}),
    resolveScopedSystems: async () => new Set(scope),
  };
  const map = new Map([[widget.qualifiedId, widget]]);
  return {
    register: () => {},
    get: (id) => map.get(id),
    list: () => [...map.values()],
  };
}

function makeService(registry: WidgetTypeRegistry): SubscriberService {
  return new SubscriberService({
    db,
    logger: noopLogger,
    mailer: capturingMailer,
    baseUrl: "https://example.com",
    registry,
    rpcClient: { forPlugin: () => ({}) as never },
  });
}

async function insertPage(
  id: string,
  opts: {
    enabled?: boolean;
    quota?: number | null;
    verificationRequired?: boolean;
    publishedLayout?: unknown[];
  } = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".status_pages
       (id, slug, title, email_subscriptions_enabled, email_subscribers_hourly_quota,
        email_verification_required, published_layout)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      id,
      `slug-${id}`,
      `Page ${id}`,
      opts.enabled ?? false,
      opts.quota ?? null,
      opts.verificationRequired ?? true,
      opts.publishedLayout ? JSON.stringify(opts.publishedLayout) : null,
    ],
  );
}

async function insertSubscriber(row: {
  id: string;
  pageId: string;
  email: string;
  verified?: boolean;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".status_page_subscribers
       (id, status_page_id, email, unsubscribe_token, verified)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.id, row.pageId, row.email, `unsub-${row.id}`, row.verified ?? true],
  );
}

async function seedGlobalVerified(email: string): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".status_page_verified_emails (id, email) VALUES ($1, $2)`,
    [`gv-${email}`, email],
  );
}

async function getSubscriber(
  pageId: string,
  email: string,
): Promise<
  | {
      verified: boolean;
      verificationToken: string | null;
      categories: string[] | null;
      systemIds: string[] | null;
    }
  | undefined
> {
  const res = await pool.query(
    `SELECT verified, verification_token, categories, system_ids
       FROM "${SCHEMA}".status_page_subscribers
       WHERE status_page_id = $1 AND email = $2`,
    [pageId, email],
  );
  const row = res.rows[0];
  if (!row) return undefined;
  return {
    verified: row.verified,
    verificationToken: row.verification_token,
    categories: row.categories,
    systemIds: row.system_ids,
  };
}

async function subscriberCount(pageId: string): Promise<number> {
  const res = await pool.query(
    `SELECT count(*)::int AS n FROM "${SCHEMA}".status_page_subscribers WHERE status_page_id = $1`,
    [pageId],
  );
  return res.rows[0]?.n ?? 0;
}

async function globalVerifiedCount(email: string): Promise<number> {
  const res = await pool.query(
    `SELECT count(*)::int AS n FROM "${SCHEMA}".status_page_verified_emails WHERE email = $1`,
    [email],
  );
  return res.rows[0]?.n ?? 0;
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "status-page subscriber service (shared Postgres)",
  () => {
    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      await admin.query(
        `CREATE TABLE "${SCHEMA}".status_pages (
           id text PRIMARY KEY,
           slug text NOT NULL,
           title text NOT NULL,
           visibility text NOT NULL DEFAULT 'public',
           published_layout jsonb,
           email_subscriptions_enabled boolean NOT NULL DEFAULT false,
           email_subscribers_hourly_quota integer,
           email_verification_required boolean NOT NULL DEFAULT true,
           published_environment_ids text[],
           created_at timestamp NOT NULL DEFAULT now(),
           updated_at timestamp NOT NULL DEFAULT now()
         )`,
      );
      await admin.query(
        `CREATE TABLE "${SCHEMA}".status_page_subscribers (
           id text PRIMARY KEY,
           status_page_id text NOT NULL
             REFERENCES "${SCHEMA}".status_pages(id) ON DELETE CASCADE,
           email text NOT NULL,
           verification_token text,
           verified boolean NOT NULL DEFAULT false,
           unsubscribe_token text NOT NULL,
           categories text[],
           system_ids text[],
           created_at timestamp NOT NULL DEFAULT now(),
           verified_at timestamp
         )`,
      );
      await admin.query(
        `CREATE TABLE "${SCHEMA}".status_page_verified_emails (
           id text PRIMARY KEY,
           email text NOT NULL UNIQUE,
           verified_at timestamp NOT NULL DEFAULT now()
         )`,
      );
      pool = new Pool({
        connectionString: PG_URL,
        options: `-c search_path=${SCHEMA}`,
      });
      db = drizzle(pool, { schema }) as unknown as SafeDatabase<typeof schema>;
      service = makeService(inertRegistry);
    });

    afterAll(async () => {
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.end();
    });

    beforeEach(async () => {
      sentEmails.length = 0;
      await pool.query(
        `TRUNCATE "${SCHEMA}".status_page_subscribers,
                  "${SCHEMA}".status_page_verified_emails,
                  "${SCHEMA}".status_pages CASCADE`,
      );
    });

    // ----- reconcile-on-deletion -----

    it("removeAllForPage deletes exactly that page's subscribers", async () => {
      await insertPage("p1");
      await insertPage("p2");
      await insertSubscriber({ id: "s1", pageId: "p1", email: "a@x.com" });
      await insertSubscriber({ id: "s2", pageId: "p1", email: "b@x.com" });
      await insertSubscriber({ id: "s3", pageId: "p2", email: "c@x.com" });

      expect(await service.removeAllForPage("p1")).toBe(2);
      expect(await subscriberCount("p1")).toBe(0);
      expect(await subscriberCount("p2")).toBe(1);
    });

    it("deleting a page cascades to remove its subscribers (no orphans)", async () => {
      await insertPage("p1");
      await insertSubscriber({ id: "s1", pageId: "p1", email: "a@x.com" });
      await insertSubscriber({ id: "s2", pageId: "p1", email: "b@x.com" });
      expect(await subscriberCount("p1")).toBe(2);

      await pool.query(`DELETE FROM "${SCHEMA}".status_pages WHERE id = $1`, [
        "p1",
      ]);

      const res = await pool.query(
        `SELECT count(*)::int AS n FROM "${SCHEMA}".status_page_subscribers`,
      );
      expect(res.rows[0]?.n).toBe(0);
    });

    // ----- per-page hourly quota -----

    it("enforces the page's CONFIGURED hourly quota (quota=2 drops the 3rd)", async () => {
      await insertPage("p1", { enabled: true, quota: 2 });
      for (const email of ["a@x.com", "b@x.com", "c@x.com"]) {
        expect(await service.subscribe({ slug: "slug-p1", email })).toEqual({
          ok: true,
        });
      }
      expect(await subscriberCount("p1")).toBe(2);
    });

    it("uses the platform default when the quota is unset (null)", async () => {
      expect(DEFAULT_EMAIL_SUBSCRIBERS_HOURLY_QUOTA).toBe(50);
      await insertPage("p1", { enabled: true, quota: null });
      for (const email of ["a@x.com", "b@x.com", "c@x.com"]) {
        await service.subscribe({ slug: "slug-p1", email });
      }
      expect(await subscriberCount("p1")).toBe(3);
    });

    // ----- email verification + global registry -----

    it("required + brand-new email -> pending, verification email; verify -> active + global registry row", async () => {
      await insertPage("p1", { enabled: true });
      await service.subscribe({ slug: "slug-p1", email: "a@x.com" });

      const pending = await getSubscriber("p1", "a@x.com");
      expect(pending?.verified).toBe(false);
      expect(pending?.verificationToken).toBeTruthy();
      // A verification email (not a courtesy email) went out.
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]?.subject).toContain("Confirm");
      // Not yet globally verified.
      expect(await globalVerifiedCount("a@x.com")).toBe(0);

      await service.verify({ token: pending!.verificationToken! });
      expect((await getSubscriber("p1", "a@x.com"))?.verified).toBe(true);
      expect(await globalVerifiedCount("a@x.com")).toBe(1);
    });

    it("required + already-globally-verified email -> active immediately, courtesy email, NO verification email", async () => {
      await seedGlobalVerified("a@x.com");
      await insertPage("p1", { enabled: true });

      await service.subscribe({ slug: "slug-p1", email: "a@x.com" });
      const sub = await getSubscriber("p1", "a@x.com");
      expect(sub?.verified).toBe(true);
      expect(sub?.verificationToken).toBeNull();
      // Exactly one email, and it is the courtesy (not the verification) email.
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]?.subject).toContain("subscribed");
      expect(sentEmails.some((e) => e.subject.includes("Confirm"))).toBe(false);
    });

    it("verify on page A then subscribe same email to page B -> B active immediately (global once)", async () => {
      await insertPage("pA", { enabled: true });
      await insertPage("pB", { enabled: true });

      await service.subscribe({ slug: "slug-pA", email: "a@x.com" });
      const subA = await getSubscriber("pA", "a@x.com");
      await service.verify({ token: subA!.verificationToken! });

      await service.subscribe({ slug: "slug-pB", email: "a@x.com" });
      expect((await getSubscriber("pB", "a@x.com"))?.verified).toBe(true);
    });

    it("multiple pending rows for one email, then verify one -> the siblings also activate", async () => {
      await insertPage("pA", { enabled: true });
      await insertPage("pB", { enabled: true });
      // Both created pending (registry empty at subscribe time).
      await service.subscribe({ slug: "slug-pA", email: "a@x.com" });
      await service.subscribe({ slug: "slug-pB", email: "a@x.com" });
      expect((await getSubscriber("pB", "a@x.com"))?.verified).toBe(false);

      const subA = await getSubscriber("pA", "a@x.com");
      await service.verify({ token: subA!.verificationToken! });

      expect((await getSubscriber("pA", "a@x.com"))?.verified).toBe(true);
      expect((await getSubscriber("pB", "a@x.com"))?.verified).toBe(true);
    });

    it("verification OFF -> subscribe active immediately, no email, NO global registry write; not treated as globally verified elsewhere", async () => {
      await insertPage("pOff", { enabled: true, verificationRequired: false });
      await service.subscribe({ slug: "slug-pOff", email: "a@x.com" });

      const off = await getSubscriber("pOff", "a@x.com");
      expect(off?.verified).toBe(true);
      expect(off?.verificationToken).toBeNull();
      expect(sentEmails).toHaveLength(0); // no verification, no courtesy
      expect(await globalVerifiedCount("a@x.com")).toBe(0); // never registered

      // The same address on a verification-REQUIRED page is still pending.
      await insertPage("pReq", { enabled: true });
      await service.subscribe({ slug: "slug-pReq", email: "a@x.com" });
      expect((await getSubscriber("pReq", "a@x.com"))?.verified).toBe(false);
    });

    // ----- fan-out gate -----

    it("fan-out emails only active/verified rows", async () => {
      await insertPage("p1", {
        enabled: true,
        publishedLayout: [{ id: "b1", type: "test.feed", config: {} }],
      });
      await insertSubscriber({
        id: "sv",
        pageId: "p1",
        email: "verified@x.com",
        verified: true,
      });
      await insertSubscriber({
        id: "sp",
        pageId: "p1",
        email: "pending@x.com",
        verified: false,
      });

      const svc = makeService(scopeRegistry(["sys-1"]));
      const n = await svc.notifyForSystems({
        title: "Incident",
        body: "down",
        systemIds: ["sys-1"],
        sourcePluginId: "incident",
      });
      expect(n).toBe(1);
      expect(sentEmails.map((e) => e.to)).toEqual(["verified@x.com"]);
    });

    // ----- granular scope (categories + systems) round-trip -----

    const feedLayout = [{ id: "b1", type: "test.feed", config: {} }];

    it("new subscription defaults to incident+maintenance categories and all systems", async () => {
      await insertPage("p1", {
        enabled: true,
        verificationRequired: false,
        publishedLayout: feedLayout,
      });
      const svc = makeService(scopeRegistry(["sys-A", "sys-B"]));
      await svc.subscribe({ slug: "slug-p1", email: "a@x.com" });

      const sub = await getSubscriber("p1", "a@x.com");
      expect(sub?.verified).toBe(true);
      expect(sub?.categories).toEqual(["incident", "maintenance"]);
      expect(sub?.systemIds).toBeNull(); // null = all systems
    });

    it("clamps systemIds to the page's surfaced systems (hidden ids dropped)", async () => {
      await insertPage("p1", {
        enabled: true,
        verificationRequired: false,
        publishedLayout: feedLayout,
      });
      const svc = makeService(scopeRegistry(["sys-A", "sys-B"]));
      await svc.subscribe({
        slug: "slug-p1",
        email: "a@x.com",
        categories: ["incident"],
        systemIds: ["sys-A", "sys-HIDDEN"],
      });

      const sub = await getSubscriber("p1", "a@x.com");
      expect(sub?.categories).toEqual(["incident"]);
      expect(sub?.systemIds).toEqual(["sys-A"]); // sys-HIDDEN dropped, no leak
    });

    it("falls back to all systems when every requested id is not surfaced", async () => {
      await insertPage("p1", {
        enabled: true,
        verificationRequired: false,
        publishedLayout: feedLayout,
      });
      const svc = makeService(scopeRegistry(["sys-A"]));
      await svc.subscribe({
        slug: "slug-p1",
        email: "a@x.com",
        systemIds: ["not-a-real-system"],
      });

      const sub = await getSubscriber("p1", "a@x.com");
      expect(sub?.systemIds).toBeNull();
    });

    it("re-subscribing a verified address updates its scope (no duplicate row)", async () => {
      await insertPage("p1", {
        enabled: true,
        verificationRequired: false,
        publishedLayout: feedLayout,
      });
      const svc = makeService(scopeRegistry(["sys-A", "sys-B"]));
      await svc.subscribe({
        slug: "slug-p1",
        email: "a@x.com",
        categories: ["incident"],
        systemIds: ["sys-A"],
      });
      await svc.subscribe({
        slug: "slug-p1",
        email: "a@x.com",
        categories: ["maintenance", "health"],
        systemIds: ["sys-B"],
      });

      expect(await subscriberCount("p1")).toBe(1);
      const sub = await getSubscriber("p1", "a@x.com");
      expect(sub?.categories).toEqual(["maintenance", "health"]);
      expect(sub?.systemIds).toEqual(["sys-B"]);
    });

    it("a legacy row (NULL scope) reads back as all categories / all systems", async () => {
      await insertPage("p1", { enabled: true });
      await insertSubscriber({ id: "s1", pageId: "p1", email: "a@x.com" });
      const sub = await getSubscriber("p1", "a@x.com");
      expect(sub?.categories).toBeNull();
      expect(sub?.systemIds).toBeNull();
    });

    it("re-subscribing WITHOUT categories preserves the existing scope (legacy NULL stays 'everything')", async () => {
      await insertPage("p1", {
        enabled: true,
        verificationRequired: false,
        publishedLayout: feedLayout,
      });
      // A legacy verified subscriber: NULL categories = every category, NULL
      // systemIds = all systems.
      await insertSubscriber({
        id: "s1",
        pageId: "p1",
        email: "a@x.com",
        verified: true,
      });
      const svc = makeService(scopeRegistry(["sys-A", "sys-B"]));
      // Re-subscribe with NOTHING specified: must NOT narrow to the defaults.
      await svc.subscribe({ slug: "slug-p1", email: "a@x.com" });

      const sub = await getSubscriber("p1", "a@x.com");
      expect(sub?.categories).toBeNull();
      expect(sub?.systemIds).toBeNull();
    });

    it("re-subscribing updates only the explicitly-provided field, preserving the other", async () => {
      await insertPage("p1", {
        enabled: true,
        verificationRequired: false,
        publishedLayout: feedLayout,
      });
      const svc = makeService(scopeRegistry(["sys-A", "sys-B"]));
      await svc.subscribe({
        slug: "slug-p1",
        email: "a@x.com",
        categories: ["incident"],
        systemIds: ["sys-A"],
      });
      // Only systemIds provided this time -> categories preserved as [incident].
      await svc.subscribe({
        slug: "slug-p1",
        email: "a@x.com",
        systemIds: ["sys-B"],
      });

      const sub = await getSubscriber("p1", "a@x.com");
      expect(sub?.categories).toEqual(["incident"]);
      expect(sub?.systemIds).toEqual(["sys-B"]);
    });

    // ----- unsubscribe (wrapped in one scoped transaction) -----

    it("unsubscribe on an email-enabled page deletes the subscriber row", async () => {
      await insertPage("pu", { enabled: true });
      await insertSubscriber({ id: "u1", pageId: "pu", email: "a@x.com" });
      const res = await service.unsubscribe({ token: "unsub-u1" });
      expect(res).toEqual({ ok: true });
      expect(await subscriberCount("pu")).toBe(0);
    });

    it("unsubscribe is a no-op when the page has email subscriptions disabled (row survives, dormant)", async () => {
      await insertPage("pd", { enabled: false });
      await insertSubscriber({ id: "u2", pageId: "pd", email: "b@x.com" });
      const res = await service.unsubscribe({ token: "unsub-u2" });
      expect(res).toEqual({ ok: true });
      expect(await subscriberCount("pd")).toBe(1);
    });

    it("unsubscribe with an unknown token is a constant-time no-op", async () => {
      await insertPage("pu2", { enabled: true });
      await insertSubscriber({ id: "u3", pageId: "pu2", email: "c@x.com" });
      const res = await service.unsubscribe({ token: "does-not-exist" });
      expect(res).toEqual({ ok: true });
      expect(await subscriberCount("pu2")).toBe(1);
    });
  },
);
