import { eq, and, or, ne, inArray, desc, isNotNull, lte, gte } from "drizzle-orm";
import { withScopedTransaction } from "@checkstack/backend-api";
import type {
  SafeDatabase,
  ScopedQueryRunner,
} from "@checkstack/backend-api";
import * as schema from "./schema";
import {
  maintenances,
  maintenanceSystems,
  maintenanceUpdates,
  maintenanceLinks,
} from "./schema";
import type {
  MaintenanceWithSystems,
  MaintenanceDetail,
  MaintenanceUpdate,
  MaintenanceLink,
  AddMaintenanceLinkInput,
  UpdateMaintenanceLinkInput,
  CreateMaintenanceInput,
  UpdateMaintenanceInput,
  AddMaintenanceUpdateInput,
  EditMaintenanceUpdateInput,
  MaintenanceStatus,
  MaintenanceUpdateEditSnapshot,
} from "@checkstack/maintenance-common";

type Db = SafeDatabase<typeof schema>;

/** The transaction handle drizzle hands to `db.transaction(async (tx) => ...)`. */
type MaintenanceTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Derive a maintenance's header status from its timeline: the `statusChange` of
 * the MOST RECENT status-bearing update (message-only updates are ignored), so
 * the header always follows the newest update that actually declared a status.
 * Returns undefined when no update carries a status. Runs on the passed `tx` so
 * an edit/delete re-derivation is atomic with the write that triggered it.
 * Centralized so `editUpdate` and `deleteUpdate` can never diverge on how
 * "current status" is resolved.
 */
async function deriveStatusFromTimeline(
  tx: MaintenanceTx,
  maintenanceId: string,
): Promise<MaintenanceStatus | undefined> {
  const [latest] = await tx
    .select({ statusChange: maintenanceUpdates.statusChange })
    .from(maintenanceUpdates)
    .where(
      and(
        eq(maintenanceUpdates.maintenanceId, maintenanceId),
        isNotNull(maintenanceUpdates.statusChange),
      ),
    )
    .orderBy(desc(maintenanceUpdates.createdAt), desc(maintenanceUpdates.id))
    .limit(1);
  return latest?.statusChange ?? undefined;
}

export class MaintenanceService {
  constructor(private db: Db) {}

  /**
   * Read the system associations for a set of maintenance ids in ONE set-based
   * `inArray` query and group them by maintenanceId. Runs on the passed runner
   * (the scoped db OR a batching `tx`), so callers that already hold a
   * transaction reuse its single `SET LOCAL search_path`. Replaces the former
   * per-row N+1 loop used by the list/for-system reads.
   */
  private async getSystemsByMaintenance(
    runner: ScopedQueryRunner<typeof schema>,
    maintenanceIds: string[],
  ): Promise<Map<string, string[]>> {
    const byMaintenance = new Map<string, string[]>();
    if (maintenanceIds.length === 0) return byMaintenance;

    const systemRows = await runner
      .select({
        maintenanceId: maintenanceSystems.maintenanceId,
        systemId: maintenanceSystems.systemId,
      })
      .from(maintenanceSystems)
      .where(inArray(maintenanceSystems.maintenanceId, maintenanceIds));

    for (const r of systemRows) {
      const list = byMaintenance.get(r.maintenanceId);
      if (list) list.push(r.systemId);
      else byMaintenance.set(r.maintenanceId, [r.systemId]);
    }
    return byMaintenance;
  }

  /**
   * List maintenances with optional filters
   */
  async listMaintenances(filters?: {
    status?: MaintenanceStatus;
    systemId?: string;
    includeCompleted?: boolean;
  }): Promise<MaintenanceWithSystems[]> {
    // Mirrors the incident plugin's `includeResolved`: an explicit `status`
    // filter wins; otherwise completed maintenances are hidden unless
    // `includeCompleted` is set, so the default list shows only active /
    // upcoming windows.
    const statusFilter = filters?.status
      ? eq(maintenances.status, filters.status)
      : filters?.includeCompleted
        ? undefined
        : ne(maintenances.status, "completed");

    // One SET LOCAL for the whole read fan-out. System associations are fetched
    // in a SINGLE set-based `inArray` query and grouped in JS, instead of the
    // former per-row N+1 loop (mirrors `getManyEntityStates`).
    return withScopedTransaction(this.db, async (tx) => {
      let maintenanceRows;

      if (filters?.systemId) {
        // Filter by system - need to join
        const systemMaintenanceIds = await tx
          .select({ maintenanceId: maintenanceSystems.maintenanceId })
          .from(maintenanceSystems)
          .where(eq(maintenanceSystems.systemId, filters.systemId));

        const ids = systemMaintenanceIds.map((r) => r.maintenanceId);
        if (ids.length === 0) return [];

        maintenanceRows = await tx
          .select()
          .from(maintenances)
          .where(and(inArray(maintenances.id, ids), statusFilter));
      } else {
        maintenanceRows = await tx
          .select()
          .from(maintenances)
          .where(statusFilter);
      }

      if (maintenanceRows.length === 0) return [];

      const systemsByMaintenance = await this.getSystemsByMaintenance(
        tx,
        maintenanceRows.map((m) => m.id),
      );

      return maintenanceRows.map((m) => ({
        ...m,
        description: m.description ?? undefined,
        systemIds: systemsByMaintenance.get(m.id) ?? [],
      }));
    });
  }

