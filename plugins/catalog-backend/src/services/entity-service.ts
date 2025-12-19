import { db } from "../index";
import { eq } from "drizzle-orm";
import { systems, groups, views } from "../schema";
import { NewSystem, NewGroup, NewView } from "./types";

export class EntityService {
  // Systems
  async getSystems() {
    if (!db) throw new Error("Database not initialized");
    return db.select().from(systems);
  }

  async getSystem(id: string) {
    if (!db) throw new Error("Database not initialized");
    const result = await db.select().from(systems).where(eq(systems.id, id));
    return result[0];
  }

  async createSystem(data: NewSystem) {
    if (!db) throw new Error("Database not initialized");
    const result = await db.insert(systems).values(data).returning();
    return result[0];
  }

  // Groups
  async getGroups() {
    if (!db) throw new Error("Database not initialized");
    return db.select().from(groups);
  }

  async createGroup(data: NewGroup) {
    if (!db) throw new Error("Database not initialized");
    const result = await db.insert(groups).values(data).returning();
    return result[0];
  }

  // Views
  async getViews() {
    if (!db) throw new Error("Database not initialized");
    return db.select().from(views);
  }

  async getView(id: string) {
    if (!db) throw new Error("Database not initialized");
    const result = await db.select().from(views).where(eq(views.id, id));
    return result[0];
  }

  async createView(data: NewView) {
    if (!db) throw new Error("Database not initialized");
    const result = await db.insert(views).values(data).returning();
    return result[0];
  }
}

export const entityService = new EntityService();
