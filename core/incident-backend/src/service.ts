import { eq, and, inArray, ne, isNotNull } from "drizzle-orm";
import { withScopedTransaction } from "@checkstack/backend-api";
import type {
  AdvisoryLockService,
  SafeDatabase,
  ScopedQueryRunner,
} from "@checkstack/backend-api";
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
  UpdateIncidentLinkInput,
  CreateIncidentInput,
  UpdateIncidentInput,
  AddIncidentUpdateInput,
  EditIncidentUpdateInput,
  IncidentStatus,
  IncidentSeverity,
  IncidentUpdateEditSnapshot,
  SystemHealthOverride,
} from "@checkstack/incident-common";
import { desc } from "drizzle-orm";

type Db = SafeDatabase<typeof schema>;

/** The transaction handle drizzle hands to `db.transaction(async (tx) => ...)`. */
type IncidentTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Derive an incident's header status from its timeline: the `statusChange` of
 * the MOST RECENT status-bearing update (message-only updates are ignored), so
 * the header always follows the newest update that actually declared a status.
 * Returns undefined when no update carries a status (nothing to derive). Runs on
 * the passed `tx` so an edit/delete re-derivation is atomic with the write that
 * triggered it. Centralized so `editUpdate` and `deleteUpdate` can never
 * diverge on how "current status" is resolved.
 */
