import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import { sloContract } from "./rpc-contract";

/**
 * The REST/OpenAPI surface (`/rest/...`) sends query params as strings. With the
 * date params declared as `z.date()` they were unsatisfiable over REST (a string
 * never validates as a native Date), so `getDailySnapshots` 400'd on every REST
 * call. `z.coerce.date()` accepts both an ISO string (REST) and a Date (native
 * RPC), which is what this guards.
 */
function inputSchemaFor(procName: keyof typeof sloContract): ZodType {
  const proc = sloContract[procName] as unknown as Record<string, unknown>;
  const orpc = proc["~orpc"] as { inputSchema?: ZodType };
  if (!orpc.inputSchema) throw new Error(`${String(procName)} has no input`);
  return orpc.inputSchema;
}

describe("getDailySnapshots coerces string date params (REST compatibility)", () => {
  const schema = inputSchemaFor("getDailySnapshots");

  test("accepts ISO date strings (the REST shape)", () => {
    const parsed = schema.safeParse({
      objectiveId: "obj-1",
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-02-01T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const data = parsed.data as { startDate: Date; endDate: Date };
      expect(data.startDate).toBeInstanceOf(Date);
      expect(data.endDate).toBeInstanceOf(Date);
    }
  });

  test("still accepts native Date objects (the RPC shape)", () => {
    const parsed = schema.safeParse({
      objectiveId: "obj-1",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-02-01"),
    });
    expect(parsed.success).toBe(true);
  });
});
