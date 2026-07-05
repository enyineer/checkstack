import { eq, and, inArray, ne, isNotNull } from "drizzle-orm";
import type { AdvisoryLockService, SafeDatabase } from "@checkstack/backend-api";
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
  IncidentSeverity,
  SystemHealthOverride,
} from "@checkstack/incident-common";

type Db = SafeDatabase<typeof schema>;

function generateId(): string {
  return crypto.randomUUID();
}

export class IncidentService {
  constructor(
    private db: Db,
    private advisoryLock: AdvisoryLockService,
  ) {}

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
   * Batched reactive-state read for the `incident` entity (Model B
   * plugin-backed `read` accessor). Given incident ids, return the reactive
   * subset `{ status, severity, systemIds }` for each that exists (missing
   * ids omitted). Reads the AUTHORITATIVE `incidents` + `incident_systems`
   * tables — no framework `entity_state` storage. This is the single source
   * of truth `handle.mutate` snapshots `prev` from and `get`/`getMany`/scope
   * enrichment route through.
   */
  async getManyEntityStates(
    ids: ReadonlyArray<string>,
  ): Promise<
    Record<string, { status: IncidentStatus; severity: IncidentSeverity; systemIds: string[] }>
  > {
    if (ids.length === 0) return {};

    const rows = await this.db
      .select({
        id: incidents.id,
        status: incidents.status,
        severity: incidents.severity,
      })
      .from(incidents)
      .where(inArray(incidents.id, [...ids]));
    if (rows.length === 0) return {};

    const presentIds = rows.map((r) => r.id);
    const systemRows = await this.db
      .select({
        incidentId: incidentSystems.incidentId,
        systemId: incidentSystems.systemId,
      })
      .from(incidentSystems)
      .where(inArray(incidentSystems.incidentId, presentIds));

    const systemsByIncident = new Map<string, string[]>();
    for (const r of systemRows) {
      const list = systemsByIncident.get(r.incidentId);
      if (list) list.push(r.systemId);
      else systemsByIncident.set(r.incidentId, [r.systemId]);
    }

    const out: Record<
      string,
      { status: IncidentStatus; severity: IncidentSeverity; systemIds: string[] }
    > = {};
    for (const row of rows) {
      out[row.id] = {
        status: row.status,
        severity: row.severity,
        systemIds: systemsByIncident.get(row.id) ?? [],
      };
    }
    return out;
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
   * Global read of every OPEN (not-resolved) incident across ALL systems,
   * grouped by systemId. Powers the backend `system.issues` contributor, which
   * needs problem state for every system on every pod (not a caller-supplied
   * systemId list). Reads the authoritative `incidents` + `incident_systems`
   * tables, so the answer is identical on every pod (state-and-scale rule).
   *
   * An incident affecting multiple systems appears under each of its systemIds,
   * each entry carrying the incident's full `systemIds` list (mirrors the bulk
   * RPC shape `getBulkIncidentsForSystems` returns). Systems with no open
   * incident are simply absent from the returned record.
   */
  async listOpenIncidentsBySystem(): Promise<
    Record<string, IncidentWithSystems[]>
  > {
    const openRows = await this.db
      .select()
      .from(incidents)
      .where(ne(incidents.status, "resolved"));
    if (openRows.length === 0) return {};

    const openIds = openRows.map((i) => i.id);
    const systemRows = await this.db
      .select({
        incidentId: incidentSystems.incidentId,
        systemId: incidentSystems.systemId,
      })
      .from(incidentSystems)
      .where(inArray(incidentSystems.incidentId, openIds));

    const systemsByIncident = new Map<string, string[]>();
    for (const r of systemRows) {
      const list = systemsByIncident.get(r.incidentId);
      if (list) list.push(r.systemId);
      else systemsByIncident.set(r.incidentId, [r.systemId]);
    }

    const result: Record<string, IncidentWithSystems[]> = {};
    for (const i of openRows) {
      const systemIds = systemsByIncident.get(i.id) ?? [];
      const incident: IncidentWithSystems = {
        ...i,
        description: i.description ?? undefined,
        systemIds,
      };
      for (const systemId of systemIds) {
        (result[systemId] ??= []).push(incident);
      }
    }

    return result;
  }

  /**
   * For each requested system, the health overrides contributed by its ACTIVE
   * incidents (status != resolved AND `healthOverride` set). Powers the
   * healthcheck plugin's system-health derivation (worst-wins fold). Reads the
   * authoritative `incidents` + `incident_systems` tables, so the answer is
   * identical on every pod (state-and-scale rule). Systems with no active
   * override are omitted; resolved incidents never appear, so an override
   * auto-lifts the moment its incident resolves.
   */
  async getActiveHealthOverrides(
    systemIds: string[],
  ): Promise<Record<string, SystemHealthOverride[]>> {
    if (systemIds.length === 0) return {};

    const rows = await this.db
      .select({
        systemId: incidentSystems.systemId,
        incidentId: incidents.id,
        incidentTitle: incidents.title,
        healthOverride: incidents.healthOverride,
      })
      .from(incidentSystems)
      .innerJoin(incidents, eq(incidentSystems.incidentId, incidents.id))
      .where(
        and(
          inArray(incidentSystems.systemId, systemIds),
          ne(incidents.status, "resolved"),
          isNotNull(incidents.healthOverride),
        ),
      );

    const result: Record<string, SystemHealthOverride[]> = {};
    for (const row of rows) {
      // `healthOverride` is guaranteed non-null by the `isNotNull` predicate.
      if (row.healthOverride === null) continue;
      (result[row.systemId] ??= []).push({
        status: row.healthOverride,
        incidentId: row.incidentId,
        incidentTitle: row.incidentTitle,
      });
    }
    return result;
  }

