import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  uniqueIndex,
  index,
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
    /**
     * Per-page opt-in for anonymous EMAIL subscriptions. Default OFF: the public
     * subscribe form is hidden and the public subscribe/verify/unsubscribe
     * endpoints fail closed until an admin enables it.
     */
    emailSubscriptionsEnabled: boolean("email_subscriptions_enabled")
      .notNull()
      .default(false),
    /**
     * Per-page hourly cap on NEW email subscribers, on top of the per-(page,email)
     * cooldown. NULL means "use the platform default" so existing rows are
     * unchanged; a positive value tightens/loosens the cap. Enforced by counting
     * durable rows, so it holds identically across pods.
     */
    emailSubscribersHourlyQuota: integer("email_subscribers_hourly_quota"),
    /**
     * Whether a new email subscriber must confirm their address before receiving
     * fan-out. Default ON (double opt-in). When OFF, `subscribe` activates the row
     * immediately without a verification email and without touching the global
     * verified-email registry - the operator's deliberate trust choice for e.g. an
     * internal page.
     */
    emailVerificationRequired: boolean("email_verification_required")
      .notNull()
      .default(true),
    /**
     * Catalog environment ids this page publishes. NULL (or empty) means "all
     * environments" - the backward-compatible default that leaves existing pages
     * unchanged. A non-empty set restricts the page: status, incidents,
     * maintenances and uptime are omitted for systems that belong to NONE of
     * these environments. The ids are OPAQUE here (status-page-backend never
     * imports the catalog); domain widget contributors resolve them to systems.
     */
    publishedEnvironmentIds: text("published_environment_ids").array(),
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

/**
 * Anonymous email subscribers to a status page's incident updates. Distinct from
 * authenticated in-app subscriptions (those key on `userId`): these are raw
 * email addresses that a public visitor entered, gated by a double-opt-in
 * verification token and removable via a per-subscriber unsubscribe token.
 *
 * A subscriber is created UNVERIFIED; the verification email carries
 * `verification_token`. Only `verified` subscribers receive fan-out. Every
 * outbound email carries the `unsubscribe_token` link (mandatory). Unique on
 * (status_page_id, email) so a repeat subscribe is idempotent and never reveals
 * whether an address was already subscribed (enumeration guard).
 */
export const statusPageSubscribers = pgTable(
  "status_page_subscribers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    statusPageId: text("status_page_id")
      .notNull()
      .references(() => statusPages.id, { onDelete: "cascade" }),
    /** Lowercased email address the visitor subscribed with. */
    email: text("email").notNull(),
    /** Double-opt-in token emailed to confirm the address (single use). */
    verificationToken: text("verification_token"),
    /** True once the address confirmed via the verification link. */
    verified: boolean("verified").notNull().default(false),
    /** Stable token that unsubscribes this row (present in every email). */
    unsubscribeToken: text("unsubscribe_token").notNull(),
    /**
     * Update categories this subscriber opted into (incident / maintenance /
     * health). NULL means "every category" - the backward-compatible legacy
     * behavior for rows created before granular scope existed. A non-null value
     * (possibly empty) restricts the fan-out to exactly those categories.
     */
    categories: text("categories").array(),
    /**
     * Concrete catalog system ids this subscriber restricted to. NULL or empty
     * means "all systems the page surfaces" (the default). A non-empty value
     * limits fan-out to notifications touching at least one of these systems.
     */
    systemIds: text("system_ids").array(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    verifiedAt: timestamp("verified_at"),
  },
  (t) => ({
    pageEmailUnique: uniqueIndex(
      "status_page_subscribers_page_email_unique",
    ).on(t.statusPageId, t.email),
    pageIdx: index("status_page_subscribers_page_idx").on(t.statusPageId),
    pageVerifiedIdx: index(
      "status_page_subscribers_page_verified_idx",
    ).on(t.statusPageId, t.verified),
  }),
);

export type StatusPageSubscriberRow = InferSelectModel<
  typeof statusPageSubscribers
>;

/**
 * Platform-GLOBAL registry of email addresses that have proven ownership by
 * completing a double-opt-in verification at least once, on ANY status page. One
 * row per normalized address (same trim+lowercase normalization the per-(page,
 * email) subscriber key uses).
 *
 * Purpose: once an address is proven, a later subscribe to a DIFFERENT page can
 * short-circuit to active without re-verifying (the address is already known to
 * belong to a real, reachable inbox) - the owner is still sent a courtesy email
 * with a one-click unsubscribe, so a malicious add is always caught. Only a
 * genuine verification writes here; an opt-out (verification-not-required) page
 * NEVER registers an address, so trust can't be laundered through such a page.
 */
export const statusPageVerifiedEmails = pgTable(
  "status_page_verified_emails",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Normalized (trim+lowercase) email address, unique platform-wide. */
    email: text("email").notNull(),
    /** When the address first completed verification. */
    verifiedAt: timestamp("verified_at").defaultNow().notNull(),
  },
  (t) => ({
    emailUnique: uniqueIndex("status_page_verified_emails_email_unique").on(
      t.email,
    ),
  }),
);

export type StatusPageVerifiedEmailRow = InferSelectModel<
  typeof statusPageVerifiedEmails
>;
