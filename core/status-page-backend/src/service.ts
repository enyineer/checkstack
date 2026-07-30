import { z } from "zod";
import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { extractErrorMessage } from "@checkstack/common";
import type { SafeDatabase, RpcClient, Logger } from "@checkstack/backend-api";
import {
  StatusPageVisibilitySchema,
  StatusPageThemeSchema,
  customDomainTxtRecordName,
  type StatusPage,
  type StatusPageSummary,
  type StatusPageLayout,
  type StatusPageTheme,
  type StatusPageVisibility,
  type PublishedStatusPage,
  type ResolvedBlock,
  type WidgetTypeDescriptor,
  deriveOverallStatus,
  type CustomDomainInfo,
  BUILTIN_WIDGET_IDS,
  IncidentDtoItemSchema,
  MaintenanceDtoItemSchema,
  type IncidentDtoItem,
  type MaintenanceDtoItem,
} from "@checkstack/status-page-common";
import * as schema from "./schema";
import { statusPages, type StatusPageRow } from "./schema";
import {
  verifyDomainTxt,
  reservedDomainReason,
  type TxtResolver,
} from "./custom-domain";
import type {
  BoundResource,
  WidgetResolveContext,
  WidgetTypeRegistry,
} from "./widget-registry";
import { resolveSubscribableSystems } from "./scoped-systems";

type Db = SafeDatabase<typeof schema>;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function rowVisibility(row: StatusPageRow): StatusPageVisibility {
  const parsed = StatusPageVisibilitySchema.safeParse(row.visibility);
  return parsed.success ? parsed.data : "public";
}

function rowTheme(row: StatusPageRow): StatusPageTheme {
  const parsed = StatusPageThemeSchema.safeParse(row.theme);
  return parsed.success ? parsed.data : { mode: "auto" };
}

function rowToCustomDomain(row: StatusPageRow): CustomDomainInfo | null {
  if (!row.customDomain) return null;
  return {
    domain: row.customDomain,
    verification: {
      recordName: customDomainTxtRecordName(row.customDomain),
      recordValue: row.customDomainToken ?? "",
    },
    verified: row.customDomainVerifiedAt !== null,
    verifiedAt: iso(row.customDomainVerifiedAt),
  };
}

