import { implement, ORPCError } from "@orpc/server";
import {
  announcementContract,
  ANNOUNCEMENT_UPDATED,
  type Announcement,
} from "@checkstack/announcement-common";
import type { SignalService } from "@checkstack/signal-common";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
  type RealUser,
} from "@checkstack/backend-api";
import type { SafeDatabase } from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import * as schema from "./schema";
import { eq, and, or, lte, gte, isNull, asc, inArray, sql } from "drizzle-orm";
import type { AnnouncementCache } from "./cache";

type AnnouncementDb = SafeDatabase<typeof schema>;

/**
 * Maps a database row to the Announcement domain type.
 */
function toAnnouncement(
  row: typeof schema.announcements.$inferSelect,
): Announcement {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    severity: row.severity as Announcement["severity"],
    visibility: row.visibility as Announcement["visibility"],
    displayMode: row.displayMode as Announcement["displayMode"],
    active: row.active,
    startsAt: row.startsAt ?? undefined,
    expiresAt: row.expiresAt ?? undefined,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Creates the announcement router using contract-based implementation.
 */
export function createAnnouncementRouter(
  db: AnnouncementDb,
  signalService: SignalService,
  cache: AnnouncementCache,
) {
  const os = implement(announcementContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return os.router({
    // -------------------------------------------------------------------------
    // Public: Get active announcements
    // -------------------------------------------------------------------------
    getActiveAnnouncements: os.getActiveAnnouncements.handler(
      async ({ input, context }) => {
        const includeDismissed = input?.includeDismissed ?? false;
        const user = context.user;
        const userId =
          user && "id" in user ? (user as RealUser).id : undefined;

        return cache.wrapActive({ userId, includeDismissed }, async () => {
          const now = new Date();

          // Active announcements + (for an authenticated caller) their
          // dismissals share ONE scoped transaction: a single SET LOCAL
          // search_path instead of two, with only in-memory filtering between.
          let announcements = await withScopedTransaction(db, async (tx) => {
            // Base query: active announcements within their time window
            const rows = await tx
              .select()
              .from(schema.announcements)
              .where(
                and(
                  eq(schema.announcements.active, true),
                  or(
                    isNull(schema.announcements.startsAt),
                    lte(schema.announcements.startsAt, now),
                  ),
                  or(
                    isNull(schema.announcements.expiresAt),
                    gte(schema.announcements.expiresAt, now),
                  ),
                ),
              )
              // Stable, operator-controlled order. createdAt + id break ties so
              // the sequence never shifts when an announcement is merely updated.
              .orderBy(
                asc(schema.announcements.sortOrder),
                asc(schema.announcements.createdAt),
                asc(schema.announcements.id),
              );

            let mapped = rows.map((row) => toAnnouncement(row));

            // If the caller is authenticated, filter out their dismissed
            // announcements (unless includeDismissed is explicitly requested,
            // e.g. for dashboard)
            if (!includeDismissed && userId !== undefined) {
              const dismissals = await tx
                .select({
                  announcementId: schema.announcementDismissals.announcementId,
                })
                .from(schema.announcementDismissals)
                .where(eq(schema.announcementDismissals.userId, userId));

              const dismissedIds = new Set(
                dismissals.map((d) => d.announcementId),
              );
              mapped = mapped.filter((a) => !dismissedIds.has(a.id));
            }

            return mapped;
          });

          // Filter visibility for unauthenticated users
          if (userId === undefined) {
            announcements = announcements.filter(
              (a) => a.visibility === "all",
            );
          }

          return { announcements };
        });
      },
    ),

    // -------------------------------------------------------------------------
    // Authenticated: Dismiss an announcement
    // -------------------------------------------------------------------------
    dismissAnnouncement: os.dismissAnnouncement.handler(
      async ({ input, context }) => {
        const userId = (context.user as RealUser).id;

        // Existence check + idempotent dismissal upsert share ONE scoped
        // transaction (single SET LOCAL search_path). A NOT_FOUND throw rolls
        // back with nothing written.
        await withScopedTransaction(db, async (tx) => {
          // Verify the announcement exists
          const existing = await tx
            .select({ id: schema.announcements.id })
            .from(schema.announcements)
            .where(eq(schema.announcements.id, input.announcementId))
            .limit(1);

          if (existing.length === 0) {
            throw new ORPCError("NOT_FOUND", {
              message: "Announcement not found",
            });
          }

          // Upsert dismissal (idempotent)
          await tx
            .insert(schema.announcementDismissals)
            .values({
              announcementId: input.announcementId,
              userId,
              dismissedAt: new Date(),
            })
            .onConflictDoNothing();
        });

        // Drop only this user's cache — other users' dismissals are unaffected.
        await cache.invalidateUserActive(userId);
      },
    ),

    // -------------------------------------------------------------------------
    // Admin: List all announcements
    // -------------------------------------------------------------------------
    listAllAnnouncements: os.listAllAnnouncements.handler(async () =>
      cache.wrapListAll(async () => {
        const rows = await db
          .select()
          .from(schema.announcements)
          .orderBy(
            asc(schema.announcements.sortOrder),
            asc(schema.announcements.createdAt),
            asc(schema.announcements.id),
          );

        return { announcements: rows.map((row) => toAnnouncement(row)) };
      }),
    ),

    // -------------------------------------------------------------------------
    // Admin: Create announcement
    // -------------------------------------------------------------------------
    createAnnouncement: os.createAnnouncement.handler(
      async ({ input, context }) => {
        const userId =
          context.user && "id" in context.user ? context.user.id : "system";
        const id = crypto.randomUUID();
        const now = new Date();

        // Append new announcements at the end of the operator's ordering. The
        // max(sortOrder) read + the insert share ONE scoped transaction: a
        // single SET LOCAL search_path, and the read-then-insert race on
        // sortOrder is closed by construction.
        const row = await withScopedTransaction(db, async (tx) => {
          const [maxRow] = await tx
            .select({
              maxOrder: sql<
                number | null
              >`max(${schema.announcements.sortOrder})`,
            })
            .from(schema.announcements);
          const nextSortOrder = (maxRow?.maxOrder ?? -1) + 1;

          const [inserted] = await tx
            .insert(schema.announcements)
            .values({
              id,
              title: input.title,
              message: input.message,
              severity: input.severity,
              visibility: input.visibility,
              displayMode: input.displayMode,
              active: input.active ?? true,
              sortOrder: nextSortOrder,
              startsAt: input.startsAt ?? undefined,
              expiresAt: input.expiresAt ?? undefined,
              createdBy: userId,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          return inserted;
        });

        const announcement = toAnnouncement(row);

        await Promise.all([
          cache.invalidateAllActive(),
          cache.invalidateListAll(),
        ]);

        await signalService.broadcast(ANNOUNCEMENT_UPDATED, {
          announcementId: announcement.id,
          action: "created",
        });

        return announcement;
      },
    ),

    // -------------------------------------------------------------------------
    // Admin: Update announcement
    // -------------------------------------------------------------------------
    updateAnnouncement: os.updateAnnouncement.handler(async ({ input }) => {
      const { id, ...updates } = input;

      // Build update object, only including provided fields
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (updates.title !== undefined) updateData.title = updates.title;
      if (updates.message !== undefined) updateData.message = updates.message;
      if (updates.severity !== undefined) updateData.severity = updates.severity;
      if (updates.visibility !== undefined)
        updateData.visibility = updates.visibility;
      if (updates.displayMode !== undefined)
        updateData.displayMode = updates.displayMode;
      if (updates.active !== undefined) updateData.active = updates.active;
      if (updates.startsAt !== undefined) updateData.startsAt = updates.startsAt;
      if (updates.expiresAt !== undefined)
        updateData.expiresAt = updates.expiresAt;

      const [row] = await db
        .update(schema.announcements)
        .set(updateData)
        .where(eq(schema.announcements.id, id))
        .returning();

      if (!row) {
        throw new ORPCError("NOT_FOUND", {
          message: "Announcement not found",
        });
      }

      const announcement = toAnnouncement(row);

      await Promise.all([
        cache.invalidateAllActive(),
        cache.invalidateListAll(),
      ]);

      await signalService.broadcast(ANNOUNCEMENT_UPDATED, {
        announcementId: announcement.id,
        action: "updated",
      });

      return announcement;
    }),

    // -------------------------------------------------------------------------
    // Admin: Delete announcement
    // -------------------------------------------------------------------------
    deleteAnnouncement: os.deleteAnnouncement.handler(async ({ input }) => {
      const result = await db
        .delete(schema.announcements)
        .where(eq(schema.announcements.id, input.id))
        .returning({ id: schema.announcements.id });

      if (result.length > 0) {
        await Promise.all([
          cache.invalidateAllActive(),
          cache.invalidateListAll(),
        ]);

        await signalService.broadcast(ANNOUNCEMENT_UPDATED, {
          announcementId: input.id,
          action: "deleted",
        });
      }

      return { success: result.length > 0 };
    }),

    // -------------------------------------------------------------------------
    // Admin: Reorder announcements
    // -------------------------------------------------------------------------
    reorderAnnouncements: os.reorderAnnouncements.handler(async ({ input }) => {
      const { orderedIds } = input;

      // Write the new position for every listed id in a single atomic UPDATE:
      // sort_order = index of the id in `orderedIds`. A CASE keeps it to one
      // statement (no partial reorder on failure); ids not listed are untouched.
      const whenClauses = orderedIds.map(
        (id, index) =>
          sql`when ${schema.announcements.id} = ${id} then ${index}`,
      );
      const sortOrderCase = sql`case ${sql.join(whenClauses, sql` `)} else ${schema.announcements.sortOrder} end`;

      await db
        .update(schema.announcements)
        .set({ sortOrder: sortOrderCase })
        .where(inArray(schema.announcements.id, orderedIds));

      await Promise.all([
        cache.invalidateAllActive(),
        cache.invalidateListAll(),
      ]);

      await signalService.broadcast(ANNOUNCEMENT_UPDATED, {
        announcementId: orderedIds[0],
        action: "reordered",
      });

      return { success: true };
    }),
  });
}

export type AnnouncementRouter = ReturnType<typeof createAnnouncementRouter>;
