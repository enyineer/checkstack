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
} from "./schemas";
import { WidgetTypeDescriptorSchema } from "./widget-types";

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
} as const;

export const StatusPageApi = createClientDefinition(
  statusPageContract,
  pluginMetadata,
);
