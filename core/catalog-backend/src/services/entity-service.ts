import { eq, and } from "drizzle-orm";
import * as schema from "../schema";
import { SafeDatabase } from "@checkstack/backend-api";
import { v4 as uuidv4 } from "uuid";

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

  async createSystem(data: NewSystem) {
    const result = await this.database
      .insert(schema.systems)
      .values({ id: uuidv4(), ...data })
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

  async createGroup(data: NewGroup) {
    const result = await this.database
      .insert(schema.groups)
      .values({ id: uuidv4(), ...data })
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
