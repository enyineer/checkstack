import { createClientDefinition, proc } from "@checkstack/common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";
import { statusPageAccess } from "./access";
import {
  StatusPageSchema,
  StatusPageSummarySchema,
  StatusPageVisibilitySchema,
  StatusPageThemeSchema,
  StatusPageLayoutSchema,
  StatusPageSlugSchema,
  PublishedStatusPageSchema,
  CustomDomainSchema,
  SubscriberEmailSchema,
  StatusPageSubscriberSchema,
  EmailSubscribersHourlyQuotaSchema,
} from "./schemas";
import { SubscriptionCategorySchema } from "./subscription-categories";
import {
  WidgetTypeDescriptorSchema,
  IncidentDtoItemSchema,
  MaintenanceDtoItemSchema,
} from "./widget-types";

const TitleSchema = z.string().trim().min(1).max(160);

export const statusPageContract = {
  // ----- Admin builder (authenticated, team-scoped) -----

  listStatusPages: proc({
    operationType: "query",
    userType: "authenticated",
    access: [statusPageAccess.page.read],
    instanceAccess: { listKey: "pages" },
  })
    .input(z.object({}).optional())
    .output(z.object({ pages: z.array(StatusPageSummarySchema) })),

  getStatusPage: proc({
    operationType: "query",
    userType: "authenticated",
    access: [statusPageAccess.page.read],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(StatusPageSchema.nullable()),

  createStatusPage: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [statusPageAccess.page.manage],
    // Create-mode team ownership: middleware resolves the owning team from
    // `teamId` (create-capability grant or global manage) and writes the owner
    // relation keyed by `statuspage.page` / `response.id` post-handler.
    instanceAccess: { create: { teamIdParam: "teamId", idField: "id" } },
  })
    .input(
      z.object({
        title: TitleSchema,
        slug: StatusPageSlugSchema,
        teamId: z.string().optional(),
        // Catalog environment ids to publish; omit/empty = all environments.
        publishedEnvironmentIds: z.array(z.string()).optional(),
      }),
    )
    .output(StatusPageSchema),

  updateStatusPage: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [statusPageAccess.page.manage],
    instanceAccess: { idParam: "id" },
  })
    .input(
      z.object({
        id: z.string(),
        title: TitleSchema.optional(),
        slug: StatusPageSlugSchema.optional(),
        visibility: StatusPageVisibilitySchema.optional(),
        theme: StatusPageThemeSchema.optional(),
        draftLayout: StatusPageLayoutSchema.optional(),
        emailSubscriptionsEnabled: z.boolean().optional(),
        // Nullable: pass null to reset to the platform default; omit to leave
        // unchanged. Gated by the same `idParam: "id"` page-manage capability as
        // every other field on this proc (no new open surface).
        emailSubscribersHourlyQuota:
          EmailSubscribersHourlyQuotaSchema.nullable().optional(),
        // Toggle double-opt-in verification for new subscribers. Same page-manage
        // gate as every other field on this proc.
        emailVerificationRequired: z.boolean().optional(),
        // Catalog environment ids to publish. Pass an array to set the set (empty
        // array or null both mean "all environments"); omit to leave unchanged.
        // Same page-manage gate as every other field on this proc.
        publishedEnvironmentIds: z.array(z.string()).nullable().optional(),
      }),
    )
    .output(StatusPageSchema),

  /**
   * Snapshot the draft layout into the published layout. The middleware checks
   * `manage` on the page; the handler additionally verifies the editor can
   * access every resource a widget binds (you cannot publish what you cannot
   * see) and emits an audit event (the deliberate public-exposure record).
   */
  publishStatusPage: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [statusPageAccess.page.manage],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(StatusPageSchema),

  unpublishStatusPage: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [statusPageAccess.page.manage],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(StatusPageSchema),

  deleteStatusPage: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [statusPageAccess.page.manage],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(z.object({ deleted: z.boolean() })),

  // ----- Custom domain (authenticated, team-scoped via the page) -----

  /**
   * Set (or replace) the page's custom domain. Generates a fresh DNS TXT
   * verification token and clears any prior verification, so the domain does
   * NOT route until `verifyCustomDomain` succeeds. The domain is unique across
   * pages.
   */
  setCustomDomain: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [statusPageAccess.page.manage],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string(), domain: CustomDomainSchema }))
    .output(StatusPageSchema),

  /**
   * Check the DNS TXT record for the page's custom domain and, if it matches
   * the verification token, mark the domain verified (it then begins routing).
   * Idempotent; safe to call repeatedly while DNS propagates.
   */
  verifyCustomDomain: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [statusPageAccess.page.manage],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(StatusPageSchema),

  /** Remove the page's custom domain (it stops routing immediately). */
  removeCustomDomain: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [statusPageAccess.page.manage],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(StatusPageSchema),

  /** Widget catalogue for the builder (built-ins + plugin-contributed types). */
  listWidgetTypes: proc({
    operationType: "query",
    userType: "authenticated",
    access: [statusPageAccess.page.read],
    instanceAccess: { global: true },
  })
    .input(z.object({}).optional())
    .output(z.object({ widgetTypes: z.array(WidgetTypeDescriptorSchema) })),

  // ----- Public surface (the ONLY public data endpoint) -----

  /**
   * Resolve a PUBLISHED page for the public renderer. `userType: "public"` gated
   * by the anonymous `published.read` grant; NOT team-scoped (team ownership
   * governs editing, not viewing). The handler enforces published + per-page
   * visibility, and returns ONLY the resolved, field-allow-listed widget DTOs —
   * never a generic data API. Returns null when no published page matches.
   */
  getPublishedStatusPage: proc({
    operationType: "query",
    userType: "public",
    access: [statusPageAccess.published],
    instanceAccess: { global: true },
  })
    .input(z.object({ slug: z.string() }))
    .output(PublishedStatusPageSchema.nullable()),

  /**
   * Public-safe detail for a single incident item on a published page. GATED to
   * prevent enumeration / IDOR: the handler resolves the page for `slug` (same
   * published + visibility checks as {@link getPublishedStatusPage}) and returns
   * the item ONLY if that page actually surfaces `id` through an incidents
   * widget. Returns the SAME field-allow-listed DTO the widget emits (no
   * `createdBy` / internal fields); null when the page does not expose the id.
   */
  getPublishedIncident: proc({
    operationType: "query",
    userType: "public",
    access: [statusPageAccess.published],
    instanceAccess: { global: true },
  })
    .input(z.object({ slug: z.string(), id: z.string() }))
    .output(IncidentDtoItemSchema.nullable()),

  /** Public-safe detail for a single maintenance item. See getPublishedIncident. */
  getPublishedMaintenance: proc({
    operationType: "query",
    userType: "public",
    access: [statusPageAccess.published],
    instanceAccess: { global: true },
  })
    .input(z.object({ slug: z.string(), id: z.string() }))
    .output(MaintenanceDtoItemSchema.nullable()),

  // ----- Email subscriptions (public, anonymous double-opt-in) -----

  /**
   * Subscribe an email address to a published page's incident updates. Public +
   * anonymous. ALWAYS returns `{ ok: true }` in constant time regardless of
   * whether the page exists, is published, or the address is already subscribed
   * - so it can never be used to enumerate pages or addresses. A verification
   * email (double opt-in) is sent out-of-band; the address receives fan-out only
   * after it confirms.
   *
   * Optional `categories` / `systemIds` scope the subscription (which update
   * kinds, which systems). The backend CLAMPS both to what the page actually
   * offers - unknown categories and systems not surfaced by the page are
   * silently dropped, never rejected - so this endpoint can never be used to
   * probe which systems a page hides. Omitting `categories` defaults to
   * incidents + maintenance; omitting `systemIds` (or clamping to empty) means
   * all systems the page surfaces.
   */
  subscribeToStatusPage: proc({
    operationType: "mutation",
    userType: "public",
    access: [statusPageAccess.published],
    instanceAccess: { global: true },
  })
    .input(
      z.object({
        slug: z.string(),
        email: SubscriberEmailSchema,
        categories: z.array(SubscriptionCategorySchema).optional(),
        systemIds: z.array(z.string()).optional(),
      }),
    )
    .output(z.object({ ok: z.boolean() })),

  /** Confirm a subscription via its verification token. Constant-time response. */
  verifyStatusPageSubscription: proc({
    operationType: "mutation",
    userType: "public",
    access: [statusPageAccess.published],
    instanceAccess: { global: true },
  })
    .input(z.object({ token: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() })),

  /** Unsubscribe via the token embedded in every email. Constant-time response. */
  unsubscribeFromStatusPage: proc({
    operationType: "mutation",
    userType: "public",
    access: [statusPageAccess.published],
    instanceAccess: { global: true },
  })
    .input(z.object({ token: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() })),

  // ----- Subscriber admin (authenticated, team-scoped via the page) -----

  /** List a page's email subscribers (admin). Team-scoped by MANAGE on the page. */
  listStatusPageSubscribers: proc({
    operationType: "query",
    userType: "authenticated",
    access: [statusPageAccess.page.manage],
    instanceAccess: { idParam: "statusPageId" },
  })
    .input(z.object({ statusPageId: z.string() }))
    .output(z.object({ subscribers: z.array(StatusPageSubscriberSchema) })),

  /** Remove a subscriber (admin). Team-scoped by MANAGE on the owning page. */
  deleteStatusPageSubscriber: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [statusPageAccess.page.manage],
    instanceAccess: { idParam: "statusPageId" },
  })
    .route({ method: "DELETE" })
    .input(z.object({ statusPageId: z.string(), id: z.string() }))
    .output(z.object({ deleted: z.boolean() })),
} as const;

export const StatusPageApi = createClientDefinition(
  statusPageContract,
  pluginMetadata,
);
