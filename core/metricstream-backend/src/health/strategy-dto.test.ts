import { describe, it, expect } from "bun:test";
import { z } from "zod";
import type { SafeDatabase } from "@checkstack/backend-api";
import {
  HealthCheckStrategyDtoSchema,
  CollectorDtoSchema,
  StrategyCategorySchema,
} from "@checkstack/healthcheck-common";
import type * as schema from "../schema";
import type { Storage } from "../storage";
import { MetricStreamHealthStrategy } from "./strategy";
import { MetricWindowCollector } from "./metric-window-collector";

/**
 * Regression guard for the strategy-picker 500: healthcheck's `getStrategies`
 * validates its output against `HealthCheckStrategyDtoSchema`, whose `category`
 * is a lowercase zod ENUM. The base `HealthCheckStrategy` interface types
 * `category` as a bare string, so a wrong value typechecks fine and only
 * explodes at runtime - failing the ENTIRE strategy list and with it all
 * health-check creation. This assembles the DTO the way the healthcheck router
 * does and parses it with the REAL contract schemas.
 */
describe("MetricStreamHealthStrategy DTO conformance", () => {
  const strategy = new MetricStreamHealthStrategy({
    db: {} as unknown as SafeDatabase<typeof schema>,
    storage: {} as unknown as Storage,
  });

  it("declares a category that is a valid StrategyCategory enum value", () => {
    expect(() => StrategyCategorySchema.parse(strategy.category)).not.toThrow();
  });

  it("assembles into a valid HealthCheckStrategyDto (getStrategies shape)", () => {
    const dto = {
      id: `metricstream.${strategy.id}`,
      displayName: strategy.displayName,
      description: strategy.description,
      category: strategy.category,
      setupInstructions: strategy.setupInstructions,
      configSchema: z.toJSONSchema(strategy.config.schema) as Record<
        string,
        unknown
      >,
      resultSchema: strategy.result
        ? (z.toJSONSchema(strategy.result.schema) as Record<string, unknown>)
        : undefined,
      aggregatedResultSchema: z.toJSONSchema(
        strategy.aggregatedResult.schema,
      ) as Record<string, unknown>,
    };
    expect(() => HealthCheckStrategyDtoSchema.parse(dto)).not.toThrow();
  });
});

/**
 * The SAME regression guard for the collector: `getCollectors` validates its
 * output against `CollectorDtoSchema`, so an enum-ish registration value that
 * violates the DTO would 500 the collector picker (and with it health-check
 * creation). Covers the metric-window collector's real config/result schemas
 * (including the annotated array-of-objects `labelFilters`).
 */
describe("metricstream collector DTO conformance (getCollectors shape)", () => {
  const collector = new MetricWindowCollector();

  it(`${collector.id} assembles into a valid CollectorDto`, () => {
    const dto = {
      id: `metricstream.${collector.id}`,
      displayName: collector.displayName,
      description: collector.description,
      configSchema: z.toJSONSchema(collector.config.schema) as Record<
        string,
        unknown
      >,
      resultSchema: z.toJSONSchema(collector.result.schema) as Record<
        string,
        unknown
      >,
      aggregatedResultSchema: z.toJSONSchema(
        collector.aggregatedResult.schema,
      ) as Record<string, unknown>,
      allowMultiple: Boolean(collector.allowMultiple),
    };
    expect(() => CollectorDtoSchema.parse(dto)).not.toThrow();
  });
});
