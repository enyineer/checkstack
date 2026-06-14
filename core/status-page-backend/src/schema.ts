import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";
import type {
  StatusPageLayout,
  StatusPageTheme,
} from "@checkstack/status-page-common";

/**
 * Status pages. Team ownership lives in the relation-tuple store keyed by
 * `statuspage.page` / id (NOT a column here) — exactly like systems/automations.
 *
 * The DRAFT layout is the builder's working copy. PUBLISH snapshots it into
 * `published_layout`; the public resolver reads ONLY `published_layout`, so a
 * page being edited never changes under visitors until republished.
 */
export const statusPages = pgTable(
  "status_pages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** "public" | "authenticated" */
    visibility: text("visibility").notNull().default("public"),
    /**
     * Optional custom domain this page is served on (e.g. `status.acme.com`),
     * lowercased FQDN. Unique across pages; many pages have none (Postgres
     * unique indexes permit multiple NULLs). Only routes once
     * `customDomainVerifiedAt` is set AND the page is published.
     */
    customDomain: text("custom_domain"),
    /** DNS TXT verification token for `_checkstack-verify.<customDomain>`. */
    customDomainToken: text("custom_domain_token"),
    /** Set when DNS ownership of `customDomain` was last verified. */
    customDomainVerifiedAt: timestamp("custom_domain_verified_at"),
    theme: jsonb("theme").$type<StatusPageTheme>().notNull().default({ mode: "auto" }),
    draftLayout: jsonb("draft_layout")
      .$type<StatusPageLayout>()
      .notNull()
      .default([]),
    /** Null until the page is published; the public-facing snapshot. */
    publishedLayout: jsonb("published_layout").$type<StatusPageLayout>(),
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    slugUnique: uniqueIndex("status_pages_slug_unique").on(t.slug),
    customDomainUnique: uniqueIndex("status_pages_custom_domain_unique").on(
      t.customDomain,
    ),
  }),
);

export type StatusPageRow = InferSelectModel<typeof statusPages>;
