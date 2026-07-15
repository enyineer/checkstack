import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { toJsonSchema } from "@checkstack/backend-api";
import {
  HealthCheckStrategyDtoSchema,
  StrategyCategorySchema,
} from "@checkstack/healthcheck-common";
import {
  DEFAULT_TRACE_STREAM_CONFIG,
  type TraceStream,
} from "@checkstack/tracestream-common";
import type { Storage } from "../storage";
import { TraceStreamHealthStrategy } from "./strategy";

const STREAM_CREATED = new Date("2026-01-01T00:00:00.000Z");

const sampleStream: TraceStream = {
  id: "stream-1",
  name: "Traces",
  description: null,
  config: DEFAULT_TRACE_STREAM_CONFIG,
  createdAt: STREAM_CREATED,
  updatedAt: STREAM_CREATED,
};

/**
 * Minimal Storage stub. `createClient` only calls `storage.streams.get`; the
 * rest of the port surface is unused here, so a partial stub is cast to Storage
 * (the established pattern in logstream's strategy tests).
 */
function fakeStorage(stream: TraceStream | null): Storage {
  return {
    streams: { get: async () => stream },
  } as unknown as Storage;
}

/**
 * Regression guard for the strategy-picker 500: healthcheck's `getStrategies`
 * validates its output against `HealthCheckStrategyDtoSchema`, whose `category`
 * is a lowercase zod ENUM. The base `HealthCheckStrategy` interface types
 * `category` as a bare string, so a wrong value typechecks fine and only
 * explodes at runtime, failing the ENTIRE strategy list.
 */
describe("TraceStreamHealthStrategy DTO conformance", () => {
  const strategy = new TraceStreamHealthStrategy({
    storage: fakeStorage(null),
  });

  it("declares a category that is a valid StrategyCategory enum value", () => {
    expect(() => StrategyCategorySchema.parse(strategy.category)).not.toThrow();
  });

  it("assembles into a valid HealthCheckStrategyDto (getStrategies shape)", () => {
    const dto = {
      id: `tracestream.${strategy.id}`,
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

  it("exposes streamId with the stream options resolver annotation", () => {
    // backend-api's toJsonSchema preserves the custom x-options-resolver
    // annotation (plain z.toJSONSchema strips it).
    const jsonSchema = toJsonSchema(strategy.config.schema);
    expect(jsonSchema).toMatchObject({
      properties: { streamId: { "x-options-resolver": "tracestreamStreamId" } },
    });
  });
});

describe("TraceStreamHealthStrategy.createClient (config-error signal)", () => {
  it("throws a connection failure when the stream no longer exists", async () => {
    const strategy = new TraceStreamHealthStrategy({
      storage: fakeStorage(null),
    });
    await expect(
      strategy.createClient({ streamId: "gone" }),
    ).rejects.toThrow("Trace stream not found: gone");
  });

  it("resolves a read handle when the stream exists", async () => {
    const strategy = new TraceStreamHealthStrategy({
      storage: fakeStorage(sampleStream),
    });
    const connected = await strategy.createClient({ streamId: "stream-1" });
    expect(connected.client.streamId).toBe("stream-1");
    expect(connected.client.reader.streamCreatedAt).toEqual(STREAM_CREATED);
    connected.close();
  });
});