  /**
   * Get single maintenance with full details
   */
  async getMaintenance(id: string): Promise<MaintenanceDetail | undefined> {
    // Batch the 4 sequential reads (maintenance -> systems -> updates -> links)
    // behind a single `SET LOCAL search_path`.
    return withScopedTransaction(this.db, async (tx) => {
      const [maintenance] = await tx
        .select()
        .from(maintenances)
        .where(eq(maintenances.id, id));

      if (!maintenance) return;

      const systems = await tx
        .select({ systemId: maintenanceSystems.systemId })
        .from(maintenanceSystems)
        .where(eq(maintenanceSystems.maintenanceId, id));

      const updates = await tx
        .select()
        .from(maintenanceUpdates)
        .where(eq(maintenanceUpdates.maintenanceId, id));

      const links = await tx
        .select()
        .from(maintenanceLinks)
        .where(eq(maintenanceLinks.maintenanceId, id));

      return {
        ...maintenance,
        description: maintenance.description ?? undefined,
        systemIds: systems.map((s) => s.systemId),
        updates: updates.map((u) => ({
          ...u,
          statusChange: u.statusChange ?? undefined,
          editedAt: u.editedAt ?? undefined,
          editHistory: u.editHistory ?? [],
          createdBy: u.createdBy ?? undefined,
        })),
        links,
      };
    });
  }

  /**
   * Bulk read of each maintenance's FULL update timeline (all visibilities),
   * keyed by maintenance id, in ONE set-based `inArray` query grouped in JS -
   * instead of an N+1 fan-out of {@link getMaintenance} the status-page widget
   * used purely for `.updates`. Returns the same raw update shape
   * `getMaintenance` produces; the ROUTER applies audience filtering + name
   * resolution on top, so no visibility policy lives here. Maintenances with no
   * updates are omitted.
   */
  async getBulkMaintenanceUpdates(
    maintenanceIds: string[],
  ): Promise<Record<string, MaintenanceUpdate[]>> {
    if (maintenanceIds.length === 0) return {};

    const rows = await withScopedTransaction(this.db, (tx) =>
      tx
        .select()
        .from(maintenanceUpdates)
        .where(inArray(maintenanceUpdates.maintenanceId, maintenanceIds)),
    );

    const out: Record<string, MaintenanceUpdate[]> = {};
    for (const u of rows) {
      const mapped: MaintenanceUpdate = {
        ...u,
        statusChange: u.statusChange ?? undefined,
        editedAt: u.editedAt ?? undefined,
        editHistory: u.editHistory ?? [],
        createdBy: u.createdBy ?? undefined,
      };
      const list = out[u.maintenanceId];
      if (list) list.push(mapped);
      else out[u.maintenanceId] = [mapped];
    }
    return out;
  }

  /**
   * Get active/upcoming maintenances for a system
   */
  async getMaintenancesForSystem(
    systemId: string,
  ): Promise<MaintenanceWithSystems[]> {
    return withScopedTransaction(this.db, async (tx) => {
      // Get maintenance IDs for this system
      const systemMaintenances = await tx
        .select({ maintenanceId: maintenanceSystems.maintenanceId })
        .from(maintenanceSystems)
        .where(eq(maintenanceSystems.systemId, systemId));

      const ids = systemMaintenances.map((r) => r.maintenanceId);
      if (ids.length === 0) return [];

      // Get only scheduled or in_progress maintenances ending in the future
      const rows = await tx
        .select()
        .from(maintenances)
        .where(
          and(
            inArray(maintenances.id, ids),
            or(
              eq(maintenances.status, "scheduled"),
              eq(maintenances.status, "in_progress"),
            ),
          ),
        );
      if (rows.length === 0) return [];

      // Fetch the full system membership for all matched maintenances in ONE
      // set-based query (was a per-row N+1 loop).
      const systemsByMaintenance = await this.getSystemsByMaintenance(
        tx,
        rows.map((m) => m.id),
      );

      return rows.map((m) => ({
        ...m,
        description: m.description ?? undefined,
        systemIds: systemsByMaintenance.get(m.id) ?? [],
      }));
    });
  }

