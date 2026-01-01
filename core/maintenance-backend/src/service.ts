import { eq, and, or, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
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
} from "@checkmate/maintenance-common";

type Db = NodePgDatabase<typeof schema>;

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
            filters.status ? eq(maintenances.status, filters.status) : undefined
          )
        );
    } else {
      maintenanceRows = await this.db
        .select()
        .from(maintenances)
        .where(
          filters?.status ? eq(maintenances.status, filters.status) : undefined
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
    systemId: string
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
            eq(maintenances.status, "in_progress")
          )
        )
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
    input: CreateMaintenanceInput
  ): Promise<MaintenanceWithSystems> {
    const id = generateId();

    await this.db.insert(maintenances).values({
      id,
      title: input.title,
      description: input.description,
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
    input: UpdateMaintenanceInput
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
    userId?: string
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
    userId?: string
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
}
