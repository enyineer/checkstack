import { eq, and, inArray, ne } from "drizzle-orm";
import { withXactLock, type SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";
import {
  incidents,
  incidentSystems,
  incidentUpdates,
  incidentLinks,
} from "./schema";
import type {
  IncidentWithSystems,
  IncidentDetail,
  IncidentUpdate,
  IncidentLink,
  AddIncidentLinkInput,
  CreateIncidentInput,
  UpdateIncidentInput,
  AddIncidentUpdateInput,
  IncidentStatus,
} from "@checkstack/incident-common";

type Db = SafeDatabase<typeof schema>;

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

    const links = await this.db
      .select()
      .from(incidentLinks)
      .where(eq(incidentLinks.incidentId, id));

    return {
      ...incident,
      description: incident.description ?? undefined,
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
   * Get active incidents for a system
   */
  async getIncidentsForSystem(
    systemId: string,
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
    userId?: string,
  ): Promise<IncidentWithSystems> {
    const id = generateId();

    await this.db.insert(incidents).values({
      id,
      title: input.title,
      description: input.description,
      status: "investigating",
      severity: input.severity,
      suppressNotifications: input.suppressNotifications ?? false,
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
    input: UpdateIncidentInput,
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
    if (input.suppressNotifications !== undefined)
      updateData.suppressNotifications = input.suppressNotifications;

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
    userId?: string,
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
    userId?: string,
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

  /**
   * Add a hotlink to an incident.
   */
  async addLink(input: AddIncidentLinkInput): Promise<IncidentLink> {
    const id = generateId();
    await this.db.insert(incidentLinks).values({
      id,
      incidentId: input.incidentId,
      label: input.label,
      url: input.url,
    });
    const [row] = await this.db
      .select()
      .from(incidentLinks)
      .where(eq(incidentLinks.id, id));
    return row;
  }

  /**
   * Remove a hotlink. Returns the parent incidentId so the caller can
   * invalidate the right cache entry, or undefined if the link did not
   * exist.
   */
  async removeLink(id: string): Promise<string | undefined> {
    const [existing] = await this.db
      .select()
      .from(incidentLinks)
      .where(eq(incidentLinks.id, id));
    if (!existing) return undefined;
    await this.db.delete(incidentLinks).where(eq(incidentLinks.id, id));
    return existing.incidentId;
  }

  /**
   * Check if a system has an active incident with notification suppression enabled.
   * An incident is considered "active" if its status is NOT "resolved".
   */
  async hasActiveIncidentWithSuppression(systemId: string): Promise<boolean> {
    // Get incident IDs for this system
    const systemIncidents = await this.db
      .select({ incidentId: incidentSystems.incidentId })
      .from(incidentSystems)
      .where(eq(incidentSystems.systemId, systemId));

    const ids = systemIncidents.map((r) => r.incidentId);
    if (ids.length === 0) return false;

    // Check if any of these incidents are active (not resolved) with suppressNotifications enabled
    const [match] = await this.db
      .select({ id: incidents.id })
      .from(incidents)
      .where(
        and(
          inArray(incidents.id, ids),
          ne(incidents.status, "resolved"),
          eq(incidents.suppressNotifications, true),
        ),
      )
      .limit(1);

    return !!match;
  }

  /**
   * Find a single OPEN (not-resolved) incident affecting `systemId`, if
   * any. Returns the incident with its systems, mirroring the old
   * auto-incident `findActiveAutoIncident(systemId)` dedup semantic. Used
   * by `incident.create`'s opt-in `dedupe_open_for_system` flag so a
   * second trigger for an already-incidented system reuses the open
   * incident rather than opening a duplicate.
   */
  async findActiveIncidentForSystem(
    systemId: string,
  ): Promise<IncidentWithSystems | undefined> {
    const systemIncidents = await this.db
      .select({ incidentId: incidentSystems.incidentId })
      .from(incidentSystems)
      .where(eq(incidentSystems.systemId, systemId));

    const ids = systemIncidents.map((r) => r.incidentId);
    if (ids.length === 0) return undefined;

    const [match] = await this.db
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(inArray(incidents.id, ids), ne(incidents.status, "resolved")))
      .limit(1);

    if (!match) return undefined;
    return this.getIncident(match.id);
  }

  /**
   * Dedup-aware create for a single system, used by the `incident.create`
   * automation action when `dedupe_open_for_system` is set. Serializes the
   * check-then-create per system with a transaction-scoped advisory lock so
   * two concurrent triggers for the same system (e.g. sustained + flapping)
   * can't both observe "no open incident" and both create one. The critical
   * section is short (a find + an insert), so a transaction-scoped lock is
   * the right primitive (it auto-releases at COMMIT, no leak possible).
   *
   * Returns `{ incident, reused }` — `reused` is true when an already-open
   * incident for the system was found and returned instead of creating.
   */
  async createIncidentDedupedForSystem(
    input: CreateIncidentInput,
    dedupeSystemId: string,
    userId?: string,
  ): Promise<{ incident: IncidentWithSystems; reused: boolean }> {
    return withXactLock({
      db: this.db,
      key: `incident.dedupe-open-for-system:${dedupeSystemId}`,
      // The find + create run on `this.db` (the pool), NOT on `tx`. That is
      // safe here because `pg_advisory_xact_lock` BLOCKS every other holder
      // of this key until this transaction commits: a racing caller waits
      // at lock-acquire, so its find can't observe "no open incident" until
      // ours has already committed the insert. The critical section is thus
      // serialized by the lock window even though it doesn't ride `tx`.
      fn: async () => {
        const existing = await this.findActiveIncidentForSystem(dedupeSystemId);
        if (existing) {
          return { incident: existing, reused: true };
        }
        const incident = await this.createIncident(input, userId);
        return { incident, reused: false };
      },
    });
  }
}
