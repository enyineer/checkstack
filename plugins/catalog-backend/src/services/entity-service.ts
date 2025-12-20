import { eq } from "drizzle-orm";
import { NewSystem, NewGroup, NewView } from "./types";
import * as schema from "../schema";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

export class EntityService {
  private database: NodePgDatabase<typeof schema>;

  constructor(database: NodePgDatabase<typeof schema>) {
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
      .values(data)
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

  // Groups
  async getGroups() {
    return this.database.select().from(schema.groups);
  }

  async createGroup(data: NewGroup) {
    const result = await this.database
      .insert(schema.groups)
      .values(data)
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
      .values(data)
      .returning();
    return result[0];
  }
}
