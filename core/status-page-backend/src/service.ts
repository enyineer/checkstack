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
  type CustomDomainInfo,
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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

  async create(input: { title: string; slug: string }): Promise<StatusPage> {
    await this.assertSlugFree(input.slug);
    const [row] = await this.deps.db
      .insert(statusPages)
      .values({ title: input.title, slug: input.slug })
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
  }): Promise<StatusPage> {
    await this.requireRow(input.id);
    if (input.slug !== undefined) await this.assertSlugFree(input.slug, input.id);
    const set: Partial<StatusPageRow> = { updatedAt: new Date() };
    if (input.title !== undefined) set.title = input.title;
    if (input.slug !== undefined) set.slug = input.slug;
    if (input.visibility !== undefined) set.visibility = input.visibility;
    if (input.theme !== undefined) set.theme = input.theme;
    if (input.draftLayout !== undefined) set.draftLayout = input.draftLayout;
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

  async setCustomDomain(input: {
    id: string;
    domain: string;
  }): Promise<StatusPage> {
    await this.requireRow(input.id);
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
    // New domain (or re-set) starts unverified with a fresh token, so it does
    // not route until ownership is proven via verifyCustomDomain.
    const token = `cs-verify-${crypto.randomUUID()}`;
    const [row] = await this.deps.db
      .update(statusPages)
      .set({
        customDomain: domain,
        customDomainToken: token,
        customDomainVerifiedAt: null,
        updatedAt: new Date(),
      })
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
  async resolvePublished(input: {
    slug: string;
    isAuthenticated: boolean;
  }): Promise<PublishedStatusPage | null> {
    const [row] = await this.deps.db
      .select()
      .from(statusPages)
      .where(eq(statusPages.slug, input.slug))
      .limit(1);
    if (!row || row.publishedLayout === null) return null;
    const visibility = rowVisibility(row);
    if (visibility === "authenticated" && !input.isAuthenticated) return null;

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
    };

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

    return {
      slug: row.slug,
      title: row.title,
      theme: rowTheme(row),
      blocks,
      rendererRemotes: [...remoteByType].map(([widgetTypeId, packageName]) => ({
        widgetTypeId,
        packageName,
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
