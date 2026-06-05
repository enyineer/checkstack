import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import { healthCheckContract } from "./rpc-contract";

/**
 * Guards the REST-compatibility fix: history date params were `z.date()`, which
 * a `/rest/...` string param can never satisfy, so every REST history call
 * 400'd. `z.coerce.date()` accepts both the REST string shape and the native RPC
 * Date shape.
 */
function inputSchemaFor(procName: keyof typeof healthCheckContract): ZodType {
  const proc = healthCheckContract[procName] as unknown as Record<
    string,
    unknown
  >;
  const orpc = proc["~orpc"] as { inputSchema?: ZodType };
  if (!orpc.inputSchema) throw new Error(`${String(procName)} has no input`);
  return orpc.inputSchema;
}

describe("history endpoints coerce string date params (REST compatibility)", () => {
  test("getAggregatedHistory accepts ISO date strings", () => {
    const parsed = inputSchemaFor("getAggregatedHistory").safeParse({
      systemId: "sys-1",
      configurationId: "cfg-1",
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-02-01T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const data = parsed.data as { startDate: Date };
      expect(data.startDate).toBeInstanceOf(Date);
    }
  });

  test("getHistory accepts ISO date strings on its optional date params", () => {
    const parsed = inputSchemaFor("getHistory").safeParse({
      systemId: "sys-1",
      startDate: "2026-01-01T00:00:00.000Z",
      sortOrder: "desc",
    });
    expect(parsed.success).toBe(true);
  });
});