  /**
   * Batched reactive-state read for the `maintenance` entity (Model B
   * plugin-backed `read` accessor). Given maintenance ids, return the
   * reactive subset `{ status, systemIds, startAt, endAt }` for each that
   * exists (missing ids omitted). Reads the AUTHORITATIVE `maintenances` +
   * `maintenance_systems` tables — no framework `entity_state` storage. This
   * is the single source of truth `handle.mutate` snapshots `prev` from and
   * `get`/`getMany`/scope enrichment route through. `startAt`/`endAt` are
   * serialized to ISO strings to match the entity state schema.
   */
  async getManyEntityStates(
    ids: ReadonlyArray<string>,
  ): Promise<
    Record<
      string,
      {
        status: MaintenanceStatus;
        systemIds: string[];
        startAt: string;
        endAt: string;
      }
    >
  > {
    if (ids.length === 0) return {};

    // Batch the maintenances read + junction read behind a single `SET LOCAL`.
    return withScopedTransaction(this.db, async (tx) => {
      const rows = await tx
        .select({
          id: maintenances.id,
          status: maintenances.status,
          startAt: maintenances.startAt,
          endAt: maintenances.endAt,
        })
        .from(maintenances)
        .where(inArray(maintenances.id, [...ids]));
      if (rows.length === 0) return {};

      const systemsByMaintenance = await this.getSystemsByMaintenance(
        tx,
        rows.map((r) => r.id),
      );

      const out: Record<
        string,
        {
          status: MaintenanceStatus;
          systemIds: string[];
          startAt: string;
          endAt: string;
        }
      > = {};
      for (const row of rows) {
        out[row.id] = {
          status: row.status,
          systemIds: systemsByMaintenance.get(row.id) ?? [],
          startAt: row.startAt.toISOString(),
          endAt: row.endAt.toISOString(),
        };
      }
      return out;
    });
  }

  /**
   * Create a new maintenance.
   *
   * `id` may be supplied by the caller so the reactive `maintenance` entity
   * can be keyed on a known id BEFORE the insert runs (the create's `prev`
   * snapshot must read the not-yet-existing row as absent — see §10.2). When
   * omitted, a fresh id is generated. The id is server-owned either way.
   */
  async createMaintenance(
    input: CreateMaintenanceInput,
    id: string = generateId(),
  ): Promise<MaintenanceWithSystems> {
    // Atomic: the maintenance row and its system associations must commit
    // together. Without the transaction a failure mid-loop left a committed
    // maintenance with only some (or none) of its system links.
    await this.db.transaction(async (tx) => {
      await tx.insert(maintenances).values({
        id,
        title: input.title,
        description: input.description,
        suppressNotifications: input.suppressNotifications ?? false,
        status: "scheduled",
        startAt: input.startAt,
        endAt: input.endAt,
      });

      // Insert system associations
      for (const systemId of input.systemIds) {
        await tx.insert(maintenanceSystems).values({
          maintenanceId: id,
          systemId,
        });
      }
    });

    return (await this.getMaintenance(id))!;
  }

  /**
   * Update an existing maintenance
   */
  async updateMaintenance(
    input: UpdateMaintenanceInput,
  ): Promise<MaintenanceWithSystems | undefined> {
    const [existing] = await this.db
      .select()
      .from(maintenances)
      .where(eq(maintenances.id, input.id));

    if (!existing) return undefined;

    // Build update object
    const updateData: Partial<typeof maintenances.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined)
      updateData.description = input.description;
    if (input.suppressNotifications !== undefined)
      updateData.suppressNotifications = input.suppressNotifications;
    if (input.startAt !== undefined) updateData.startAt = input.startAt;
    if (input.endAt !== undefined) updateData.endAt = input.endAt;

