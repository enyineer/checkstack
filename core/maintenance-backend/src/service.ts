import { eq, and, or, inArray } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";
import { maintenances, maintenanceSystems, maintenanceUpdates } from "./schema";
import type {
  MaintenanceWithSystems,
  MaintenanceDetail,
  MaintenanceUpdate,
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
  }): Promise<MaintenanceWithSystems[]> {
    let maintenanceRows;

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
        .where(
          and(
            inArray(maintenances.id, ids),
            filters.status
              ? eq(maintenances.status, filters.status)
              : undefined,
          ),
        );
    } else {
      maintenanceRows = await this.db
        .select()
        .from(maintenances)
        .where(
          filters?.status ? eq(maintenances.status, filters.status) : undefined,
        );
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

    return {
      ...maintenance,
      description: maintenance.description ?? undefined,
      systemIds: systems.map((s) => s.systemId),
      updates: updates.map((u) => ({
        ...u,
        statusChange: u.statusChange ?? undefined,
        createdBy: u.createdBy ?? undefined,
      })),
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
   * Create a new maintenance
   */
  async createMaintenance(
    input: CreateMaintenanceInput,
  ): Promise<MaintenanceWithSystems> {
    const id = generateId();

    await this.db.insert(maintenances).values({
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
      await this.db.insert(maintenanceSystems).values({
        maintenanceId: id,
        systemId,
      });
    }

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

    await this.db
      .update(maintenances)
      .set(updateData)
      .where(eq(maintenances.id, input.id));

    // Update system associations if provided
    if (input.systemIds !== undefined) {
      await this.db
        .delete(maintenanceSystems)
        .where(eq(maintenanceSystems.maintenanceId, input.id));

      for (const systemId of input.systemIds) {
        await this.db.insert(maintenanceSystems).values({
          maintenanceId: input.id,
          systemId,
        });
      }
    }

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

    // If status change is provided, update the maintenance status
    if (input.statusChange) {
      await this.db
        .update(maintenances)
        .set({ status: input.statusChange, updatedAt: new Date() })
        .where(eq(maintenances.id, input.maintenanceId));
    }

    await this.db.insert(maintenanceUpdates).values({
      id,
      maintenanceId: input.maintenanceId,
      message: input.message,
      statusChange: input.statusChange,
      createdBy: userId,
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

    await this.db
      .update(maintenances)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(maintenances.id, id));

    // Add update entry
    await this.db.insert(maintenanceUpdates).values({
      id: generateId(),
      maintenanceId: id,
      message: message ?? "Maintenance completed early",
      statusChange: "completed",
      createdBy: userId,
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
