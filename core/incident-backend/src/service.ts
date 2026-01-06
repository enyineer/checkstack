import { eq, and, inArray, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { incidents, incidentSystems, incidentUpdates } from "./schema";
import type {
  IncidentWithSystems,
  IncidentDetail,
  IncidentUpdate,
  CreateIncidentInput,
  UpdateIncidentInput,
  AddIncidentUpdateInput,
  IncidentStatus,
} from "@checkmate-monitor/incident-common";

type Db = NodePgDatabase<typeof schema>;

function generateId(): string {
  return crypto.randomUUID();
}

export class IncidentService {
  constructor(private db: Db) {}

  /**
   * List incidents with optional filters
   */
  async listIncidents(filters?: {
    status?: IncidentStatus;
    systemId?: string;
    includeResolved?: boolean;
  }): Promise<IncidentWithSystems[]> {
    let incidentRows;

    if (filters?.systemId) {
      // Filter by system - need to join
      const systemIncidentIds = await this.db
        .select({ incidentId: incidentSystems.incidentId })
        .from(incidentSystems)
        .where(eq(incidentSystems.systemId, filters.systemId));

      const ids = systemIncidentIds.map((r) => r.incidentId);
      if (ids.length === 0) return [];

      const statusFilter = filters.status
        ? eq(incidents.status, filters.status)
        : filters.includeResolved
        ? undefined
        : ne(incidents.status, "resolved");

      incidentRows = await this.db
        .select()
        .from(incidents)
        .where(and(inArray(incidents.id, ids), statusFilter));
    } else {
      const statusFilter = filters?.status
        ? eq(incidents.status, filters.status)
        : filters?.includeResolved
        ? undefined
        : ne(incidents.status, "resolved");

      incidentRows = await this.db.select().from(incidents).where(statusFilter);
    }

    // Fetch all system associations
    const result: IncidentWithSystems[] = [];
    for (const i of incidentRows) {
      const systems = await this.db
        .select({ systemId: incidentSystems.systemId })
        .from(incidentSystems)
        .where(eq(incidentSystems.incidentId, i.id));

      result.push({
        ...i,
        description: i.description ?? undefined,
        systemIds: systems.map((s) => s.systemId),
      });
    }

    return result;
  }

  /**
   * Get single incident with full details
   */
  async getIncident(id: string): Promise<IncidentDetail | undefined> {
    const [incident] = await this.db
      .select()
      .from(incidents)
      .where(eq(incidents.id, id));

    if (!incident) return undefined;

    const systems = await this.db
      .select({ systemId: incidentSystems.systemId })
      .from(incidentSystems)
      .where(eq(incidentSystems.incidentId, id));

    const updates = await this.db
      .select()
      .from(incidentUpdates)
      .where(eq(incidentUpdates.incidentId, id));

    return {
      ...incident,
      description: incident.description ?? undefined,
      systemIds: systems.map((s) => s.systemId),
      updates: updates.map((u) => ({
        ...u,
        statusChange: u.statusChange ?? undefined,
        createdBy: u.createdBy ?? undefined,
      })),
    };
  }

  /**
   * Get active incidents for a system
   */
  async getIncidentsForSystem(
    systemId: string
  ): Promise<IncidentWithSystems[]> {
    // Get incident IDs for this system
    const systemIncidents = await this.db
      .select({ incidentId: incidentSystems.incidentId })
      .from(incidentSystems)
      .where(eq(incidentSystems.systemId, systemId));

    const ids = systemIncidents.map((r) => r.incidentId);
    if (ids.length === 0) return [];

    // Get only non-resolved incidents
    const rows = await this.db
      .select()
      .from(incidents)
      .where(and(inArray(incidents.id, ids), ne(incidents.status, "resolved")));

    // Fetch system IDs for each
    const result: IncidentWithSystems[] = [];
    for (const i of rows) {
      const systems = await this.db
        .select({ systemId: incidentSystems.systemId })
        .from(incidentSystems)
        .where(eq(incidentSystems.incidentId, i.id));

      result.push({
        ...i,
        description: i.description ?? undefined,
        systemIds: systems.map((s) => s.systemId),
      });
    }

    return result;
  }

  /**
   * Create a new incident
   */
  async createIncident(
    input: CreateIncidentInput,
    userId?: string
  ): Promise<IncidentWithSystems> {
    const id = generateId();

    await this.db.insert(incidents).values({
      id,
      title: input.title,
      description: input.description,
      status: "investigating",
      severity: input.severity,
    });

    // Insert system associations
    for (const systemId of input.systemIds) {
      await this.db.insert(incidentSystems).values({
        incidentId: id,
        systemId,
      });
    }

    // Add initial update if provided
    if (input.initialMessage) {
      await this.db.insert(incidentUpdates).values({
        id: generateId(),
        incidentId: id,
        message: input.initialMessage,
        statusChange: "investigating",
        createdBy: userId,
      });
    }

    return (await this.getIncident(id))!;
  }

  /**
   * Update an existing incident
   */
  async updateIncident(
    input: UpdateIncidentInput
  ): Promise<IncidentWithSystems | undefined> {
    const [existing] = await this.db
      .select()
      .from(incidents)
      .where(eq(incidents.id, input.id));

    if (!existing) return undefined;

    // Build update object
    const updateData: Partial<typeof incidents.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined)
      updateData.description = input.description;
    if (input.severity !== undefined) updateData.severity = input.severity;

    await this.db
      .update(incidents)
      .set(updateData)
      .where(eq(incidents.id, input.id));

    // Update system associations if provided
    if (input.systemIds !== undefined) {
      await this.db
        .delete(incidentSystems)
        .where(eq(incidentSystems.incidentId, input.id));

      for (const systemId of input.systemIds) {
        await this.db.insert(incidentSystems).values({
          incidentId: input.id,
          systemId,
        });
      }
    }

    return (await this.getIncident(input.id))!;
  }

  /**
   * Add a status update to an incident
   */
  async addUpdate(
    input: AddIncidentUpdateInput,
    userId?: string
  ): Promise<IncidentUpdate> {
    const id = generateId();

    // If status change is provided, update the incident status
    if (input.statusChange) {
      await this.db
        .update(incidents)
        .set({ status: input.statusChange, updatedAt: new Date() })
        .where(eq(incidents.id, input.incidentId));
    }

    await this.db.insert(incidentUpdates).values({
      id,
      incidentId: input.incidentId,
      message: input.message,
      statusChange: input.statusChange,
      createdBy: userId,
    });

    const [update] = await this.db
      .select()
      .from(incidentUpdates)
      .where(eq(incidentUpdates.id, id));

    return {
      ...update,
      statusChange: update.statusChange ?? undefined,
      createdBy: update.createdBy ?? undefined,
    };
  }

  /**
   * Resolve an incident
   */
  async resolveIncident(
    id: string,
    message?: string,
    userId?: string
  ): Promise<IncidentWithSystems | undefined> {
    const [existing] = await this.db
      .select()
      .from(incidents)
      .where(eq(incidents.id, id));

    if (!existing) return undefined;

    await this.db
      .update(incidents)
      .set({ status: "resolved", updatedAt: new Date() })
      .where(eq(incidents.id, id));

    // Add resolution update entry
    await this.db.insert(incidentUpdates).values({
      id: generateId(),
      incidentId: id,
      message: message ?? "Incident resolved",
      statusChange: "resolved",
      createdBy: userId,
    });

    return (await this.getIncident(id))!;
  }

  /**
   * Delete an incident
   */
  async deleteIncident(id: string): Promise<boolean> {
    const [existing] = await this.db
      .select()
      .from(incidents)
      .where(eq(incidents.id, id));

    if (!existing) return false;

    // Cascade delete handles junctions and updates
    await this.db.delete(incidents).where(eq(incidents.id, id));
    return true;
  }

  /**
   * Remove all incident associations for a system.
   * Called when a system is deleted from the catalog.
   */
  async removeSystemAssociations(systemId: string): Promise<void> {
    await this.db
      .delete(incidentSystems)
      .where(eq(incidentSystems.systemId, systemId));
  }
}