function rowToPage(row: StatusPageRow): StatusPage {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    visibility: rowVisibility(row),
    theme: rowTheme(row),
    draftLayout: row.draftLayout,
    publishedLayout: row.publishedLayout ?? null,
    published: row.publishedLayout !== null,
    publishedAt: iso(row.publishedAt),
    customDomain: rowToCustomDomain(row),
    emailSubscriptionsEnabled: row.emailSubscriptionsEnabled,
    emailSubscribersHourlyQuota: row.emailSubscribersHourlyQuota,
    emailVerificationRequired: row.emailVerificationRequired,
    publishedEnvironmentIds: row.publishedEnvironmentIds ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The page's EFFECTIVE published-environment filter for a resolve context: the
 * stored ids, or `undefined` when the column is NULL or empty (both mean "all
 * environments" - no filtering). Threaded onto {@link WidgetResolveContext} so
 * widget contributors omit systems outside the selected environments.
 */
export function effectivePublishedEnvironmentIds(
  row: Pick<StatusPageRow, "publishedEnvironmentIds">,
): string[] | undefined {
  const ids = row.publishedEnvironmentIds;
  return ids && ids.length > 0 ? ids : undefined;
}

function rowToSummary(row: StatusPageRow): StatusPageSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    visibility: rowVisibility(row),
    published: row.publishedLayout !== null,
    publishedAt: iso(row.publishedAt),
    customDomain: row.customDomain ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface StatusPageServiceDeps {
  db: Db;
  registry: WidgetTypeRegistry;
  /** Trusted service client for the public resolver (reads bound resources). */
  rpcClient: RpcClient;
  logger: Logger;
  /** DNS TXT resolver for custom-domain ownership verification. */
  txtResolver: TxtResolver;
  /** The platform's own host (from BASE_URL); custom domains may not use it. */
  primaryHost: string | null;
}

export class StatusPageService {
  constructor(private readonly deps: StatusPageServiceDeps) {}

  async list(): Promise<StatusPageSummary[]> {
    const rows = await this.deps.db.select().from(statusPages);
    return rows.map((row) => rowToSummary(row));
  }

  async get(id: string): Promise<StatusPage | null> {
    const [row] = await this.deps.db
      .select()
      .from(statusPages)
      .where(eq(statusPages.id, id))
      .limit(1);
    return row ? rowToPage(row) : null;
  }

  private async requireRow(id: string): Promise<StatusPageRow> {
    const [row] = await this.deps.db
      .select()
      .from(statusPages)
      .where(eq(statusPages.id, id))
      .limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Status page not found." });
    return row;
  }

  private async assertSlugFree(slug: string, exceptId?: string): Promise<void> {
    const [row] = await this.deps.db
      .select({ id: statusPages.id })
      .from(statusPages)
      .where(eq(statusPages.slug, slug))
      .limit(1);
    if (row && row.id !== exceptId) {
      throw new ORPCError("CONFLICT", {
        message: `The slug "${slug}" is already in use.`,
      });
    }
  }

  async create(input: {
    title: string;
    slug: string;
    publishedEnvironmentIds?: string[];
  }): Promise<StatusPage> {
    await this.assertSlugFree(input.slug);
    const [row] = await this.deps.db
      .insert(statusPages)
      .values({
        title: input.title,
        slug: input.slug,
        // Empty array normalizes to NULL ("all environments").
        publishedEnvironmentIds:
          input.publishedEnvironmentIds &&
          input.publishedEnvironmentIds.length > 0
            ? input.publishedEnvironmentIds
            : null,
      })
      .returning();
    return rowToPage(row);
  }

  async update(input: {
    id: string;
    title?: string;
    slug?: string;
    visibility?: StatusPageVisibility;
    theme?: StatusPageTheme;
    draftLayout?: StatusPageLayout;
    emailSubscriptionsEnabled?: boolean;
    emailSubscribersHourlyQuota?: number | null;
    emailVerificationRequired?: boolean;
    publishedEnvironmentIds?: string[] | null;
  }): Promise<StatusPage> {
    await this.requireRow(input.id);
    if (input.slug !== undefined) await this.assertSlugFree(input.slug, input.id);
    const set: Partial<StatusPageRow> = { updatedAt: new Date() };
    if (input.title !== undefined) set.title = input.title;
    if (input.slug !== undefined) set.slug = input.slug;
    if (input.visibility !== undefined) set.visibility = input.visibility;
    if (input.theme !== undefined) set.theme = input.theme;
    if (input.draftLayout !== undefined) set.draftLayout = input.draftLayout;
    if (input.emailSubscriptionsEnabled !== undefined) {
      set.emailSubscriptionsEnabled = input.emailSubscriptionsEnabled;
    }
    if (input.emailSubscribersHourlyQuota !== undefined) {
      // null resets to the platform default; a positive int sets the cap.
      set.emailSubscribersHourlyQuota = input.emailSubscribersHourlyQuota;
    }
    if (input.emailVerificationRequired !== undefined) {
      set.emailVerificationRequired = input.emailVerificationRequired;
    }
    if (input.publishedEnvironmentIds !== undefined) {
      // null OR empty both persist as NULL ("all environments"); a non-empty
      // array restricts the page to those environments.
      set.publishedEnvironmentIds =
        input.publishedEnvironmentIds &&
        input.publishedEnvironmentIds.length > 0
          ? input.publishedEnvironmentIds
          : null;
    }
    const [row] = await this.deps.db
      .update(statusPages)
      .set(set)
      .where(eq(statusPages.id, input.id))
      .returning();
    return rowToPage(row);
  }

  /** Every resource bound by the widgets in a layout (deduped per type+id). */
  collectBoundResources(layout: StatusPageLayout): BoundResource[] {
    const seen = new Set<string>();
    const out: BoundResource[] = [];
    for (const block of layout) {
      const widget = this.deps.registry.get(block.type);
      if (!widget) continue;
      let bound: BoundResource[] = [];
      try {
        bound = widget.boundResources(block.config);
      } catch {
        // A malformed stored config can't bind anything; ignore for collection.
        bound = [];
      }
      for (const b of bound) {
        const key = `${b.resourceType}:${b.resourceId}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(b);
        }
      }
    }
    return out;
  }

  /**
   * Publish the draft. The middleware already verified `manage` on the page;
   * this additionally enforces the editor can READ every bound resource (you
   * cannot publish what you cannot see) using the USER-scoped client, then
   * snapshots draft -> published. Returns the exposed resources for the audit.
   */
  async publish(input: {
    id: string;
    userClient: RpcClient;
  }): Promise<{ page: StatusPage; exposed: BoundResource[] }> {
    const row = await this.requireRow(input.id);
    await this.assertEditorCanAccess(input.userClient, row.draftLayout);
    const bound = this.collectBoundResources(row.draftLayout);
    const now = new Date();
    const [updated] = await this.deps.db
      .update(statusPages)
      .set({ publishedLayout: row.draftLayout, publishedAt: now, updatedAt: now })
      .where(eq(statusPages.id, input.id))
      .returning();
    return { page: rowToPage(updated), exposed: bound };
  }

  async unpublish(id: string): Promise<StatusPage> {
    await this.requireRow(id);
    const [row] = await this.deps.db
      .update(statusPages)
      .set({ publishedLayout: null, publishedAt: null, updatedAt: new Date() })
      .where(eq(statusPages.id, id))
      .returning();
    return rowToPage(row);
  }

  // ----- Custom domain -----

  /**
   * Resolve a custom domain to its slug, or null. This is the read behind the
   * public-host resolver, so it gates on ALL of: `customDomainVerifiedAt` (DNS
   * ownership proven), `publishedAt` (there is a public snapshot), AND
   * `visibility === "public"`. Custom domains serve only PUBLIC pages: an
   * `authenticated` page has no way to sign in on its anonymous custom-domain
   * surface, and gating here avoids even leaking its slug via `/api/config`.
   *
   * The host is assumed already normalized by the platform registry (lowercased,
   * port-stripped); we lowercase again defensively. Registry results are cached
   * (~60s), so a freshly verified+published domain begins routing within that
   * window; conversely a REMOVED domain may keep serving its (already-public)
   * page for up to that window per pod.
   */
  async resolveByHost(host: string): Promise<{ slug: string } | null> {
    const normalized = host.trim().toLowerCase();
    if (normalized.length === 0) return null;
    const [row] = await this.deps.db
      .select({
        slug: statusPages.slug,
        visibility: statusPages.visibility,
        customDomainVerifiedAt: statusPages.customDomainVerifiedAt,
        publishedAt: statusPages.publishedAt,
      })
      .from(statusPages)
      .where(eq(statusPages.customDomain, normalized))
      .limit(1);
    if (
      !row ||
      row.customDomainVerifiedAt === null ||
      row.publishedAt === null ||
      row.visibility !== "public"
    ) {
      return null;
    }
    return { slug: row.slug };
  }

  /**
   * True when `host` is a CONFIGURED custom domain (some page claims it),
   * regardless of whether it is currently SERVABLE (verified + published +
   * public). Lets the platform serve a dedicated "not available" public page for
   * a known-but-not-live domain instead of falling through to the admin SPA.
   * Leaks only yes/no for the exact queried host - never the slug or page state.
   */
  async isConfiguredDomain(host: string): Promise<boolean> {
    const normalized = host.trim().toLowerCase();
    if (normalized.length === 0) return false;
    const [row] = await this.deps.db
      .select({ id: statusPages.id })
      .from(statusPages)
      .where(eq(statusPages.customDomain, normalized))
      .limit(1);
    return row !== undefined;
  }

  async setCustomDomain(input: {
    id: string;
    domain: string;
  }): Promise<StatusPage> {
    const existing = await this.requireRow(input.id);
    const domain = input.domain.trim().toLowerCase();
    const reserved = reservedDomainReason({
      domain,
      primaryHost: this.deps.primaryHost,
    });
    if (reserved) throw new ORPCError("BAD_REQUEST", { message: reserved });
    const [clash] = await this.deps.db
      .select({ id: statusPages.id })
      .from(statusPages)
      .where(eq(statusPages.customDomain, domain))
      .limit(1);
    if (clash && clash.id !== input.id) {
      throw new ORPCError("CONFLICT", {
        message: `The domain "${domain}" is already used by another status page.`,
      });
    }
    // No-op re-save of the SAME domain must NOT reset a proven verification (a
    // verified domain may be serving live visitors). Only a genuine domain
    // CHANGE issues a fresh token + clears verification, so the new host does not
    // route until ownership is re-proven via verifyCustomDomain.
    const domainChanged = existing.customDomain !== domain;
    const set: Partial<StatusPageRow> = {
      customDomain: domain,
      updatedAt: new Date(),
    };
    if (domainChanged || !existing.customDomainToken) {
      set.customDomainToken = `cs-verify-${crypto.randomUUID()}`;
    }
    if (domainChanged) {
      set.customDomainVerifiedAt = null;
    }
    const [row] = await this.deps.db
      .update(statusPages)
      .set(set)
      .where(eq(statusPages.id, input.id))
      .returning();
    return rowToPage(row);
  }

  async verifyCustomDomain(input: { id: string }): Promise<StatusPage> {
    const row = await this.requireRow(input.id);
    if (!row.customDomain || !row.customDomainToken) {
      throw new ORPCError("BAD_REQUEST", {
        message: "No custom domain is configured for this page.",
      });
    }
    const recordName = customDomainTxtRecordName(row.customDomain);
    const ok = await verifyDomainTxt({
      recordName,
      token: row.customDomainToken,
      resolveTxt: this.deps.txtResolver,
    });
    if (!ok) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          `No TXT record "${recordName}" with the expected value was found. ` +
          "DNS changes can take a few minutes to propagate; try again shortly.",
      });
    }
    const now = new Date();
    const [updated] = await this.deps.db
      .update(statusPages)
      .set({ customDomainVerifiedAt: now, updatedAt: now })
      .where(eq(statusPages.id, input.id))
      .returning();
    return rowToPage(updated);
  }

  async removeCustomDomain(input: { id: string }): Promise<StatusPage> {
    await this.requireRow(input.id);
    const [row] = await this.deps.db
      .update(statusPages)
      .set({
        customDomain: null,
        customDomainToken: null,
        customDomainVerifiedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(statusPages.id, input.id))
      .returning();
    return rowToPage(row);
  }

  async remove(id: string): Promise<boolean> {
    const deleted = await this.deps.db
      .delete(statusPages)
      .where(eq(statusPages.id, id))
      .returning({ id: statusPages.id });
    return deleted.length > 0;
  }

  listWidgetTypes(): WidgetTypeDescriptor[] {
    return this.deps.registry.list().map((w) => ({
      id: w.qualifiedId,
      displayName: w.displayName,
      description: w.description,
      category: w.category,
      binding: w.binding,
    }));
  }

  /**
   * "Cannot publish what you cannot see." For each widget that binds resources,
   * delegate the access check to the widget's own `assertBindingsReadable` (the
   * OWNING plugin knows how to verify its resource types). FAILS CLOSED: a
   * binding widget that provides no such check rejects the publish — the
   * platform never silently passes an unverifiable binding.
   */
  private async assertEditorCanAccess(
    userClient: RpcClient,
    layout: StatusPageLayout,
  ): Promise<void> {
    for (const block of layout) {
      const widget = this.deps.registry.get(block.type);
      if (!widget) continue;
      let binds: BoundResource[] = [];
      try {
        binds = widget.boundResources(block.config);
      } catch {
        binds = [];
      }
      if (binds.length === 0) continue;
      if (!widget.assertBindingsReadable) {
        throw new ORPCError("FORBIDDEN", {
          message:
            `The "${widget.displayName}" widget binds resources but provides ` +
            "no access check, so it cannot be published.",
        });
      }
      try {
        await widget.assertBindingsReadable({ userClient, config: block.config });
      } catch (error) {
        throw new ORPCError("FORBIDDEN", {
          message: extractErrorMessage(
            error,
            "You can only publish widgets bound to resources you can access.",
          ),
        });
      }
    }
  }

  /**
   * Resolve a PUBLISHED page for the public surface. Returns null when no page
   * matches, the page is unpublished, or its visibility excludes the caller —
   * never revealing that an unpublished/private page exists. Each block is
   * resolved via its widget's `resolvePublic` (trusted reads) and re-validated
   * against the widget's DTO schema, so only allow-listed fields are emitted; a
   * resolver error degrades that one block to `data: null`, never the page.
   */
  /**
   * Load a PUBLISHED page row (applying the same publish + visibility gate as
   * the public surface) and build the per-resolve widget context. Shared by
   * `resolvePublished` and the per-item detail resolvers so the ctx (memo,
   * trusted rpc client, published-environment scope) is built ONE way and can
   * never drift. Returns null when no page matches / is unpublished / the
   * visibility excludes the caller.
   */
  private loadPublishedForResolve(
    row: StatusPageRow,
  ): { ctx: WidgetResolveContext } {
    // Per-resolve memo so a page with many widgets shares expensive reads (e.g.
    // the full catalog) instead of re-fetching per widget on every public hit.
    const memo = new Map<string, Promise<unknown>>();
    const ctx: WidgetResolveContext = {
      rpcClient: this.deps.rpcClient,
      cache: <T,>(key: string, loader: () => Promise<T>): Promise<T> => {
        const existing = memo.get(key);
        if (existing) return existing as Promise<T>;
        const created = loader();
        memo.set(key, created);
        return created;
      },
      // Per-page environment scope (undefined = all envs). Threaded into every
      // widget resolve AND the subscribableSystems resolution below, so what the
      // page shows and what it offers for subscription agree by construction.
      publishedEnvironmentIds: effectivePublishedEnvironmentIds(row),
    };
    return { ctx };
  }

  private async loadPublishedRow(input: {
    slug: string;
    isAuthenticated: boolean;
  }): Promise<StatusPageRow | null> {
    const [row] = await this.deps.db
      .select()
      .from(statusPages)
      .where(eq(statusPages.slug, input.slug))
      .limit(1);
    if (!row || row.publishedLayout === null) return null;
    const visibility = rowVisibility(row);
    if (visibility === "authenticated" && !input.isAuthenticated) return null;
    return row;
  }

  async resolvePublished(input: {
    slug: string;
    isAuthenticated: boolean;
  }): Promise<PublishedStatusPage | null> {
    const row = await this.loadPublishedRow(input);
    if (!row || row.publishedLayout === null) return null;

    const { ctx } = this.loadPublishedForResolve(row);

    // Renderer remotes this page needs (third-party widgets only; built-ins are
    // bundled). Deduped by widget type so the public bundle loads each once.
    const remoteByType = new Map<string, string>();

    const blocks: ResolvedBlock[] = [];
    for (const block of row.publishedLayout) {
      const widget = this.deps.registry.get(block.type);
      if (!widget) continue;
      if (widget.rendererRemote) {
        remoteByType.set(block.type, widget.rendererRemote);
      }
      let data: unknown = null;
      try {
        const raw = await widget.resolvePublic({
          config: block.config,
          ctx,
        });
        data = widget.dtoSchema.parse(raw);
      } catch (error) {
        this.deps.logger.warn("Status page widget failed to resolve", {
          slug: row.slug,
          blockType: block.type,
          error: extractErrorMessage(error),
        });
        data = null;
      }
      blocks.push({
        id: block.id,
        type: block.type,
        ...(block.label === undefined ? {} : { label: block.label }),
        data,
      });
    }

    // The systems the subscribe form can offer a per-system scope for, resolved
    // from the SAME live scope source the fan-out uses (so the picker can never
    // offer a system the page does not surface). Only needed when the page
    // accepts subscriptions; skip the extra catalog reads otherwise.
    const subscribableSystems = row.emailSubscriptionsEnabled
      ? await resolveSubscribableSystems({
          layout: row.publishedLayout,
          registry: this.deps.registry,
          ctx,
          logger: this.deps.logger,
          slug: row.slug,
        })
      : [];

    return {
      slug: row.slug,
      title: row.title,
      theme: rowTheme(row),
      blocks,
      // Worst-status-wins rollup over the blocks we just resolved. Derived from
      // their public DTOs only (no domain reach-in), so the banner reflects
      // exactly what the page already shows.
      overallStatus: deriveOverallStatus({ blocks }),
      rendererRemotes: [...remoteByType].map(([widgetTypeId, packageName]) => ({
        widgetTypeId,
        packageName,
      })),
      emailSubscriptionsEnabled: row.emailSubscriptionsEnabled,
      subscribableSystems,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Public-safe FULL detail for a single item (incident / maintenance) on a
   * published page, for the dedicated detail page. GATED against enumeration /
   * IDOR the same way the block is: we iterate ONLY the published layout's
   * blocks of `widgetTypeId` and call each matching widget's `resolveDetail`,
   * which itself scope-checks the id against the block's live bound systems and
   * returns null for anything the block does not surface. So a detail page can
   * never reveal an item the page's own widget would not show. Unlike the block
   * (which caps the update timeline to `maxUpdates` and omits the long-form
   * description), `resolveDetail` returns the item with ALL its public updates
   * and its description - the whole point of the detail page (Items 4/5/6). The
   * returned value is the widget's own already-allow-listed DTO item, so no
   * internal field can leak. Returns null when the page does not exist / is not
   * visible / no block surfaces the id / the widget has no detail resolver.
   */
  private async resolvePublishedDetail<T>(input: {
    slug: string;
    id: string;
    isAuthenticated: boolean;
    widgetTypeId: string;
    itemSchema: z.ZodType<T>;
  }): Promise<T | null> {
    const row = await this.loadPublishedRow({
      slug: input.slug,
      isAuthenticated: input.isAuthenticated,
    });
    if (!row || row.publishedLayout === null) return null;
    const { ctx } = this.loadPublishedForResolve(row);
    for (const block of row.publishedLayout) {
      if (block.type !== input.widgetTypeId) continue;
      const widget = this.deps.registry.get(block.type);
      if (!widget?.resolveDetail) continue;
      let raw: unknown;
      try {
        raw = await widget.resolveDetail({
          id: input.id,
          config: block.config,
          ctx,
        });
      } catch (error) {
        this.deps.logger.warn("Status page detail widget failed to resolve", {
          slug: row.slug,
          blockType: block.type,
          error: extractErrorMessage(error),
        });
        continue;
      }
      if (raw === null) continue;
      // Validate against the widget's OWN item shape so the detail path fails
      // closed exactly like `resolvePublished` does for the block DTO.
      const parsed = input.itemSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    }
    return null;
  }

  /** Public-safe FULL detail for a single incident. See resolvePublishedDetail. */
  async resolvePublishedIncident(input: {
    slug: string;
    id: string;
    isAuthenticated: boolean;
  }): Promise<IncidentDtoItem | null> {
    return this.resolvePublishedDetail({
      ...input,
      widgetTypeId: BUILTIN_WIDGET_IDS.incidents,
      itemSchema: IncidentDtoItemSchema,
    });
  }

  /** Public-safe FULL detail for a single maintenance. See resolvePublishedDetail. */
  async resolvePublishedMaintenance(input: {
    slug: string;
    id: string;
    isAuthenticated: boolean;
  }): Promise<MaintenanceDtoItem | null> {
    return this.resolvePublishedDetail({
      ...input,
      widgetTypeId: BUILTIN_WIDGET_IDS.maintenance,
      itemSchema: MaintenanceDtoItemSchema,
    });
  }

  /**
   * Which of these cross-entity references does THIS published page surface?
   *
   * Backs mention resolution on a public page: an update saying "caused by
   * #Database upgrade" becomes a link to that maintenance's public detail page,
   * but only when the same page actually publishes it.
   *
   * The gate is deliberately the SAME one the detail page uses - a reference
   * resolves exactly when `resolveDetail` would return the item - so the link
   * can never lead somewhere the page would refuse to render. That closes the
   * confidentiality hole directly: an internal-only incident referenced from a
   * public update stays plain text, because no block on this page surfaces it.
   *
   * Which widget owns a mention type is declared BY the widget
   * ({@link WidgetTypeDefinition.mentionType}), so this stays ignorant of what
   * `"incident"` means.
   */
  async resolvePublicMentions(input: {
    slug: string;
    refs: Array<{ type: string; id: string }>;
    isAuthenticated: boolean;
  }): Promise<Array<{ type: string; id: string }>> {
    if (input.refs.length === 0) return [];

    const row = await this.loadPublishedRow({
      slug: input.slug,
      isAuthenticated: input.isAuthenticated,
    });
    if (!row || row.publishedLayout === null) return [];

    const { ctx } = this.loadPublishedForResolve(row);

    // De-duplicate first: one page can reference the same item from several
    // updates, and each distinct ref should cost at most one resolve.
    const seen = new Set<string>();
    const distinct = input.refs.filter((ref) => {
      const key = `${ref.type}/${ref.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const resolved = await Promise.all(
      distinct.map(async (ref) => {
        for (const block of row.publishedLayout ?? []) {
          const widget = this.deps.registry.get(block.type);
          if (!widget?.resolveDetail) continue;
          if (widget.mentionType !== ref.type) continue;

          try {
            const item = await widget.resolveDetail({
              id: ref.id,
              config: block.config,
              ctx,
            });
            if (item !== null) return ref;
          } catch (error) {
            // Same posture as `resolvePublishedDetail`: a failing widget makes
            // its references unlinkable, never accidentally linkable.
            this.deps.logger.warn(
              "Status page mention widget failed to resolve",
              {
                slug: row.slug,
                blockType: block.type,
                error: extractErrorMessage(error),
              },
            );
          }
        }
        return null;
      }),
    );

    return resolved.filter((ref) => ref !== null);
  }
}
