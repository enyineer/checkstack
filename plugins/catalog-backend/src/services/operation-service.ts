import { db } from "../index";
import { eq } from "drizzle-orm";
import { incidents, maintenances } from "../schema";
import { NewIncident, NewMaintenance } from "./types";

export class OperationService {
  // Incidents
  async getIncidents() {
    if (!db) throw new Error("Database not initialized");
    return db.select().from(incidents);
  }

  async createIncident(data: NewIncident) {
    if (!db) throw new Error("Database not initialized");
    const result = await db.insert(incidents).values(data).returning();
    return result[0];
  }

  // Maintenances
  async getMaintenances() {
    if (!db) throw new Error("Database not initialized");
    return db.select().from(maintenances);
  }

  async createMaintenance(data: NewMaintenance) {
    if (!db) throw new Error("Database not initialized");
    const result = await db.insert(maintenances).values(data).returning();
    return result[0];
  }
}

export const operationService = new OperationService();
