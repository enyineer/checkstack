import { eq, and, or, ne, inArray } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
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
  CreateMaintenanceInput,
  UpdateMaintenanceInput,
  AddMaintenanceUpdateInput,
  MaintenanceStatus,
} from "@checkstack/maintenance-common";

type Db = SafeDatabase<typeof schema>;

function generateId(): string {
  return crypto.randomUUID();
}

export class MaintenanceService {
  constructor(private db: Db) {}

  /**
   * List maintenances with optional filters
   */
  async listMaintenances(filters?: {
    status?: MaintenanceStatus;
    systemId?: string;
    includeCompleted?: boolean;
  }): Promise<MaintenanceWithSystems[]> {
    let maintenanceRows;

    // Mirrors the incident plugin's `includeResolved`: an explicit `status`
    // filter wins; otherwise completed maintenances are hidden unless
    // `includeCompleted` is set, so the default list shows only active /
    // upcoming windows.
    const statusFilter = filters?.status
      ? eq(maintenances.status, filters.status)
      : filters?.includeCompleted
        ? undefined
        : ne(maintenances.status, "completed");

    if (filters?.systemId) {
      // Filter by system - need to join
      const systemMaintenanceIds = await this.db
        .select({ maintenanceId: maintenanceSystems.maintenanceId })
        .from(maintenanceSystems)
        .where(eq(maintenanceSystems.systemId, filters.systemId));

      const ids = systemMaintenanceIds.map((r) => r.maintenanceId);
      if (ids.length === 0) return [];

      maintenanceRows = await this.db
        .select()
        .from(maintenances)
        .where(and(inArray(maintenances.id, ids), statusFilter));
    } else {
      maintenanceRows = await this.db
        .select()
        .from(maintenances)
        .where(statusFilter);
    }

    // Fetch all system associations
    const result: MaintenanceWithSystems[] = [];
    for (const m of maintenanceRows) {
      const systems = await this.db
        .select({ systemId: maintenanceSystems.systemId })
        .from(maintenanceSystems)
        .where(eq(maintenanceSystems.maintenanceId, m.id));

      result.push({
        ...m,
        description: m.description ?? undefined,
        systemIds: systems.map((s) => s.systemId),
      });
    }

    return result;
  }

