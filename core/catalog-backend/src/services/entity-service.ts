import { eq, and, inArray } from "drizzle-orm";
import * as schema from "../schema";
import { SafeDatabase } from "@checkstack/backend-api";
import { v4 as uuidv4 } from "uuid";

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
   * Look up a system by its exact name. Used to enforce name uniqueness on
   * create/rename (the `systems` table has no unique constraint because runtime
   * schema is set via search_path; uniqueness is enforced at the service layer).
   * Returns the first match, or undefined when the name is free.
   */
  async getSystemByName(name: string) {
    const result = await this.database
      .select()
      .from(schema.systems)
      .where(eq(schema.systems.name, name));
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

  async removeContact(contactId: string) {
    await this.database
      .delete(schema.systemContacts)
      .where(eq(schema.systemContacts.id, contactId));
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

  async removeLink(linkId: string) {
    const result = await this.database
      .delete(schema.systemLinks)
      .where(eq(schema.systemLinks.id, linkId))
      .returning();
    return result[0];
  }

  // Groups
  async getGroups() {
    // Fetch all groups
    const allGroups = await this.database.select().from(schema.groups);

    // Fetch all system-group associations
    const associations = await this.database
      .select()
      .from(schema.systemsGroups);

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

  /**
   * Create a group.
   *
   * `id` may be supplied so the reactive `catalog-group` entity can be keyed
   * on a known id BEFORE the insert runs (the create's `prev` snapshot must
   * read the not-yet-existing row as absent — see §10.4). When omitted, a
   * fresh id is generated. The id is server-owned either way.
   */
  async createGroup(data: NewGroup, id: string = uuidv4()) {
    const result = await this.database
      .insert(schema.groups)
      .values({ id, ...data })
      .returning();
    return result[0];
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
    const allEnvironments = await this.database
      .select()
      .from(schema.environments);

    const associations = await this.database
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
  }

  async getEnvironment(id: string) {
    const rows = await this.database
      .select()
      .from(schema.environments)
      .where(eq(schema.environments.id, id));
    const environment = rows[0];
    if (!environment) return;
    const associations = await this.database
      .select()
      .from(schema.systemsEnvironments)
      .where(eq(schema.systemsEnvironments.environmentId, id));
    return {
      ...environment,
      systemIds: associations.map((a) => a.systemId),
    };
  }

  /**
   * Resolve a set of environment ids to their full records (with systemIds).
   * Unknown ids are silently dropped. Used by the cross-plugin
   * `resolveEnvironments` read for the explicit-subset fan-out case.
   */
  async getEnvironmentsByIds(ids: ReadonlyArray<string>) {
    if (ids.length === 0) return [];
    const rows = await this.database
      .select()
      .from(schema.environments)
      .where(inArray(schema.environments.id, [...ids]));
    if (rows.length === 0) return [];
    const associations = await this.database
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
