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
import { LogStreamHealthStrategy } from "./strategy";
import { WindowMetricsCollector } from "./window-metrics-collector";
import { PatternOccurrenceCollector } from "./pattern-occurrence-collector";
import { PatternMetricCollector } from "./pattern-metric-collector";

/**
 * Regression guard for the strategy-picker 500: healthcheck's `getStrategies`
 * validates its output against `HealthCheckStrategyDtoSchema`, whose
 * `category` is a lowercase zod ENUM. The base `HealthCheckStrategy`
 * interface types `category` as a bare string, so a wrong value (the original
 * bug: `"Observability"` instead of `"observability"`) typechecks fine and
 * only explodes at runtime - failing the ENTIRE strategy list and with it all
 * health-check creation. This test assembles the DTO the way the healthcheck
 * router does and parses it with the REAL contract schemas.
 */
describe("LogStreamHealthStrategy DTO conformance", () => {
  const strategy = new LogStreamHealthStrategy({
    db: {} as unknown as SafeDatabase<typeof schema>,
    storage: {} as unknown as Storage,
  });

  it("declares a category that is a valid StrategyCategory enum value", () => {
    expect(() => StrategyCategorySchema.parse(strategy.category)).not.toThrow();
  });

  it("assembles into a valid HealthCheckStrategyDto (getStrategies shape)", () => {
    // Mirror core/healthcheck-backend/src/router.ts getStrategies assembly.
    // The router serializes zod schemas to JSON Schema; the DTO only requires
    // a record there, so z.toJSONSchema is an adequate stand-in for the
    // chart-meta-aware serializer.
    const dto = {
      id: `logstream.${strategy.id}`,
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
 * The SAME regression guard, extended to the collectors: healthcheck's
 * `getCollectors` validates its output against `CollectorDtoSchema`, so an
 * enum-ish registration value that violates the DTO would 500 the collector
 * picker (and with it health-check creation), exactly like the strategy bug.
 * We assemble each collector's DTO the way the healthcheck router does and
 * parse it with the REAL contract schema - covering the new `pattern-metric`
 * collector alongside the two existing ones.
 */
describe("logstream collector DTO conformance (getCollectors shape)", () => {
  // Structural view of the collector metadata the DTO assembly reads. The three
  // collectors differ in their config/result generics, but the getCollectors
  // serializer only touches these shared fields - so this avoids `any` while
  // still exercising every collector's real schemas.
  interface CollectorDtoParts {
    id: string;
    displayName: string;
    description: string;
    allowMultiple?: boolean;
    config: { schema: z.ZodType };
    result: { schema: z.ZodType };
    aggregatedResult: { schema: z.ZodType };
  }

  const collectors: CollectorDtoParts[] = [
    new WindowMetricsCollector(),
    new PatternOccurrenceCollector(),
    new PatternMetricCollector(),
  ];

  for (const collector of collectors) {
    it(`${collector.id} assembles into a valid CollectorDto`, () => {
      const dto = {
        id: `logstream.${collector.id}`,
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
  }
});
