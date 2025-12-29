import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";
import { NewIncident, NewMaintenance } from "./types";
import { v4 as uuidv4 } from "uuid";

export class OperationService {
  private database: NodePgDatabase<typeof schema>;

  constructor(database: NodePgDatabase<typeof schema>) {
    this.database = database;
  }

  // Incidents
  async getIncidents() {
    return this.database.select().from(schema.incidents);
  }

  async createIncident(data: NewIncident) {
    const result = await this.database
      .insert(schema.incidents)
      .values({ id: uuidv4(), ...data })
      .returning();
    return result[0];
  }

  // Maintenances
  async getMaintenances() {
    return this.database.select().from(schema.maintenances);
  }

  async createMaintenance(data: NewMaintenance) {
    const result = await this.database
      .insert(schema.maintenances)
      .values({ ...data, id: data.id ?? uuidv4() })
      .returning();
    return result[0];
  }
}
