import {
  HealthCheckConfiguration,
  CreateHealthCheckConfiguration,
  UpdateHealthCheckConfiguration,
  StateThresholds,
  HealthCheckStatus,
} from "@checkmate/healthcheck-common";
import {
  healthCheckConfigurations,
  systemHealthChecks,
  healthCheckRuns,
  VersionedStateThresholds,
} from "./schema";
import * as schema from "./schema";
import { eq, and, InferSelectModel, desc } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { evaluateHealthStatus } from "./state-evaluator";
import {
  STATE_THRESHOLDS_VERSION,
  migrateStateThresholds,
} from "./state-thresholds-migrations";

// Drizzle type helper
type Db = NodePgDatabase<typeof schema>;

interface SystemCheckStatus {
  configurationId: string;
  configurationName: string;
  status: HealthCheckStatus;
  runsConsidered: number;
  lastRunAt?: Date;
}

interface SystemHealthStatusResponse {
  status: HealthCheckStatus;
  evaluatedAt: Date;
  checkStatuses: SystemCheckStatus[];
}

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

  async associateSystem(props: {
    systemId: string;
    configurationId: string;
    enabled?: boolean;
    stateThresholds?: StateThresholds;
  }) {
    const {
      systemId,
      configurationId,
      enabled = true,
      stateThresholds,
    } = props;

    // Wrap thresholds in versioned config if provided
    const versionedThresholds: VersionedStateThresholds | undefined =
      stateThresholds
        ? { version: STATE_THRESHOLDS_VERSION, data: stateThresholds }
        : undefined;

    await this.db
      .insert(systemHealthChecks)
      .values({
        systemId,
        configurationId,
        enabled,
        stateThresholds: versionedThresholds,
      })
      .onConflictDoUpdate({
        target: [
          systemHealthChecks.systemId,
          systemHealthChecks.configurationId,
        ],
        set: {
          enabled,
          stateThresholds: versionedThresholds,
          updatedAt: new Date(),
        },
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

  /**
   * Get system associations with their threshold configurations.
   */
  async getSystemAssociations(systemId: string) {
    const rows = await this.db
      .select({
        configurationId: systemHealthChecks.configurationId,
        configName: healthCheckConfigurations.name,
        enabled: systemHealthChecks.enabled,
        stateThresholds: systemHealthChecks.stateThresholds,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id)
      )
      .where(eq(systemHealthChecks.systemId, systemId));

    // Migrate and extract thresholds for each association
    const results = [];
    for (const row of rows) {
      let thresholds: StateThresholds | undefined;
      if (row.stateThresholds) {
        const migrated = await migrateStateThresholds(row.stateThresholds);
        thresholds = migrated.data;
      }
      results.push({
        configurationId: row.configurationId,
        configurationName: row.configName,
        enabled: row.enabled,
        stateThresholds: thresholds,
      });
    }
    return results;
  }

  /**
   * Get the evaluated health status for a system based on configured thresholds.
   * Aggregates status from all health check configurations for this system.
   */
  async getSystemHealthStatus(
    systemId: string
  ): Promise<SystemHealthStatusResponse> {
    // Get all associations for this system with their thresholds and config names
    const associations = await this.db
      .select({
        configurationId: systemHealthChecks.configurationId,
        stateThresholds: systemHealthChecks.stateThresholds,
        configName: healthCheckConfigurations.name,
        enabled: systemHealthChecks.enabled,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id)
      )
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.enabled, true)
        )
      );

    if (associations.length === 0) {
      // No health checks configured - default healthy
      return {
        status: "healthy",
        evaluatedAt: new Date(),
        checkStatuses: [],
      };
    }

    // For each association, get recent runs and evaluate status
    const checkStatuses: SystemCheckStatus[] = [];
    const maxWindowSize = 100; // Max configurable window size

    for (const assoc of associations) {
      const runs = await this.db
        .select({
          status: healthCheckRuns.status,
          timestamp: healthCheckRuns.timestamp,
        })
        .from(healthCheckRuns)
        .where(
          and(
            eq(healthCheckRuns.systemId, systemId),
            eq(healthCheckRuns.configurationId, assoc.configurationId)
          )
        )
        .orderBy(desc(healthCheckRuns.timestamp))
        .limit(maxWindowSize);

      // Extract and migrate thresholds from versioned config
      let thresholds: StateThresholds | undefined;
      if (assoc.stateThresholds) {
        const migrated = await migrateStateThresholds(assoc.stateThresholds);
        thresholds = migrated.data;
      }

      const status = evaluateHealthStatus({ runs, thresholds });

      checkStatuses.push({
        configurationId: assoc.configurationId,
        configurationName: assoc.configName,
        status,
        runsConsidered: runs.length,
        lastRunAt: runs[0]?.timestamp,
      });
    }

    // Aggregate status: worst status wins (unhealthy > degraded > healthy)
    let aggregateStatus: HealthCheckStatus = "healthy";
    for (const cs of checkStatuses) {
      if (cs.status === "unhealthy") {
        aggregateStatus = "unhealthy";
        break; // Can't get worse
      }
      if (cs.status === "degraded") {
        aggregateStatus = "degraded";
        // Don't break - keep looking for unhealthy
      }
    }

    return {
      status: aggregateStatus,
      evaluatedAt: new Date(),
      checkStatuses,
    };
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
      config: row.config,
      intervalSeconds: row.intervalSeconds,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
