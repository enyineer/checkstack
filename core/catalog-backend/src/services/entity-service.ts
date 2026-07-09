import { eq, and, inArray, sql } from "drizzle-orm";
import * as schema from "../schema";
import {
  SafeDatabase,
  withScopedTransaction,
  type ScopedQueryRunner,
} from "@checkstack/backend-api";
import { v4 as uuidv4 } from "uuid";
import { diffSystemEnvironments } from "./environment-membership";

/** Reactive subset of a catalog system (the `catalog-system` entity state). */
type CatalogSystemEntityState = {
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
};

/** Reactive subset of a catalog group (the `catalog-group` entity state). */
type CatalogGroupEntityState = {
  name: string;
  metadata: Record<string, unknown>;
};

/**
 * Narrow the drizzle `json()` column (typed `unknown`) to the reactive
 * `Record<string, unknown>` metadata shape, defaulting non-object values
 * (null / scalars / arrays) to an empty object so the entity state is always
 * a well-formed record.
 */
function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// Type aliases for entity creation
type NewSystem = {
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

type NewContact = {
  systemId: string;
  type: "user" | "mailbox";
  userId?: string;
  email?: string;
  label?: string;
};

type NewGroup = {
  name: string;
  metadata?: Record<string, unknown>;
};

type NewEnvironment = {
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

type NewView = {
  name: string;
  type: string;
  config: Record<string, unknown>;
};

export class EntityService {
  private database: SafeDatabase<typeof schema>;

  constructor(database: SafeDatabase<typeof schema>) {
    this.database = database;
  }

  // Systems
  async getSystems() {
    return this.database.select().from(schema.systems);
  }

  async getSystem(id: string) {
    const result = await this.database
      .select()
      .from(schema.systems)
      .where(eq(schema.systems.id, id));
    return result[0];
  }

  /**
   * Look up a system by name, CASE-INSENSITIVELY. Used for the friendly
   * pre-write uniqueness check on create/rename; the `systems_name_unique`
   * functional index (`lower(name)`) is the actual race-safe guard, and this
   * mirrors its case-folding so the pre-check catches "Api" vs "api" too (a
   * case-sensitive `eq` would miss it and leave only the generic DB conflict).
   * Returns the first match, or undefined when the name is free.
   */
  async getSystemByName(name: string) {
    const result = await this.database
      .select()
      .from(schema.systems)
      .where(sql`lower(${schema.systems.name}) = lower(${name})`);
    return result[0];
  }

  /**
   * Create a system.
   *
   * `id` may be supplied by the caller so the reactive `catalog-system`
   * entity can be keyed on a known id BEFORE the insert runs (the create's
   * `prev` snapshot must read the not-yet-existing row as absent — see
   * §10.4). When omitted, a fresh id is generated. The id is server-owned
   * either way.
   */
  async createSystem(data: NewSystem, id: string = uuidv4()) {
    const result = await this.database
      .insert(schema.systems)
      .values({ id, ...data })
      .returning();
    return result[0];
  }

  async updateSystem(id: string, data: Partial<NewSystem>) {
    const result = await this.database
      .update(schema.systems)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.systems.id, id))
      .returning();
    return result[0];
  }

  async deleteSystem(id: string) {
    await this.database.delete(schema.systems).where(eq(schema.systems.id, id));
  }

  /**
   * Batched reactive-state read for the `catalog-system` entity (Model B
   * plugin-backed `read` accessor). Given system ids, return the reactive
   * subset `{ name, description, metadata }` for each that exists (missing
   * ids omitted). Reads the AUTHORITATIVE `systems` table — no framework
   * `entity_state` storage. This is the single source of truth
   * `handle.mutate` snapshots `prev` from and `get`/`getMany`/scope
   * enrichment route through.
   */
  async getManySystemEntityStates(
    ids: ReadonlyArray<string>,
  ): Promise<Record<string, CatalogSystemEntityState>> {
    if (ids.length === 0) return {};
    const rows = await this.database
      .select({
        id: schema.systems.id,
        name: schema.systems.name,
        description: schema.systems.description,
        metadata: schema.systems.metadata,
      })
      .from(schema.systems)
      .where(inArray(schema.systems.id, [...ids]));

    const out: Record<string, CatalogSystemEntityState> = {};
    for (const row of rows) {
      out[row.id] = {
        name: row.name,
        description: row.description ?? null,
        metadata: normalizeMetadata(row.metadata),
      };
    }
    return out;
  }

  // System Contacts
  async getContactsForSystem(systemId: string) {
    return this.database
      .select()
      .from(schema.systemContacts)
      .where(eq(schema.systemContacts.systemId, systemId));
  }

  async addContact(data: NewContact) {
    const result = await this.database
      .insert(schema.systemContacts)
      .values({ id: uuidv4(), ...data })
      .returning();
    return result[0];
  }

  // Scoped by BOTH the contact id and its parent systemId so a manager of one
  // system cannot delete another system's contact by passing a foreign contact
  // id (the instanceAccess check only proves manage on `systemId`). Returns the
  // deleted row, or undefined when nothing matched both predicates.
  async removeContact({
    contactId,
    systemId,
  }: {
    contactId: string;
    systemId: string;
  }) {
    const result = await this.database
      .delete(schema.systemContacts)
      .where(
        and(
          eq(schema.systemContacts.id, contactId),
          eq(schema.systemContacts.systemId, systemId),
        ),
      )
      .returning();
    return result[0];
  }

  async deleteContactsByUserId(userId: string) {
    await this.database
      .delete(schema.systemContacts)
      .where(eq(schema.systemContacts.userId, userId));
  }

  // System Links — free-form URLs attached to a system
  async getLinksForSystem(systemId: string) {
    return this.database
      .select()
      .from(schema.systemLinks)
      .where(eq(schema.systemLinks.systemId, systemId));
  }

  async addLink(props: { systemId: string; label?: string; url: string }) {
    const result = await this.database
      .insert(schema.systemLinks)
      .values({ id: uuidv4(), ...props })
      .returning();
    return result[0];
  }

  // Edit a link in place, scoped by BOTH the link id and its parent systemId
  // (anti-spoof, same reasoning as removeLink): a manager of one system cannot
  // edit another system's link by passing a foreign link id. Only the provided
  // fields change; returns the updated row, or undefined when nothing matched
  // both predicates.
  async updateLink({
    linkId,
    systemId,
    label,
    url,
  }: {
    linkId: string;
    systemId: string;
    label?: string;
    url?: string;
  }) {
    const scope = and(
      eq(schema.systemLinks.id, linkId),
      eq(schema.systemLinks.systemId, systemId),
    );
    const updateData: Partial<typeof schema.systemLinks.$inferInsert> = {};
    if (label !== undefined) updateData.label = label;
    if (url !== undefined) updateData.url = url;
    if (Object.keys(updateData).length === 0) {
      const [existing] = await this.database
        .select()
        .from(schema.systemLinks)
        .where(scope);
      return existing;
    }
    const result = await this.database
      .update(schema.systemLinks)
      .set(updateData)
      .where(scope)
      .returning();
    return result[0];
  }

  // Scoped by BOTH the link id and its parent systemId so a manager of one
  // system cannot delete another system's link by passing a foreign link id
  // (the instanceAccess check only proves manage on `systemId`). Returns the
  // deleted row, or undefined when nothing matched both predicates.
  async removeLink({ linkId, systemId }: { linkId: string; systemId: string }) {
    const result = await this.database
      .delete(schema.systemLinks)
      .where(
        and(
          eq(schema.systemLinks.id, linkId),
          eq(schema.systemLinks.systemId, systemId),
        ),
      )
      .returning();
    return result[0];
  }

  // Groups

  /**
   * Read all groups (persisted browse order) plus their system memberships and
   * join them in-memory. Threaded onto a `runner` (the scoped db OR a
   * transaction handle) so it composes inside a batching transaction — e.g.
   * `getEntitiesTopology` reads systems on the SAME `tx`.
   */
  private async readGroupsPopulated(runner: ScopedQueryRunner<typeof schema>) {
    // Fetch all groups in persisted browse order (sortOrder asc). A stable
    // tiebreak on createdAt keeps equal sortOrder deterministic.
    const allGroups = await runner
      .select()
      .from(schema.groups)
      .orderBy(schema.groups.sortOrder, schema.groups.createdAt);

    // Fetch all system-group associations
    const associations = await runner.select().from(schema.systemsGroups);

    // Build a map of groupId -> systemIds[]
    const groupSystemsMap = new Map<string, string[]>();
    for (const assoc of associations) {
      const existing = groupSystemsMap.get(assoc.groupId) ?? [];
      existing.push(assoc.systemId);
      groupSystemsMap.set(assoc.groupId, existing);
    }

    // Attach systemIds to each group
    return allGroups.map((group) => ({
      ...group,
      systemIds: groupSystemsMap.get(group.id) ?? [],
    }));
  }

  async getGroups() {
    // Batch the 2 reads (groups + all memberships) into ONE scoped transaction
    // so the fan-out pays a single BEGIN/SET LOCAL/COMMIT and holds one
    // connection instead of 2 standalone scoped queries. See
    // withScopedTransaction.
    return withScopedTransaction(this.database, (tx) =>
      this.readGroupsPopulated(tx),
    );
  }

  /**
   * Batched topology read for `getEntities`: systems + groups (with their
   * system memberships) under ONE scoped transaction, so the whole read pays a
   * single BEGIN/SET LOCAL/COMMIT instead of the 3 standalone scoped queries
   * `getSystems()` + `getGroups()` would issue back-to-back. Output shape is
   * identical to `{ systems: getSystems(), groups: getGroups() }`.
   */
  async getEntitiesTopology() {
    return withScopedTransaction(this.database, async (tx) => {
      const systems = await tx.select().from(schema.systems);
      const groups = await this.readGroupsPopulated(tx);
      return { systems, groups };
    });
  }

  /**
   * Create a group.
   *
   * `id` may be supplied so the reactive `catalog-group` entity can be keyed
   * on a known id BEFORE the insert runs (the create's `prev` snapshot must
   * read the not-yet-existing row as absent — see §10.4). When omitted, a
   * fresh id is generated. The id is server-owned either way.
   */
  async createGroup(data: NewGroup, id: string = uuidv4()) {
    // Append new groups after the current maximum so a fresh group lands at the
    // end of the persisted browse order rather than colliding on the default 0.
    //
    // Wrapping the max(sortOrder) read and the insert in ONE scoped transaction
    // both collapses the two standalone scoped queries into a single
    // BEGIN/SET LOCAL/COMMIT AND tightens the read-then-insert race: the max
    // read and the insert now run back-to-back on one connection inside one
    // transaction with no await interleaving between them, instead of two
    // separate auto-committed statements a concurrent create could slot into.
    return withScopedTransaction(this.database, async (tx) => {
      const [{ maxOrder } = { maxOrder: null }] = await tx
        .select({
          maxOrder: sql<number | null>`max(${schema.groups.sortOrder})`,
        })
        .from(schema.groups);
      const nextSortOrder = (maxOrder ?? -1) + 1;
      const result = await tx
        .insert(schema.groups)
        .values({ id, sortOrder: nextSortOrder, ...data })
        .returning();
      return result[0];
    });
  }

  /**
   * Persist a new browse order for groups. Each id in `orderedIds` is assigned
   * a `sortOrder` equal to its position in the array. Ids not present are left
   * untouched. Runs in a single transaction so the reorder is atomic.
   */
  async reorderGroups(orderedIds: string[]) {
    if (orderedIds.length === 0) return;
    await this.database.transaction(async (tx) => {
      for (const [index, id] of orderedIds.entries()) {
        await tx
          .update(schema.groups)
          .set({ sortOrder: index, updatedAt: new Date() })
          .where(eq(schema.groups.id, id));
      }
    });
  }

  async updateGroup(id: string, data: Partial<NewGroup>) {
    const result = await this.database
      .update(schema.groups)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.groups.id, id))
      .returning();
    return result[0];
  }

  async deleteGroup(id: string) {
    await this.database.delete(schema.groups).where(eq(schema.groups.id, id));
  }

  /**
   * Batched reactive-state read for the `catalog-group` entity (Model B
   * plugin-backed `read` accessor). Given group ids, return the reactive
   * subset `{ name, metadata }` for each that exists (missing ids omitted).
   * Reads the AUTHORITATIVE `groups` table — no framework `entity_state`
   * storage.
   */
  async getManyGroupEntityStates(
    ids: ReadonlyArray<string>,
  ): Promise<Record<string, CatalogGroupEntityState>> {
    if (ids.length === 0) return {};
    const rows = await this.database
      .select({
        id: schema.groups.id,
        name: schema.groups.name,
        metadata: schema.groups.metadata,
      })
      .from(schema.groups)
      .where(inArray(schema.groups.id, [...ids]));

    const out: Record<string, CatalogGroupEntityState> = {};
    for (const row of rows) {
      out[row.id] = {
        name: row.name,
        metadata: normalizeMetadata(row.metadata),
      };
    }
    return out;
  }

  async getGroupsForSystem(systemId: string) {
    const associations = await this.database
      .select()
      .from(schema.systemsGroups)
      .where(eq(schema.systemsGroups.systemId, systemId));

    return associations;
  }

  async addSystemToGroup(props: { groupId: string; systemId: string }) {
    const { groupId, systemId } = props;
    await this.database
      .insert(schema.systemsGroups)
      .values({ groupId, systemId })
      .onConflictDoNothing();
  }

  async removeSystemFromGroup(props: { groupId: string; systemId: string }) {
    const { groupId, systemId } = props;
    await this.database
      .delete(schema.systemsGroups)
      .where(
        and(
          eq(schema.systemsGroups.groupId, groupId),
          eq(schema.systemsGroups.systemId, systemId),
        ),
      );
  }

  // Environments — instance-wide catalog primitive (M:N with systems)
  async getEnvironments() {
    // Batch the 2 reads (environments + all memberships) into ONE scoped
    // transaction — a single BEGIN/SET LOCAL/COMMIT for the fan-out.
    return withScopedTransaction(this.database, async (tx) => {
      const allEnvironments = await tx.select().from(schema.environments);

      const associations = await tx
        .select()
        .from(schema.systemsEnvironments);

      const envSystemsMap = new Map<string, string[]>();
      for (const assoc of associations) {
        const existing = envSystemsMap.get(assoc.environmentId) ?? [];
        existing.push(assoc.systemId);
        envSystemsMap.set(assoc.environmentId, existing);
      }

      return allEnvironments.map((environment) => ({
        ...environment,
        systemIds: envSystemsMap.get(environment.id) ?? [],
      }));
    });
  }

  async getEnvironment(id: string) {
    // Batch the environment read + its membership read into ONE scoped
    // transaction (single BEGIN/SET LOCAL/COMMIT).
    return withScopedTransaction(this.database, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.environments)
        .where(eq(schema.environments.id, id));
      const environment = rows[0];
      if (!environment) return;
      const associations = await tx
        .select()
        .from(schema.systemsEnvironments)
        .where(eq(schema.systemsEnvironments.environmentId, id));
      return {
        ...environment,
        systemIds: associations.map((a) => a.systemId),
      };
    });
  }

  /**
   * Read environment records for `ids` (with systemIds), joining memberships
   * in-memory. Threaded onto a `runner` so it composes inside a batching
   * transaction — `getEnvironmentsByIds` and `getEnvironmentsForSystemPopulated`
   * both run it on their own `tx`.
   */
  private async readEnvironmentsByIds(
    runner: ScopedQueryRunner<typeof schema>,
    ids: ReadonlyArray<string>,
  ) {
    if (ids.length === 0) return [];
    const rows = await runner
      .select()
      .from(schema.environments)
      .where(inArray(schema.environments.id, [...ids]));
    if (rows.length === 0) return [];
    const associations = await runner
      .select()
      .from(schema.systemsEnvironments)
      .where(inArray(schema.systemsEnvironments.environmentId, [...ids]));
    const envSystemsMap = new Map<string, string[]>();
    for (const assoc of associations) {
      const existing = envSystemsMap.get(assoc.environmentId) ?? [];
      existing.push(assoc.systemId);
      envSystemsMap.set(assoc.environmentId, existing);
    }
    return rows.map((environment) => ({
      ...environment,
      systemIds: envSystemsMap.get(environment.id) ?? [],
    }));
  }

  /**
   * Resolve a set of environment ids to their full records (with systemIds).
   * Unknown ids are silently dropped. Used by the cross-plugin
   * `resolveEnvironments` read for the explicit-subset fan-out case. The 2
   * reads run under ONE scoped transaction.
   */
  async getEnvironmentsByIds(ids: ReadonlyArray<string>) {
    if (ids.length === 0) return [];
    return withScopedTransaction(this.database, (tx) =>
      this.readEnvironmentsByIds(tx, ids),
    );
  }

  /**
   * Resolve a system's environments (full records with systemIds) under ONE
   * scoped transaction: read the system's memberships, then the environment
   * records for those ids. Collapses two standalone scoped reads into a single
   * BEGIN/SET LOCAL/COMMIT. Output is identical to
   * `getEnvironmentsByIds(getEnvironmentsForSystem(systemId).map(...))`.
   */
  async getEnvironmentsForSystemPopulated(systemId: string) {
    return withScopedTransaction(this.database, async (tx) => {
      const memberships = await tx
        .select()
        .from(schema.systemsEnvironments)
        .where(eq(schema.systemsEnvironments.systemId, systemId));
      return this.readEnvironmentsByIds(
        tx,
        memberships.map((m) => m.environmentId),
      );
    });
  }

  async createEnvironment(data: NewEnvironment, id: string = uuidv4()) {
    const result = await this.database
      .insert(schema.environments)
      .values({ id, ...data })
      .returning();
    return result[0];
  }

  async updateEnvironment(id: string, data: Partial<NewEnvironment>) {
    const result = await this.database
      .update(schema.environments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.environments.id, id))
      .returning();
    return result[0];
  }

  async deleteEnvironment(id: string) {
    await this.database
      .delete(schema.environments)
      .where(eq(schema.environments.id, id));
  }

  async getEnvironmentsForSystem(systemId: string) {
    return this.database
      .select()
      .from(schema.systemsEnvironments)
      .where(eq(schema.systemsEnvironments.systemId, systemId));
  }

  async getSystemsForEnvironment(environmentId: string) {
    return this.database
      .select()
      .from(schema.systemsEnvironments)
      .where(eq(schema.systemsEnvironments.environmentId, environmentId));
  }

  async addSystemToEnvironment(props: {
    environmentId: string;
    systemId: string;
  }) {
    const { environmentId, systemId } = props;
    await this.database
      .insert(schema.systemsEnvironments)
      .values({ environmentId, systemId })
      .onConflictDoNothing();
  }

  async removeSystemFromEnvironment(props: {
    environmentId: string;
    systemId: string;
  }) {
    const { environmentId, systemId } = props;
    await this.database
      .delete(schema.systemsEnvironments)
      .where(
        and(
          eq(schema.systemsEnvironments.environmentId, environmentId),
          eq(schema.systemsEnvironments.systemId, systemId),
        ),
      );
  }

  /**
   * Replace a system's environment memberships so it belongs to EXACTLY
   * `environmentIds`. Reads the current memberships, diffs against the desired
   * set, then applies the N adds + M removes — all inside ONE scoped
   * transaction. This both collapses the read + N·M writes into a single
   * BEGIN/SET LOCAL/COMMIT and makes the swap atomic: no partial membership
   * state (some rows added, others not yet removed) is ever observable.
   */
  async setSystemEnvironments(props: {
    systemId: string;
    environmentIds: ReadonlyArray<string>;
  }) {
    const { systemId, environmentIds } = props;
    await withScopedTransaction(this.database, async (tx) => {
      const current = await tx
        .select()
        .from(schema.systemsEnvironments)
        .where(eq(schema.systemsEnvironments.systemId, systemId));
      const { toAdd, toRemove } = diffSystemEnvironments({
        current: current.map((row) => row.environmentId),
        desired: [...environmentIds],
      });
      for (const environmentId of toAdd) {
        await tx
          .insert(schema.systemsEnvironments)
          .values({ environmentId, systemId })
          .onConflictDoNothing();
      }
      for (const environmentId of toRemove) {
        await tx
          .delete(schema.systemsEnvironments)
          .where(
            and(
              eq(schema.systemsEnvironments.environmentId, environmentId),
              eq(schema.systemsEnvironments.systemId, systemId),
            ),
          );
      }
    });
  }

  // Views
  async getViews() {
    return this.database.select().from(schema.views);
  }

  async getView(id: string) {
    const result = await this.database
      .select()
      .from(schema.views)
      .where(eq(schema.views.id, id));
    return result[0];
  }

  async createView(data: NewView) {
    const result = await this.database
      .insert(schema.views)
      .values({ id: uuidv4(), ...data })
      .returning();
    return result[0];
  }
}