    // Atomic: the field update and the delete-then-reinsert of system links must
    // commit together. Without the transaction a failure after the delete left
    // the maintenance with ALL system associations wiped.
    await this.db.transaction(async (tx) => {
      await tx
        .update(maintenances)
        .set(updateData)
        .where(eq(maintenances.id, input.id));

      // Update system associations if provided
      if (input.systemIds !== undefined) {
        await tx
          .delete(maintenanceSystems)
          .where(eq(maintenanceSystems.maintenanceId, input.id));

        for (const systemId of input.systemIds) {
          await tx.insert(maintenanceSystems).values({
            maintenanceId: input.id,
            systemId,
          });
        }
      }
    });

    return (await this.getMaintenance(input.id))!;
  }

  /**
   * Add a status update to a maintenance
   */
  async addUpdate(
    input: AddMaintenanceUpdateInput,
    userId?: string,
  ): Promise<MaintenanceUpdate> {
    const id = generateId();

    // Atomic: the status flip and the timeline entry that records it must commit
    // together (status/timeline divergence otherwise). The inserted row is
    // returned via `.returning()`, removing the former post-commit re-select.
    const update = await this.db.transaction(async (tx) => {
      // If status change is provided, update the maintenance status
      if (input.statusChange) {
        await tx
          .update(maintenances)
          .set({ status: input.statusChange, updatedAt: new Date() })
          .where(eq(maintenances.id, input.maintenanceId));
      }

      const [inserted] = await tx
        .insert(maintenanceUpdates)
        .values({
          id,
          maintenanceId: input.maintenanceId,
          message: input.message,
          statusChange: input.statusChange,
          visibility: input.visibility ?? "public",
          createdBy: userId,
        })
        .returning();
      return inserted;
    });

    return {
      ...update,
      statusChange: update.statusChange ?? undefined,
      editedAt: update.editedAt ?? undefined,
      editHistory: update.editHistory ?? [],
      createdBy: update.createdBy ?? undefined,
    };
  }

  /**
   * Edit a published update in place. Scoped by `maintenanceId` (mirrors
   * `removeLink`). Only the provided fields change. When any field actually
   * changes, the CURRENT values are archived into `editHistory` (oldest first)
   * and `editedAt` is stamped, so the timeline can show a GitHub-style history
   * of edits. A no-op edit (nothing changed) neither archives a snapshot nor
   * marks the update "edited".
   *
   * When the edit touches `statusChange` OR re-times the update (`createdAt`),
   * the maintenance's own `status` is re-derived from the most recent
   * status-bearing update (see {@link deriveStatusFromTimeline}) so the header
   * and timeline never diverge - including the edge case where the latest row is
   * message-only and the header must follow an earlier status-bearing update,
   * and the case where re-timing changes which update is latest.
   */
  async editUpdate(
    input: EditMaintenanceUpdateInput,
  ): Promise<MaintenanceUpdate | undefined> {
    const [existing] = await this.db
      .select()
      .from(maintenanceUpdates)
      .where(
        and(
          eq(maintenanceUpdates.id, input.id),
          eq(maintenanceUpdates.maintenanceId, input.maintenanceId),
        ),
      );
    if (!existing) return undefined;

    // Only fields that actually differ count as a change; the edit form always
    // re-sends message/status/visibility, so a bare save must not manufacture a
    // spurious "edited" marker or history entry.
    const messageChanged =
      input.message !== undefined && input.message !== existing.message;
    const statusChanged =
      input.statusChange !== undefined &&
      (input.statusChange ?? null) !== (existing.statusChange ?? null);
    const visibilityChanged =
      input.visibility !== undefined && input.visibility !== existing.visibility;
    const createdAtChanged =
      input.createdAt !== undefined &&
      input.createdAt.getTime() !== existing.createdAt.getTime();
    const contentChanged =
      messageChanged || statusChanged || visibilityChanged || createdAtChanged;

    const now = new Date();
    const updateData: Partial<typeof maintenanceUpdates.$inferInsert> = {};
    if (input.message !== undefined) updateData.message = input.message;
    if (input.statusChange !== undefined)
      updateData.statusChange = input.statusChange;
    if (input.visibility !== undefined)
      updateData.visibility = input.visibility;
    if (input.createdAt !== undefined) updateData.createdAt = input.createdAt;

    if (contentChanged) {
      updateData.editedAt = now;
      // Archive the pre-edit version (oldest first). Timestamps are ISO strings
      // so the jsonb payload round-trips through JSON cleanly.
      const snapshot: MaintenanceUpdateEditSnapshot = {
        message: existing.message,
        statusChange: existing.statusChange ?? undefined,
        visibility: existing.visibility,
        createdAt: existing.createdAt.toISOString(),
        editedAt: now.toISOString(),
      };
      updateData.editHistory = [...(existing.editHistory ?? []), snapshot];
    }

    // Nothing provided to change: return the current row untouched (a bare
    // `.set({})` would throw), leaving `editedAt`/`editHistory` as they were.
    if (Object.keys(updateData).length === 0) {
      return {
        ...existing,
        statusChange: existing.statusChange ?? undefined,
        editedAt: existing.editedAt ?? undefined,
        editHistory: existing.editHistory ?? [],
        createdBy: existing.createdBy ?? undefined,
      };
    }

    const update = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(maintenanceUpdates)
        .set(updateData)
        .where(
          and(
            eq(maintenanceUpdates.id, input.id),
            eq(maintenanceUpdates.maintenanceId, input.maintenanceId),
          ),
        )
        .returning();

      // Re-derive the header from the most recent status-bearing update
      // whenever the edit touched a status OR re-timed the update. This handles
      // editing a non-latest update (header keeps the newest status), the
      // message-only latest edge case (header follows the prior status-bearing
      // update), AND a re-time that changes which update is latest.
      if (input.statusChange !== undefined || createdAtChanged) {
        const derived = await deriveStatusFromTimeline(tx, input.maintenanceId);
        if (derived) {
          await tx
            .update(maintenances)
            .set({ status: derived, updatedAt: new Date() })
            .where(eq(maintenances.id, input.maintenanceId));
        }
      }
      return updated;
    });

    return {
      ...update,
      statusChange: update.statusChange ?? undefined,
      editedAt: update.editedAt ?? undefined,
      editHistory: update.editHistory ?? [],
      createdBy: update.createdBy ?? undefined,
    };
  }

  /**
   * Delete a published update. Scoped by `maintenanceId` (mirrors `removeLink`).
   * Returns the parent maintenanceId so the caller can invalidate caches, or
   * undefined if the update did not exist under that maintenance.
   *
   * When the deleted update CARRIED a status, the maintenance's `status` is
   * re-derived from the remaining timeline in the SAME transaction (see
   * {@link deriveStatusFromTimeline}) so deleting the latest status-bearing
   * update never leaves the header pinned to a now-gone status. A message-only
   * delete can never change the derived status, so it skips the re-derivation.
   * If no status-bearing update remains, the status is left intact (deletion is
   * irreversible; we never null a status the header still needs).
   */
  async deleteUpdate(
    id: string,
    maintenanceId: string,
  ): Promise<string | undefined> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(maintenanceUpdates)
        .where(
          and(
            eq(maintenanceUpdates.id, id),
            eq(maintenanceUpdates.maintenanceId, maintenanceId),
          ),
        );
      if (!existing) return;

      await tx
        .delete(maintenanceUpdates)
        .where(
          and(
            eq(maintenanceUpdates.id, id),
            eq(maintenanceUpdates.maintenanceId, maintenanceId),
          ),
        );

      if (existing.statusChange !== null) {
        const derived = await deriveStatusFromTimeline(tx, maintenanceId);
        if (derived) {
          await tx
            .update(maintenances)
            .set({ status: derived, updatedAt: new Date() })
            .where(eq(maintenances.id, maintenanceId));
        }
      }

      return existing.maintenanceId;
    });
  }

  /**
   * Close a maintenance early
   */
  async closeMaintenance(
    id: string,
    message?: string,
    userId?: string,
  ): Promise<MaintenanceWithSystems | undefined> {
    const [existing] = await this.db
      .select()
      .from(maintenances)
      .where(eq(maintenances.id, id));

    if (!existing) return undefined;

    // Atomic: mark completed + write the closing timeline entry together.
    await this.db.transaction(async (tx) => {
      await tx
        .update(maintenances)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(maintenances.id, id));

      // Add update entry
      await tx.insert(maintenanceUpdates).values({
        id: generateId(),
        maintenanceId: id,
        message: message ?? "Maintenance completed early",
        statusChange: "completed",
        createdBy: userId,
      });
    });

    return (await this.getMaintenance(id))!;
  }

  /**
   * Delete a maintenance
   */
  async deleteMaintenance(id: string): Promise<boolean> {
    const [existing] = await this.db
      .select()
      .from(maintenances)
      .where(eq(maintenances.id, id));

    if (!existing) return false;

    // Cascade delete handles junctions and updates
    await this.db.delete(maintenances).where(eq(maintenances.id, id));
    return true;
  }

  /**
   * Add a hotlink to a maintenance.
   */
  async addLink(input: AddMaintenanceLinkInput): Promise<MaintenanceLink> {
    const id = generateId();
    // `.returning()` yields the inserted row directly, removing the former
    // standalone re-select (one query instead of two).
    const [row] = await this.db
      .insert(maintenanceLinks)
      .values({
        id,
        maintenanceId: input.maintenanceId,
        label: input.label,
        url: input.url,
        visibility: input.visibility ?? "public",
      })
      .returning();
    return row;
  }

  /**
   * Edit a hotlink in place. Scoped by `maintenanceId` (anti-spoof, mirrors
   * `removeLink`): a link belonging to a different maintenance cannot be edited
   * by pairing its id with a maintenance the caller manages. Only the provided
   * fields change; returns the updated row, or undefined if the pair did not
   * match.
   */
  async updateLink(
    input: UpdateMaintenanceLinkInput,
  ): Promise<MaintenanceLink | undefined> {
    const [existing] = await this.db
      .select()
      .from(maintenanceLinks)
      .where(
        and(
          eq(maintenanceLinks.id, input.id),
          eq(maintenanceLinks.maintenanceId, input.maintenanceId),
        ),
      );
    if (!existing) return undefined;

    const updateData: Partial<typeof maintenanceLinks.$inferInsert> = {};
    if (input.label !== undefined) updateData.label = input.label;
    if (input.url !== undefined) updateData.url = input.url;
    if (input.visibility !== undefined)
      updateData.visibility = input.visibility;
    if (Object.keys(updateData).length === 0) return existing;

    const [row] = await this.db
      .update(maintenanceLinks)
      .set(updateData)
      .where(
        and(
          eq(maintenanceLinks.id, input.id),
          eq(maintenanceLinks.maintenanceId, input.maintenanceId),
        ),
      )
      .returning();
    return row;
  }

  /**
   * Remove a hotlink. Returns the parent maintenanceId so the caller can
   * invalidate the right cache entry, or undefined if the link did not
   * exist.
   */
  async removeLink(
    id: string,
    maintenanceId: string,
  ): Promise<string | undefined> {
    // Scope by maintenanceId: the caller is authorized (idParam) against THIS
    // maintenance, so a link belonging to a different maintenance must not be
    // removable by pairing its link id with a maintenance the caller manages.
    const [existing] = await this.db
      .select()
      .from(maintenanceLinks)
      .where(
        and(
          eq(maintenanceLinks.id, id),
          eq(maintenanceLinks.maintenanceId, maintenanceId),
        ),
      );
    if (!existing) return undefined;
    await this.db
      .delete(maintenanceLinks)
      .where(
        and(
          eq(maintenanceLinks.id, id),
          eq(maintenanceLinks.maintenanceId, maintenanceId),
        ),
      );
    return existing.maintenanceId;
  }

  /**
   * Get unique subscriber user IDs for a maintenance's systems
   * Uses the notification system to get subscribers and deduplicate
   */
  async getSystemSubscribers(_systemIds: string[]): Promise<Set<string>> {
    // This will be implemented with notification integration
    // For now, return empty set
    return new Set();
  }

  /**
   * Check if a system has an active maintenance with notification suppression enabled.
   * A maintenance is considered "active" if its status is "in_progress".
   */
  async hasActiveMaintenanceWithSuppression(
    systemId: string,
  ): Promise<boolean> {
    // Get maintenance IDs for this system
    const systemMaintenances = await this.db
      .select({ maintenanceId: maintenanceSystems.maintenanceId })
      .from(maintenanceSystems)
      .where(eq(maintenanceSystems.systemId, systemId));

    const ids = systemMaintenances.map((r) => r.maintenanceId);
    if (ids.length === 0) return false;

    // Check if any of these maintenances are in_progress with suppressNotifications enabled
    const [match] = await this.db
      .select({ id: maintenances.id })
      .from(maintenances)
      .where(
        and(
          inArray(maintenances.id, ids),
          eq(maintenances.status, "in_progress"),
          eq(maintenances.suppressNotifications, true),
        ),
      )
      .limit(1);

    return !!match;
  }

  /**
   * Check if a system currently has an active maintenance window,
   * regardless of whether notification suppression is enabled. A
   * maintenance is "active" when its status is "in_progress".
   *
   * Unlike {@link hasActiveMaintenanceWithSuppression}, this is
   * suppression-agnostic: it answers "is this system in a maintenance
   * window right now?" so automations can gate on maintenance state
   * without being coupled to the notification-suppression flag.
   */
  async hasActiveMaintenance(systemId: string): Promise<boolean> {
    const systemMaintenances = await this.db
      .select({ maintenanceId: maintenanceSystems.maintenanceId })
      .from(maintenanceSystems)
      .where(eq(maintenanceSystems.systemId, systemId));

    const ids = systemMaintenances.map((r) => r.maintenanceId);
    if (ids.length === 0) return false;

    const [match] = await this.db
      .select({ id: maintenances.id })
      .from(maintenances)
      .where(
        and(
          inArray(maintenances.id, ids),
          eq(maintenances.status, "in_progress"),
        ),
      )
      .limit(1);

    return !!match;
  }

  /**
   * Global read of all currently-active (in_progress) maintenance windows,
   * grouped by the systems they affect. Returns one entry per system that has
   * at least one in_progress window; systems with none are absent (so the
   * result is safe to feed straight into the system-signals deriver). Reads the
   * shared, durable `maintenances` + `maintenance_systems` tables so the answer
   * is identical on every pod.
   *
   * Unlike {@link getMaintenancesForSystem} (per system, scheduled +
   * in_progress) and the bulk-by-systemIds RPC, this is GLOBAL across all
   * systems and limited to in_progress - it backs the `system.issues`
   * aggregator contributor, which reports problems for ALL systems at once.
   */
  async getActiveMaintenancesBySystem(): Promise<
    Record<string, MaintenanceWithSystems[]>
  > {
    // Batch the active-windows read + junction read behind one `SET LOCAL`.
    return withScopedTransaction(this.db, async (tx) => {
      const activeRows = await tx
        .select()
        .from(maintenances)
        .where(eq(maintenances.status, "in_progress"));
      if (activeRows.length === 0) return {};

      const systemsByMaintenance = await this.getSystemsByMaintenance(
        tx,
        activeRows.map((m) => m.id),
      );

      const result: Record<string, MaintenanceWithSystems[]> = {};
      for (const m of activeRows) {
        const systemIds = systemsByMaintenance.get(m.id) ?? [];
        const withSystems: MaintenanceWithSystems = {
          ...m,
          description: m.description ?? undefined,
          systemIds,
        };
        for (const systemId of systemIds) {
          (result[systemId] ??= []).push(withSystems);
        }
      }

      return result;
    });
  }

  /**
   * Read maintenance windows that OVERLAP `[from, to]` for the given systems,
   * INCLUDING already-completed windows and EXCLUDING only `cancelled` ones.
   *
   * Backs the SLO error-budget maintenance exclusion, whose budget window is
   * TRAILING (e.g. the last 30 days): a planned maintenance that has since
   * transitioned to `completed` must still be subtracted, so the active-only
   * filter used by {@link getMaintenancesForSystem} is wrong here. Because
   * every non-cancelled status is returned by pure time overlap, the subtracted
   * amount is stable (monotonic) as a window moves `scheduled -> in_progress ->
   * completed`. Overlap test: `startAt <= to AND endAt >= from`. Reads the
   * shared, durable tables so the answer is identical on every pod. Returns one
   * entry per requested system that has at least one overlapping window.
   */
  async getMaintenanceWindowsForRange({
    systemIds,
    from,
    to,
  }: {
    systemIds: string[];
    from: Date;
    to: Date;
  }): Promise<Record<string, MaintenanceWithSystems[]>> {
    if (systemIds.length === 0) return {};

    // Batch the 3 sequential reads (requested membership -> overlapping windows
    // -> full membership) behind a single `SET LOCAL search_path`.
    return withScopedTransaction(this.db, async (tx) => {
      // Maintenance ids attached to any of the requested systems.
      const requestedSystemRows = await tx
        .select({ maintenanceId: maintenanceSystems.maintenanceId })
        .from(maintenanceSystems)
        .where(inArray(maintenanceSystems.systemId, systemIds));
      if (requestedSystemRows.length === 0) return {};

      const candidateIds = [
        ...new Set(requestedSystemRows.map((r) => r.maintenanceId)),
      ];

      // Non-cancelled windows whose [startAt, endAt] overlaps [from, to].
      const rows = await tx
        .select()
        .from(maintenances)
        .where(
          and(
            inArray(maintenances.id, candidateIds),
            ne(maintenances.status, "cancelled"),
            lte(maintenances.startAt, to),
            gte(maintenances.endAt, from),
          ),
        );
      if (rows.length === 0) return {};

      // Full system membership for the overlapping windows (accurate systemIds).
      const systemsByMaintenance = await this.getSystemsByMaintenance(
        tx,
        rows.map((m) => m.id),
      );

      const requested = new Set(systemIds);
      const result: Record<string, MaintenanceWithSystems[]> = {};
      for (const m of rows) {
        const affectedSystems = systemsByMaintenance.get(m.id) ?? [];
        const withSystems: MaintenanceWithSystems = {
          ...m,
          description: m.description ?? undefined,
          systemIds: affectedSystems,
        };
        // Group only under the systems the caller asked about.
        for (const systemId of affectedSystems) {
          if (!requested.has(systemId)) continue;
          (result[systemId] ??= []).push(withSystems);
        }
      }

      return result;
    });
  }

  /**
   * Get maintenances that should transition from 'scheduled' to 'in_progress'.
   * These are maintenances where status = 'scheduled' AND startAt <= now.
   */
  async getMaintenancesToStart(): Promise<MaintenanceWithSystems[]> {
    const now = new Date();

    // One SET LOCAL for the read fan-out. System associations are fetched in a
    // SINGLE set-based `inArray` query and grouped in JS via
    // `getSystemsByMaintenance`, instead of the former per-row N+1 loop.
    return withScopedTransaction(this.db, async (tx) => {
      const rows = await tx
        .select()
        .from(maintenances)
        .where(eq(maintenances.status, "scheduled"));

      // Filter in JS since Drizzle SQL comparison can be tricky with dates
      const startable = rows.filter((m) => m.startAt <= now);
      if (startable.length === 0) return [];

      const systemsByMaintenance = await this.getSystemsByMaintenance(
        tx,
        startable.map((m) => m.id),
      );

      return startable.map((m) => ({
        ...m,
        description: m.description ?? undefined,
        systemIds: systemsByMaintenance.get(m.id) ?? [],
      }));
    });
  }

  /**
   * Get maintenances that should transition from 'in_progress' to 'completed'.
   * These are maintenances where status = 'in_progress' AND endAt <= now.
   */
  async getMaintenancesToComplete(): Promise<MaintenanceWithSystems[]> {
    const now = new Date();

    // One SET LOCAL for the read fan-out. System associations are fetched in a
    // SINGLE set-based `inArray` query and grouped in JS via
    // `getSystemsByMaintenance`, instead of the former per-row N+1 loop.
    return withScopedTransaction(this.db, async (tx) => {
      const rows = await tx
        .select()
        .from(maintenances)
        .where(eq(maintenances.status, "in_progress"));

      // Filter in JS for those that have ended
      const completable = rows.filter((m) => m.endAt <= now);
      if (completable.length === 0) return [];

      const systemsByMaintenance = await this.getSystemsByMaintenance(
        tx,
        completable.map((m) => m.id),
      );

      return completable.map((m) => ({
        ...m,
        description: m.description ?? undefined,
        systemIds: systemsByMaintenance.get(m.id) ?? [],
      }));
    });
  }

  /**
   * Transition a maintenance to a new status with an automatic update entry.
   * Used by the scheduled job for automatic status transitions.
   */
  async transitionStatus(
    id: string,
    newStatus: MaintenanceStatus,
    message: string,
  ): Promise<MaintenanceWithSystems | undefined> {
    const [existing] = await this.db
      .select()
      .from(maintenances)
      .where(eq(maintenances.id, id));

    if (!existing) return undefined;

    // Atomic: the status flip and the timeline entry that records it commit
    // together (status/timeline divergence otherwise), under a single
    // `SET LOCAL search_path`.
    await this.db.transaction(async (tx) => {
      await tx
        .update(maintenances)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(maintenances.id, id));

      // Add update entry (no user - system-generated)
      await tx.insert(maintenanceUpdates).values({
        id: generateId(),
        maintenanceId: id,
        message,
        statusChange: newStatus,
        createdBy: undefined, // System-generated, no user
      });
    });

    return (await this.getMaintenance(id))!;
  }
}