  /**
   * Get single maintenance with full details
   */
  async getMaintenance(id: string): Promise<MaintenanceDetail | undefined> {
    const [maintenance] = await this.db
      .select()
      .from(maintenances)
      .where(eq(maintenances.id, id));

    if (!maintenance) return undefined;

    const systems = await this.db
      .select({ systemId: maintenanceSystems.systemId })
      .from(maintenanceSystems)
      .where(eq(maintenanceSystems.maintenanceId, id));

    const updates = await this.db
      .select()
      .from(maintenanceUpdates)
      .where(eq(maintenanceUpdates.maintenanceId, id));

    const links = await this.db
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
        createdBy: u.createdBy ?? undefined,
      })),
      links,
    };
  }

  /**
   * Get active/upcoming maintenances for a system
   */
  async getMaintenancesForSystem(
    systemId: string,
  ): Promise<MaintenanceWithSystems[]> {
    const _now = new Date();

    // Get maintenance IDs for this system
    const systemMaintenances = await this.db
      .select({ maintenanceId: maintenanceSystems.maintenanceId })
      .from(maintenanceSystems)
      .where(eq(maintenanceSystems.systemId, systemId));

    const ids = systemMaintenances.map((r) => r.maintenanceId);
    if (ids.length === 0) return [];

    // Get only scheduled or in_progress maintenances ending in the future
    const rows = await this.db
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

    // Fetch system IDs for each
    const result: MaintenanceWithSystems[] = [];
    for (const m of rows) {
      const systems = await this.db
        .select({ systemId: maintenanceSystems.systemId })
        .from(maintenanceSystems)
        .where(eq(maintenanceSystems.maintenanceId, m.id));

      result.push({
        ...m,
        description: m.description ?? undefined,
        systemIds: systems.map((s) => s.systemId),
      });
    }

    return result;
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

    const rows = await this.db
      .select({
        id: maintenances.id,
        status: maintenances.status,
        startAt: maintenances.startAt,
        endAt: maintenances.endAt,
      })
      .from(maintenances)
      .where(inArray(maintenances.id, [...ids]));
    if (rows.length === 0) return {};

    const presentIds = rows.map((r) => r.id);
    const systemRows = await this.db
      .select({
        maintenanceId: maintenanceSystems.maintenanceId,
        systemId: maintenanceSystems.systemId,
      })
      .from(maintenanceSystems)
      .where(inArray(maintenanceSystems.maintenanceId, presentIds));

    const systemsByMaintenance = new Map<string, string[]>();
    for (const r of systemRows) {
      const list = systemsByMaintenance.get(r.maintenanceId);
      if (list) list.push(r.systemId);
      else systemsByMaintenance.set(r.maintenanceId, [r.systemId]);
    }

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
    // together (status/timeline divergence otherwise).
    await this.db.transaction(async (tx) => {
      // If status change is provided, update the maintenance status
      if (input.statusChange) {
        await tx
          .update(maintenances)
          .set({ status: input.statusChange, updatedAt: new Date() })
          .where(eq(maintenances.id, input.maintenanceId));
      }

      await tx.insert(maintenanceUpdates).values({
        id,
        maintenanceId: input.maintenanceId,
        message: input.message,
        statusChange: input.statusChange,
        createdBy: userId,
      });
    });

    const [update] = await this.db
      .select()
      .from(maintenanceUpdates)
      .where(eq(maintenanceUpdates.id, id));

    return {
      ...update,
      statusChange: update.statusChange ?? undefined,
      createdBy: update.createdBy ?? undefined,
    };
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
    await this.db.insert(maintenanceLinks).values({
      id,
      maintenanceId: input.maintenanceId,
      label: input.label,
      url: input.url,
    });
    const [row] = await this.db
      .select()
      .from(maintenanceLinks)
      .where(eq(maintenanceLinks.id, id));
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
    const activeRows = await this.db
      .select()
      .from(maintenances)
      .where(eq(maintenances.status, "in_progress"));
    if (activeRows.length === 0) return {};

    const activeIds = activeRows.map((m) => m.id);
    const systemRows = await this.db
      .select({
        maintenanceId: maintenanceSystems.maintenanceId,
        systemId: maintenanceSystems.systemId,
      })
      .from(maintenanceSystems)
      .where(inArray(maintenanceSystems.maintenanceId, activeIds));

    const systemsByMaintenance = new Map<string, string[]>();
    for (const r of systemRows) {
      const list = systemsByMaintenance.get(r.maintenanceId);
      if (list) list.push(r.systemId);
      else systemsByMaintenance.set(r.maintenanceId, [r.systemId]);
    }

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
  }

  /**
   * Get maintenances that should transition from 'scheduled' to 'in_progress'.
   * These are maintenances where status = 'scheduled' AND startAt <= now.
   */
  async getMaintenancesToStart(): Promise<MaintenanceWithSystems[]> {
    const now = new Date();

    const rows = await this.db
      .select()
      .from(maintenances)
      .where(
        and(
          eq(maintenances.status, "scheduled"),
          // startAt is in the past or now
          // Using SQL comparison - startAt <= now
        ),
      );

    // Filter in JS since Drizzle SQL comparison can be tricky with dates
    const startable = rows.filter((m) => m.startAt <= now);

    // Fetch system IDs for each
    const result: MaintenanceWithSystems[] = [];
    for (const m of startable) {
      const systems = await this.db
        .select({ systemId: maintenanceSystems.systemId })
        .from(maintenanceSystems)
        .where(eq(maintenanceSystems.maintenanceId, m.id));

      result.push({
        ...m,
        description: m.description ?? undefined,
        systemIds: systems.map((s) => s.systemId),
      });
    }

    return result;
  }

  /**
   * Get maintenances that should transition from 'in_progress' to 'completed'.
   * These are maintenances where status = 'in_progress' AND endAt <= now.
   */
  async getMaintenancesToComplete(): Promise<MaintenanceWithSystems[]> {
    const now = new Date();

    const rows = await this.db
      .select()
      .from(maintenances)
      .where(eq(maintenances.status, "in_progress"));

    // Filter in JS for those that have ended
    const completable = rows.filter((m) => m.endAt <= now);

    // Fetch system IDs for each
    const result: MaintenanceWithSystems[] = [];
    for (const m of completable) {
      const systems = await this.db
        .select({ systemId: maintenanceSystems.systemId })
        .from(maintenanceSystems)
        .where(eq(maintenanceSystems.maintenanceId, m.id));

      result.push({
        ...m,
        description: m.description ?? undefined,
        systemIds: systems.map((s) => s.systemId),
      });
    }

    return result;
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

    // Update the maintenance status
    await this.db
      .update(maintenances)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(maintenances.id, id));

    // Add update entry (no user - system-generated)
    await this.db.insert(maintenanceUpdates).values({
      id: generateId(),
      maintenanceId: id,
      message,
      statusChange: newStatus,
      createdBy: undefined, // System-generated, no user
    });

    return (await this.getMaintenance(id))!;
  }
}
