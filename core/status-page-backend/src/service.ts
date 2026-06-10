import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { extractErrorMessage } from "@checkstack/common";
import type { SafeDatabase, RpcClient, Logger } from "@checkstack/backend-api";
import { CatalogApi } from "@checkstack/catalog-common";
import {
  StatusPageVisibilitySchema,
  StatusPageThemeSchema,
  type StatusPage,
  type StatusPageSummary,
  type StatusPageLayout,
  type StatusPageTheme,
  type StatusPageVisibility,
  type PublishedStatusPage,
  type ResolvedBlock,
  type WidgetTypeDescriptor,
} from "@checkstack/status-page-common";
import * as schema from "./schema";
import { statusPages, type StatusPageRow } from "./schema";
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
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SYSTEM_TYPE = "catalog.system";
const GROUP_TYPE = "catalog.group";

function forbidden(message: string): never {
  throw new ORPCError("FORBIDDEN", { message });
}

export interface StatusPageServiceDeps {
  db: Db;
  registry: WidgetTypeRegistry;
  /** Trusted service client for the public resolver (reads bound resources). */
  rpcClient: RpcClient;
  logger: Logger;
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
    const bound = this.collectBoundResources(row.draftLayout);
    await this.assertEditorCanAccess(input.userClient, bound);
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
   * "Cannot publish what you cannot see." Verifies, AS THE USER, that the editor
   * can read every resource the page's widgets bind. FAILS CLOSED: a bound
   * resource type this gate does not know how to verify rejects the publish
   * (rather than silently passing). Bound GROUPS are expanded to their member
   * systems — a group can be visible while containing systems the editor cannot
   * read, which the group widget would otherwise expose.
   */
  private async assertEditorCanAccess(
    userClient: RpcClient,
    bound: BoundResource[],
  ): Promise<void> {
    const known = new Set([SYSTEM_TYPE, GROUP_TYPE]);
    const unknown = bound.find((b) => !known.has(b.resourceType));
    if (unknown) {
      forbidden(
        `Cannot verify publish access for resource type "${unknown.resourceType}". ` +
          "Remove that widget, or register an access verifier for its type.",
      );
    }

    const catalog = userClient.forPlugin(CatalogApi);
    const systemIds = new Set(
      bound.filter((b) => b.resourceType === SYSTEM_TYPE).map((b) => b.resourceId),
    );
    const groupIds = [
      ...new Set(
        bound.filter((b) => b.resourceType === GROUP_TYPE).map((b) => b.resourceId),
      ),
    ];
    if (groupIds.length > 0) {
      const groups = await catalog.getGroups().catch(() => []);
      const byId = new Map(groups.map((g) => [g.id, g]));
      for (const groupId of groupIds) {
        const group = byId.get(groupId);
        if (!group) {
          forbidden(
            "You can only publish widgets bound to groups you can access.",
          );
          continue;
        }
        for (const systemId of group.systemIds) systemIds.add(systemId);
      }
    }
    for (const systemId of systemIds) {
      const system = await catalog.getSystem({ systemId }).catch(() => null);
      if (!system) {
        forbidden(
          "You can only publish widgets bound to systems you can access. " +
            "Remove the inaccessible system (or group member), or ask for access.",
        );
      }
    }
  }

  /** All systems' id -> name (trusted read; memoized per resolve by the caller). */
  private async loadSystemNames(): Promise<Map<string, string>> {
    const { systems } = await this.deps.rpcClient
      .forPlugin(CatalogApi)
      .getSystems();
    return new Map(systems.map((s) => [s.id, s.name]));
  }

  /** All catalog groups (trusted read; memoized per resolve by the caller). */
  private async loadGroups(): Promise<
    Array<{ id: string; name: string; systemIds: string[] }>
  > {
    const groups = await this.deps.rpcClient.forPlugin(CatalogApi).getGroups();
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      systemIds: g.systemIds,
    }));
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

    // Memoize the full-catalog reads ONCE per page resolve, so a page with many
    // widgets doesn't re-scan the catalog per widget on every public request.
    let systemNamesCache: Promise<Map<string, string>> | undefined;
    let groupsCache:
      | Promise<Array<{ id: string; name: string; systemIds: string[] }>>
      | undefined;
    const ctx: WidgetResolveContext = {
      rpcClient: this.deps.rpcClient,
      systemNames: () => (systemNamesCache ??= this.loadSystemNames()),
      groups: () => (groupsCache ??= this.loadGroups()),
    };

    const blocks: ResolvedBlock[] = [];
    for (const block of row.publishedLayout) {
      const widget = this.deps.registry.get(block.type);
      if (!widget) continue;
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
      generatedAt: new Date().toISOString(),
    };
  }
}
