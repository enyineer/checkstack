import {
  HealthCheckConfiguration,
  CreateHealthCheckConfiguration,
  UpdateHealthCheckConfiguration,
} from "@checkmate/healthcheck-common";
import {
  healthCheckConfigurations,
  systemHealthChecks,
  healthCheckRuns,
} from "./schema";
import * as schema from "./schema";
import { eq, and, InferSelectModel, desc } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

// Drizzle type helper
type Db = NodePgDatabase<typeof schema>;

export class HealthCheckService {
  constructor(private db: Db) {}

  async createConfiguration(
    data: CreateHealthCheckConfiguration
  ): Promise<HealthCheckConfiguration> {
    const [config] = await this.db
      .insert(healthCheckConfigurations)
      .values({
        name: data.name,
        strategyId: data.strategyId,
        config: data.config,
        intervalSeconds: data.intervalSeconds,
        isTemplate: false, // Defaulting for now
      })
      .returning();
    return this.mapConfig(config);
  }

  async getConfiguration(
    id: string
  ): Promise<HealthCheckConfiguration | undefined> {
    const [config] = await this.db
      .select()
      .from(healthCheckConfigurations)
      .where(eq(healthCheckConfigurations.id, id));
    return config ? this.mapConfig(config) : undefined;
  }

  async updateConfiguration(
    id: string,
    data: UpdateHealthCheckConfiguration
  ): Promise<HealthCheckConfiguration | undefined> {
    const [config] = await this.db
      .update(healthCheckConfigurations)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(healthCheckConfigurations.id, id))
      .returning();
    return config ? this.mapConfig(config) : undefined;
  }

  async deleteConfiguration(id: string): Promise<void> {
    await this.db
      .delete(healthCheckConfigurations)
      .where(eq(healthCheckConfigurations.id, id));
  }

  async getConfigurations(): Promise<HealthCheckConfiguration[]> {
    const configs = await this.db.select().from(healthCheckConfigurations);
    return configs.map((c) => this.mapConfig(c));
  }

  async associateSystem(
    systemId: string,
    configurationId: string,
    enabled = true
  ) {
    await this.db
      .insert(systemHealthChecks)
      .values({
        systemId,
        configurationId,
        enabled,
      })
      .onConflictDoUpdate({
        target: [
          systemHealthChecks.systemId,
          systemHealthChecks.configurationId,
        ],
        set: { enabled },
      });
  }

  async disassociateSystem(systemId: string, configurationId: string) {
    await this.db
      .delete(systemHealthChecks)
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.configurationId, configurationId)
        )
      );
  }

  async getSystemConfigurations(
    systemId: string
  ): Promise<HealthCheckConfiguration[]> {
    const rows = await this.db
      .select({
        config: healthCheckConfigurations,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id)
      )
      .where(eq(systemHealthChecks.systemId, systemId));

    return rows.map((r) => this.mapConfig(r.config));
  }

  async getHistory(props: {
    systemId?: string;
    configurationId?: string;
    limit?: number;
  }) {
    const { systemId, configurationId, limit = 50 } = props;

    let query = this.db.select().from(healthCheckRuns);

    const conditions = [];
    if (systemId) conditions.push(eq(healthCheckRuns.systemId, systemId));
    if (configurationId)
      conditions.push(eq(healthCheckRuns.configurationId, configurationId));

    if (conditions.length > 0) {
      // @ts-expect-error drizzle-orm type mismatch in where block with dynamic array
      query = query.where(and(...conditions));
    }

    return query.orderBy(desc(healthCheckRuns.timestamp)).limit(limit);
  }

  private mapConfig(
    row: InferSelectModel<typeof healthCheckConfigurations>
  ): HealthCheckConfiguration {
    return {
      id: row.id,
      name: row.name,
      strategyId: row.strategyId,
      config: row.config as Record<string, unknown>,
      intervalSeconds: row.intervalSeconds,
    };
  }
}
