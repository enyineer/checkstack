/**
 * Integration test (real Postgres) for the custom-domain HOST -> STATUS PAGE
 * resolution path: `StatusPageService.resolveByHost` and `isConfiguredDomain`.
 *
 * Why this exists: the unit tests in `service.test.ts` exercise the
 * verified/published/public GATE, but their fake DB ignores the WHERE clause
 * and returns the seeded row for ANY host - so the actual
 * `custom_domain == host` SQL match (and the unique-index/normalization
 * behaviour) was never proven end-to-end. The DNS-verification path has its own
 * real test (`custom-domain.e2e.it.test.ts`), and the platform host-routing
 * middleware has one too (`public-host/routing.e2e.it.test.ts`) - but both stub
 * the OTHER half, so nothing drove a real Host header through to the real
 * resolver DB query. This closes that gap: custom domains must actually route.
 *
 * Uses the package's REAL Drizzle migrations via `withTestDb`, so it pins the
 * production `status_pages` schema (columns, defaults, the custom_domain unique
 * index), not a hand-rolled table. Gated on CHECKSTACK_IT.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  isIntegrationEnabled,
  withTestDb,
  type TestDb,
} from "@checkstack/test-utils-backend";
import type { Logger, RpcClient } from "@checkstack/backend-api";
import * as schema from "./schema";
import { statusPages } from "./schema";
import { StatusPageService } from "./service";
import type { WidgetTypeRegistry } from "./widget-registry";

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

const inertRegistry: WidgetTypeRegistry = {
  register: () => {},
  get: () => undefined,
  list: () => [],
};

const noRpc: RpcClient = { forPlugin: () => ({}) as never };

describe.skipIf(!isIntegrationEnabled())(
  "StatusPageService host resolution (real Postgres)",
  () => {
    let testDb: TestDb<typeof schema>;
    let service: StatusPageService;
    // Mutable TXT value so a single injected resolver can be primed per test to
    // return the freshly-issued verification token (custom domains prove
    // ownership via a DNS TXT record).
    let txtValue: string | null = null;

    beforeAll(async () => {
      testDb = await withTestDb({ schema, migrationsFolder });
      service = new StatusPageService({
        db: testDb.db,
        registry: inertRegistry,
        rpcClient: noRpc,
        logger: noopLogger,
        txtResolver: async () => (txtValue === null ? [] : [[txtValue]]),
        primaryHost: "status.checkstack.test",
      });
    });

    afterAll(async () => {
      await testDb.dispose();
    });

    /** Insert a page row directly with explicit custom-domain/publish state. */
    async function seedPage(over: {
      slug: string;
      customDomain?: string | null;
      customDomainVerifiedAt?: Date | null;
      publishedAt?: Date | null;
      visibility?: "public" | "authenticated";
    }): Promise<void> {
      await testDb.db.insert(statusPages).values({
        slug: over.slug,
        title: `Page ${over.slug}`,
        visibility: over.visibility ?? "public",
        customDomain: over.customDomain ?? null,
        customDomainVerifiedAt: over.customDomainVerifiedAt ?? null,
        publishedAt: over.publishedAt ?? null,
      });
    }

    describe("resolveByHost — real WHERE match + gate", () => {
      it("resolves a verified + published + public custom domain to its slug", async () => {
        await seedPage({
          slug: "acme",
          customDomain: "status.acme.test",
          customDomainVerifiedAt: new Date(),
          publishedAt: new Date(),
        });
        expect(await service.resolveByHost("status.acme.test")).toEqual({
          slug: "acme",
        });
      });

      it("returns null for a host no page claims (proves the WHERE actually filters)", async () => {
        // A fully-live page exists (previous test's row survives), but a
        // DIFFERENT host must not resolve to it - the fake-DB unit test could
        // not prove this.
        expect(await service.resolveByHost("unclaimed.example.test")).toBeNull();
      });

      it("returns null when the domain is configured but NOT verified", async () => {
        await seedPage({
          slug: "unverified",
          customDomain: "status.unverified.test",
          customDomainVerifiedAt: null,
          publishedAt: new Date(),
        });
        expect(
          await service.resolveByHost("status.unverified.test"),
        ).toBeNull();
      });

      it("returns null when verified + public but NOT published", async () => {
        await seedPage({
          slug: "draft",
          customDomain: "status.draft.test",
          customDomainVerifiedAt: new Date(),
          publishedAt: null,
        });
        expect(await service.resolveByHost("status.draft.test")).toBeNull();
      });

      it("returns null for a verified + published but AUTHENTICATED page", async () => {
        await seedPage({
          slug: "internal",
          customDomain: "status.internal.test",
          customDomainVerifiedAt: new Date(),
          publishedAt: new Date(),
          visibility: "authenticated",
        });
        expect(await service.resolveByHost("status.internal.test")).toBeNull();
      });

      it("normalizes the incoming host (case + surrounding whitespace)", async () => {
        await seedPage({
          slug: "norm",
          customDomain: "status.norm.test",
          customDomainVerifiedAt: new Date(),
          publishedAt: new Date(),
        });
        expect(await service.resolveByHost("  STATUS.Norm.Test ")).toEqual({
          slug: "norm",
        });
      });

      it("returns null for an empty host without hitting the DB", async () => {
        expect(await service.resolveByHost("")).toBeNull();
        expect(await service.resolveByHost("   ")).toBeNull();
      });
    });

    describe("isConfiguredDomain — claimed regardless of live state", () => {
      it("is true for a configured-but-unverified host and false for an unknown host", async () => {
        await seedPage({
          slug: "claimed",
          customDomain: "status.claimed.test",
          customDomainVerifiedAt: null,
          publishedAt: null,
        });
        // Claimed even though it is not yet servable (so the platform can serve
        // the "unavailable" bundle rather than fall through to the admin SPA).
        expect(await service.isConfiguredDomain("status.claimed.test")).toBe(
          true,
        );
        expect(await service.isConfiguredDomain("nobody.example.test")).toBe(
          false,
        );
      });
    });

    describe("full service write -> read loop", () => {
      it("setCustomDomain + verifyCustomDomain make the host route via resolveByHost", async () => {
        // A published, public page with no domain yet.
        await seedPage({ slug: "loop", publishedAt: new Date() });
        const [page] = await testDb.db
          .select({ id: statusPages.id })
          .from(statusPages)
          .where(eq(statusPages.slug, "loop"))
          .limit(1);
        const id = page!.id;

        const domain = "status.loop.test";
        await service.setCustomDomain({ id, domain });
        // Not routable yet: ownership unproven.
        expect(await service.resolveByHost(domain)).toBeNull();

        // Prime the fake DNS with the token the service just issued, then verify.
        const [row] = await testDb.db
          .select({ token: statusPages.customDomainToken })
          .from(statusPages)
          .where(eq(statusPages.id, id))
          .limit(1);
        txtValue = row!.token;
        await service.verifyCustomDomain({ id });

        // Now the real Host header routes to the real page.
        expect(await service.resolveByHost(domain)).toEqual({ slug: "loop" });

        // Removing the domain stops it routing and un-claims it.
        await service.removeCustomDomain({ id });
        expect(await service.resolveByHost(domain)).toBeNull();
        expect(await service.isConfiguredDomain(domain)).toBe(false);
      });
    });
  },
);
