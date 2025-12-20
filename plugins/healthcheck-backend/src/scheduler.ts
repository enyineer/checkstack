import {
  HealthCheckRegistry,
  Logger,
  Fetch,
  TokenVerification,
} from "@checkmate/backend-api";
import {
  healthCheckConfigurations,
  systemHealthChecks,
  healthCheckRuns,
} from "./schema";
import * as schema from "./schema";
import { eq, desc, and } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

type Db = NodePgDatabase<typeof schema>;

export class Scheduler {
  private interval: Timer | undefined;
  private isRunning = false;

  constructor(
    private db: Db,
    private registry: HealthCheckRegistry,
    private logger: Logger,
    private fetch: Fetch,
    private tokenVerification: TokenVerification
  ) {}

  start(intervalMs = 10_000) {
    if (this.interval) return;
    this.logger.info("⏱️ Starting Health Check Scheduler...");
    this.interval = setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private async tick() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // 1. Find checks that need to run
      // A check needs to run if:
      // - It is enabled for a system
      // - (Now - LastRun) > Interval  OR LastRun is null
      // For simplicity in this iteration, we will implement a naive "run everything every tick"
      // or "run if explicit interval passed" logic if we tracked last_run per system-config.
      // We didn't add last_run to systemHealthChecks yet, so we'll just run all enabled checks
      // and maybe optimize later or add it to schema now?
      // Optimization: Let's fetch all enabled system checks.

      const checksToRun = await this.db
        .select({
          systemId: systemHealthChecks.systemId,
          configId: healthCheckConfigurations.id,
          strategyId: healthCheckConfigurations.strategyId,
          config: healthCheckConfigurations.config,
          interval: healthCheckConfigurations.intervalSeconds,
        })
        .from(systemHealthChecks)
        .innerJoin(
          healthCheckConfigurations,
          eq(systemHealthChecks.configurationId, healthCheckConfigurations.id)
        )
        .where(eq(systemHealthChecks.enabled, true));

      for (const check of checksToRun) {
        // TODO: Check last run time to respect interval.
        // For now, we will just run it.
        await this.executeCheck({
          ...check,
          config: check.config as Record<string, unknown>,
        });
      }
    } catch (error) {
      this.logger.error("Error in Scheduler tick", error);
    } finally {
      this.isRunning = false;
    }
  }

  private async executeCheck(check: {
    systemId: string;
    configId: string;
    strategyId: string;
    config: Record<string, unknown>;
  }) {
    const strategy = this.registry.getStrategy(check.strategyId);
    if (!strategy) {
      this.logger.warn(
        `Strategy ${check.strategyId} not found for config ${check.configId}`
      );
      return;
    }

    try {
      const result = await strategy.execute(check.config);

      await this.db.insert(healthCheckRuns).values({
        configurationId: check.configId,
        systemId: check.systemId,
        status: result.status,
        result: result,
      });

      this.logger.debug(
        `Ran check ${check.configId} for system ${check.systemId}: ${result.status}`
      );

      // Trigger status propagation
      await this.propagateStatus(check.systemId);
    } catch (error) {
      this.logger.error(`Failed to execute check ${check.configId}`, error);
      await this.db.insert(healthCheckRuns).values({
        configurationId: check.configId,
        systemId: check.systemId,
        status: "unhealthy",
        result: { error: String(error) },
      });

      // Trigger status propagation even on failure
      await this.propagateStatus(check.systemId);
    }
  }

  private async propagateStatus(systemId: string) {
    try {
      const aggregateStatus = await this.calculateAggregateStatus(systemId);

      this.logger.info(
        `Propagating status '${aggregateStatus}' for system ${systemId}`
      );

      const token = await this.tokenVerification.sign({
        sub: "healthcheck-backend",
        purpose: "status-propagation",
      });

      // Construct the URL to catalog-backend.
      // In a real scenario, this might come from a discovery service or config.
      // For now, we assume it's reachable at the core's API prefix.
      const catalogUrl = `http://localhost:3000/api/catalog-backend/entities/systems/${systemId}`;

      const response = await this.fetch.fetch(catalogUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: aggregateStatus }),
      });

      if (!response.ok) {
        const text = await response.text();
        this.logger.error(
          `Failed to propagate status for system ${systemId}: ${response.status} ${text}`
        );
      }
    } catch (error) {
      this.logger.error(
        `Error propagating status for system ${systemId}`,
        error
      );
    }
  }

  private async calculateAggregateStatus(systemId: string) {
    // 1. Get all enabled checks for this system
    const checks = await this.db
      .select({ configId: systemHealthChecks.configurationId })
      .from(systemHealthChecks)
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.enabled, true)
        )
      );

    if (checks.length === 0) return "healthy";

    const statuses: string[] = [];

    // 2. Get the latest run for each check
    for (const check of checks) {
      const latestRun = await this.db
        .select({ status: healthCheckRuns.status })
        .from(healthCheckRuns)
        .where(
          and(
            eq(healthCheckRuns.systemId, systemId),
            eq(healthCheckRuns.configurationId, check.configId)
          )
        )
        .orderBy(desc(healthCheckRuns.timestamp))
        .limit(1);

      if (latestRun.length > 0) {
        statuses.push(latestRun[0].status);
      } else {
        // If it hasn't run yet, we don't know, but let's treat it as neutral/healthy for aggregation
        // or should we treat it as unknown? Let's skip for now.
      }
    }

    if (statuses.length === 0) return "healthy";

    // Aggregation logic:
    // - Any 'unhealthy' -> 'unhealthy'
    // - Any 'degraded' -> 'degraded' (if no unhealthy)
    // - All 'healthy' -> 'healthy'

    if (statuses.includes("unhealthy")) return "unhealthy";
    if (statuses.includes("degraded")) return "degraded";
    return "healthy";
  }
}