  /**
   * Create a new incident.
   *
   * `id` may be supplied by the caller so the reactive `incident` entity can
   * be keyed on a known id BEFORE the insert runs (the create's `prev`
   * snapshot must read the not-yet-existing row as absent — see §10.1). When
   * omitted, a fresh id is generated. The id is server-owned either way.
   */
  async createIncident(
    input: CreateIncidentInput,
    userId?: string,
    id: string = generateId(),
  ): Promise<IncidentWithSystems> {

    // Atomic: the incident row, its system associations, and any initial update
    // must all commit together. Without the transaction a failure mid-loop left
    // a committed incident with only some (or none) of its system links.
    await this.db.transaction(async (tx) => {
      await tx.insert(incidents).values({
        id,
        title: input.title,
        description: input.description,
        status: "investigating",
        severity: input.severity,
        suppressNotifications: input.suppressNotifications ?? false,
        healthOverride: input.healthOverride ?? null,
      });

      // Insert system associations
      for (const systemId of input.systemIds) {
        await tx.insert(incidentSystems).values({
          incidentId: id,
          systemId,
        });
      }

      // Add initial update if provided
      if (input.initialMessage) {
        await tx.insert(incidentUpdates).values({
          id: generateId(),
          incidentId: id,
          message: input.initialMessage,
          statusChange: "investigating",
          createdBy: userId,
        });
      }
    });

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
    // `null` clears a previously-set override; `undefined` leaves it unchanged
    // (same nullable-optional semantics as `description`).
    if (input.healthOverride !== undefined)
      updateData.healthOverride = input.healthOverride;

    // Atomic: the field update and the delete-then-reinsert of system links must
    // commit together. Without the transaction a failure after the delete left
    // the incident with ALL system associations wiped.
    await this.db.transaction(async (tx) => {
      await tx
        .update(incidents)
        .set(updateData)
        .where(eq(incidents.id, input.id));

      // Update system associations if provided
      if (input.systemIds !== undefined) {
        await tx
          .delete(incidentSystems)
          .where(eq(incidentSystems.incidentId, input.id));

        for (const systemId of input.systemIds) {
          await tx.insert(incidentSystems).values({
            incidentId: input.id,
            systemId,
          });
        }
      }
    });

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

    // Atomic: the status flip and the timeline entry that records it must commit
    // together. Without the transaction a failed insert left the incident in a
    // new status with no update row explaining it (status/timeline divergence).
    await this.db.transaction(async (tx) => {
      // If status change is provided, update the incident status
      if (input.statusChange) {
        await tx
          .update(incidents)
          .set({ status: input.statusChange, updatedAt: new Date() })
          .where(eq(incidents.id, input.incidentId));
      }

      await tx.insert(incidentUpdates).values({
        id,
        incidentId: input.incidentId,
        message: input.message,
        statusChange: input.statusChange,
        createdBy: userId,
      });
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

    // Atomic: mark resolved + write the resolution timeline entry together.
    await this.db.transaction(async (tx) => {
      await tx
        .update(incidents)
        .set({ status: "resolved", updatedAt: new Date() })
        .where(eq(incidents.id, id));

      // Add resolution update entry
      await tx.insert(incidentUpdates).values({
        id: generateId(),
        incidentId: id,
        message: message ?? "Incident resolved",
        statusChange: "resolved",
        createdBy: userId,
      });
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
    newId?: string,
    /**
     * Optional create wrapper (§10.1, 6(a)). When the dedup decides to CREATE,
     * the actual create runs through this wrapper INSIDE the advisory lock, so
     * the reactive `incident` entity write (which snapshots `prev` before the
     * insert) is serialized with the dedup check. The wrapper receives the
     * bound create thunk and MUST call it exactly once, returning its result.
     * Defaults to calling the create directly (non-reactive).
     */
    onCreate: (
      create: () => Promise<IncidentWithSystems>,
    ) => Promise<IncidentWithSystems> = (create) => create(),
  ): Promise<{ incident: IncidentWithSystems; reused: boolean }> {
    return this.advisoryLock.withXactLock({
      key: `incident.dedupe-open-for-system:${dedupeSystemId}`,
      // The find + create deliberately run on `this.db` (the admin pool), NOT
      // on the lock connection. That is safe because `pg_advisory_xact_lock`
      // BLOCKS every other holder of this key until this lock transaction
      // commits: a racing caller waits at lock-acquire, so its find can't
      // observe "no open incident" until ours has already committed the
      // insert. Crucially, the lock transaction lives on the DEDICATED lock
      // pool (see `createAdvisoryLockService(lockPool)`), so holding it open
      // while the work runs on the admin pool cannot starve the admin pool.
      fn: async () => {
        const existing = await this.findActiveIncidentForSystem(dedupeSystemId);
        if (existing) {
          return { incident: existing, reused: true };
        }
        // Create through the caller's wrapper (reactive entity write) so the
        // `incident.created` emit is serialized inside the dedup lock.
        const incident = await onCreate(() =>
          this.createIncident(input, userId, newId),
        );
        return { incident, reused: false };
      },
    });
  }
}