async function deriveStatusFromTimeline(
  tx: IncidentTx,
  incidentId: string,
): Promise<IncidentStatus | undefined> {
  const [latest] = await tx
    .select({ statusChange: incidentUpdates.statusChange })
    .from(incidentUpdates)
    .where(
      and(
        eq(incidentUpdates.incidentId, incidentId),
        isNotNull(incidentUpdates.statusChange),
      ),
    )
    .orderBy(desc(incidentUpdates.createdAt), desc(incidentUpdates.id))
    .limit(1);
  return latest?.statusChange ?? undefined;
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
    const statusFilter = filters?.status
      ? eq(incidents.status, filters.status)
      : filters?.includeResolved
        ? undefined
        : ne(incidents.status, "resolved");

    // One SET LOCAL for the whole read fan-out. System associations are fetched
    // in a SINGLE set-based `inArray` query and grouped in JS, instead of the
    // former per-row N+1 loop (mirrors `getManyEntityStates`).
    return withScopedTransaction(this.db, async (tx) => {
      let incidentRows;

      if (filters?.systemId) {
        // Filter by system - need to join
        const systemIncidentIds = await tx
          .select({ incidentId: incidentSystems.incidentId })
          .from(incidentSystems)
          .where(eq(incidentSystems.systemId, filters.systemId));

        const ids = systemIncidentIds.map((r) => r.incidentId);
        if (ids.length === 0) return [];

        incidentRows = await tx
          .select()
          .from(incidents)
          .where(and(inArray(incidents.id, ids), statusFilter));
      } else {
        incidentRows = await tx.select().from(incidents).where(statusFilter);
      }

      if (incidentRows.length === 0) return [];

      const systemsByIncident = await this.getSystemsByIncident(
        tx,
        incidentRows.map((i) => i.id),
      );

      return incidentRows.map((i) => ({
        ...i,
        description: i.description ?? undefined,
        systemIds: systemsByIncident.get(i.id) ?? [],
      }));
    });
  }

  /**
   * Read the system associations for a set of incident ids in ONE set-based
   * `inArray` query and group them by incidentId. Runs on the passed runner
   * (the scoped db OR a batching `tx`), so callers that already hold a
   * transaction reuse its single `SET LOCAL search_path`. Replaces the former
   * per-row N+1 loop used by the list/for-system reads.
   */
  private async getSystemsByIncident(
    runner: ScopedQueryRunner<typeof schema>,
    incidentIds: string[],
  ): Promise<Map<string, string[]>> {
    const byIncident = new Map<string, string[]>();
    if (incidentIds.length === 0) return byIncident;

    const systemRows = await runner
      .select({
        incidentId: incidentSystems.incidentId,
        systemId: incidentSystems.systemId,
      })
      .from(incidentSystems)
      .where(inArray(incidentSystems.incidentId, incidentIds));

    for (const r of systemRows) {
      const list = byIncident.get(r.incidentId);
      if (list) list.push(r.systemId);
      else byIncident.set(r.incidentId, [r.systemId]);
    }
    return byIncident;
  }

  /**
   * Get single incident with full details
   */
  async getIncident(id: string): Promise<IncidentDetail | undefined> {
    // Batch the 4 sequential reads (incident -> systems -> updates -> links)
    // behind a single `SET LOCAL search_path`.
    return withScopedTransaction(this.db, async (tx) => {
      const [incident] = await tx
        .select()
        .from(incidents)
        .where(eq(incidents.id, id));

      if (!incident) return;

      const systems = await tx
        .select({ systemId: incidentSystems.systemId })
        .from(incidentSystems)
        .where(eq(incidentSystems.incidentId, id));

      const updates = await tx
        .select()
        .from(incidentUpdates)
        .where(eq(incidentUpdates.incidentId, id));

      const links = await tx
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
          editedAt: u.editedAt ?? undefined,
          editHistory: u.editHistory ?? [],
          createdBy: u.createdBy ?? undefined,
        })),
        links,
      };
    });
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

    // Batch the incidents read + junction read behind a single `SET LOCAL`.
    return withScopedTransaction(this.db, async (tx) => {
      const rows = await tx
        .select({
          id: incidents.id,
          status: incidents.status,
          severity: incidents.severity,
        })
        .from(incidents)
        .where(inArray(incidents.id, [...ids]));
      if (rows.length === 0) return {};

      const systemsByIncident = await this.getSystemsByIncident(
        tx,
        rows.map((r) => r.id),
      );

      const out: Record<
        string,
        {
          status: IncidentStatus;
          severity: IncidentSeverity;
          systemIds: string[];
        }
      > = {};
      for (const row of rows) {
        out[row.id] = {
          status: row.status,
          severity: row.severity,
          systemIds: systemsByIncident.get(row.id) ?? [],
        };
      }
      return out;
    });
  }

  /**
   * Bulk read of each incident's FULL update timeline (all visibilities),
   * keyed by incident id, in ONE set-based `inArray` query grouped in JS -
   * instead of an N+1 fan-out of {@link getIncident} the status-page widget
   * used purely for `.updates`. Returns the same raw update shape `getIncident`
   * produces; the ROUTER applies audience filtering + name resolution on top,
   * so no visibility policy lives here. Incidents with no updates are omitted.
   */
  async getBulkIncidentUpdates(
    incidentIds: string[],
  ): Promise<Record<string, IncidentUpdate[]>> {
    if (incidentIds.length === 0) return {};

    const rows = await withScopedTransaction(this.db, (tx) =>
      tx
        .select()
        .from(incidentUpdates)
        .where(inArray(incidentUpdates.incidentId, incidentIds)),
    );

    const out: Record<string, IncidentUpdate[]> = {};
    for (const u of rows) {
      const mapped: IncidentUpdate = {
        ...u,
        statusChange: u.statusChange ?? undefined,
        editedAt: u.editedAt ?? undefined,
        editHistory: u.editHistory ?? [],
        createdBy: u.createdBy ?? undefined,
      };
      const list = out[u.incidentId];
      if (list) list.push(mapped);
      else out[u.incidentId] = [mapped];
    }
    return out;
  }

  /**
   * Get active incidents for a system
   */
  async getIncidentsForSystem(
    systemId: string,
  ): Promise<IncidentWithSystems[]> {
    return withScopedTransaction(this.db, async (tx) => {
      // Get incident IDs for this system
      const systemIncidents = await tx
        .select({ incidentId: incidentSystems.incidentId })
        .from(incidentSystems)
        .where(eq(incidentSystems.systemId, systemId));

      const ids = systemIncidents.map((r) => r.incidentId);
      if (ids.length === 0) return [];

      // Get only non-resolved incidents
      const rows = await tx
        .select()
        .from(incidents)
        .where(
          and(inArray(incidents.id, ids), ne(incidents.status, "resolved")),
        );
      if (rows.length === 0) return [];

      // Fetch the full system membership for all matched incidents in ONE
      // set-based query (was a per-row N+1 loop).
      const systemsByIncident = await this.getSystemsByIncident(
        tx,
        rows.map((i) => i.id),
      );

      return rows.map((i) => ({
        ...i,
        description: i.description ?? undefined,
        systemIds: systemsByIncident.get(i.id) ?? [],
      }));
    });
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
    // Batch the open-incidents read + junction read behind one `SET LOCAL`.
    return withScopedTransaction(this.db, async (tx) => {
      const openRows = await tx
        .select()
        .from(incidents)
        .where(ne(incidents.status, "resolved"));
      if (openRows.length === 0) return {};

      const systemsByIncident = await this.getSystemsByIncident(
        tx,
        openRows.map((i) => i.id),
      );

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
    });
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
    // The inserted row is returned via `.returning()`, removing the former
    // post-commit re-select.
    const update = await this.db.transaction(async (tx) => {
      // If status change is provided, update the incident status
      if (input.statusChange) {
        await tx
          .update(incidents)
          .set({ status: input.statusChange, updatedAt: new Date() })
          .where(eq(incidents.id, input.incidentId));
      }

      const [inserted] = await tx
        .insert(incidentUpdates)
        .values({
          id,
          incidentId: input.incidentId,
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
   * Edit a published update in place. Scoped by `incidentId` (mirrors
   * `removeLink`): a caller authorized against THIS incident cannot pair an
   * update id with a foreign incident. Only the provided fields change. When any
   * field actually changes, the CURRENT values are archived into `editHistory`
   * (oldest first) and `editedAt` is stamped, so the timeline can show a
   * GitHub-style history of edits. A no-op edit (nothing changed) neither
   * archives a snapshot nor marks the update "edited".
   *
   * When the edit touches `statusChange` OR re-times the update (`createdAt`),
   * the incident's own `status` is re-derived from the most recent
   * status-bearing update (see {@link deriveStatusFromTimeline}) so the header
   * and timeline never diverge - including the edge case where the latest row is
   * message-only and the header must follow an earlier status-bearing update,
   * and the case where re-timing changes which update is latest.
   */
  async editUpdate(
    input: EditIncidentUpdateInput,
  ): Promise<IncidentUpdate | undefined> {
    const [existing] = await this.db
      .select()
      .from(incidentUpdates)
      .where(
        and(
          eq(incidentUpdates.id, input.id),
          eq(incidentUpdates.incidentId, input.incidentId),
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
    const updateData: Partial<typeof incidentUpdates.$inferInsert> = {};
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
      const snapshot: IncidentUpdateEditSnapshot = {
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
        .update(incidentUpdates)
        .set(updateData)
        .where(
          and(
            eq(incidentUpdates.id, input.id),
            eq(incidentUpdates.incidentId, input.incidentId),
          ),
        )
        .returning();

      // Re-derive the header from the most recent status-bearing update
      // whenever the edit touched a status OR re-timed the update. This handles
      // editing a non-latest update (header keeps the newest status), the
      // message-only latest edge case (header follows the prior status-bearing
      // update), AND a re-time that changes which update is latest.
      if (input.statusChange !== undefined || createdAtChanged) {
        const derived = await deriveStatusFromTimeline(tx, input.incidentId);
        if (derived) {
          await tx
            .update(incidents)
            .set({ status: derived, updatedAt: new Date() })
            .where(eq(incidents.id, input.incidentId));
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
   * Delete a published update. Scoped by `incidentId` (mirrors `removeLink`).
   * Returns the parent incidentId so the caller can invalidate caches, or
   * undefined if the update did not exist under that incident.
   *
   * When the deleted update CARRIED a status, the incident's `status` is
   * re-derived from the remaining timeline in the SAME transaction (see
   * {@link deriveStatusFromTimeline}) so deleting the latest status-bearing
   * update never leaves the header pinned to a now-gone status. A message-only
   * delete can never change the derived status, so it skips the re-derivation.
   * If no status-bearing update remains, the status is left intact (deletion is
   * irreversible; we never null a status the header still needs).
   */
  async deleteUpdate(
    id: string,
    incidentId: string,
  ): Promise<string | undefined> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(incidentUpdates)
        .where(
          and(
            eq(incidentUpdates.id, id),
            eq(incidentUpdates.incidentId, incidentId),
          ),
        );
      if (!existing) return;

      await tx
        .delete(incidentUpdates)
        .where(
          and(
            eq(incidentUpdates.id, id),
            eq(incidentUpdates.incidentId, incidentId),
          ),
        );

      if (existing.statusChange !== null) {
        const derived = await deriveStatusFromTimeline(tx, incidentId);
        if (derived) {
          await tx
            .update(incidents)
            .set({ status: derived, updatedAt: new Date() })
            .where(eq(incidents.id, incidentId));
        }
      }

      return existing.incidentId;
    });
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
    // `.returning()` yields the inserted row directly, removing the former
    // standalone re-select (one query instead of two).
    const [row] = await this.db
      .insert(incidentLinks)
      .values({
        id,
        incidentId: input.incidentId,
        label: input.label,
        url: input.url,
        visibility: input.visibility ?? "public",
      })
      .returning();
    return row;
  }

  /**
   * Edit a hotlink in place. Scoped by `incidentId` (anti-spoof, mirrors
   * `removeLink`): a link belonging to a different incident cannot be edited by
   * pairing its id with an incident the caller manages. Only the provided fields
   * change; returns the updated row, or undefined if the pair did not match.
   */
  async updateLink(
    input: UpdateIncidentLinkInput,
  ): Promise<IncidentLink | undefined> {
    const [existing] = await this.db
      .select()
      .from(incidentLinks)
      .where(
        and(
          eq(incidentLinks.id, input.id),
          eq(incidentLinks.incidentId, input.incidentId),
        ),
      );
    if (!existing) return undefined;

    const updateData: Partial<typeof incidentLinks.$inferInsert> = {};
    if (input.label !== undefined) updateData.label = input.label;
    if (input.url !== undefined) updateData.url = input.url;
    if (input.visibility !== undefined)
      updateData.visibility = input.visibility;
    if (Object.keys(updateData).length === 0) return existing;

    const [row] = await this.db
      .update(incidentLinks)
      .set(updateData)
      .where(
        and(
          eq(incidentLinks.id, input.id),
          eq(incidentLinks.incidentId, input.incidentId),
        ),
      )
      .returning();
    return row;
  }

  /**
   * Remove a hotlink. Returns the parent incidentId so the caller can
   * invalidate the right cache entry, or undefined if the link did not
   * exist.
   */
  async removeLink(id: string, incidentId: string): Promise<string | undefined> {
    // Scope by incidentId: the caller is authorized (idParam) against THIS
    // incident, so a link belonging to a different incident must not be
    // removable by pairing its link id with an incident the caller manages.
    const [existing] = await this.db
      .select()
      .from(incidentLinks)
      .where(
        and(eq(incidentLinks.id, id), eq(incidentLinks.incidentId, incidentId)),
      );
    if (!existing) return undefined;
    await this.db
      .delete(incidentLinks)
      .where(
        and(eq(incidentLinks.id, id), eq(incidentLinks.incidentId, incidentId)),
      );
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
