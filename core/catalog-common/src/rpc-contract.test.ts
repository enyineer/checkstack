import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import { catalogContract } from "./rpc-contract";

/**
 * Contract-level guards for the fuzzing-pass findings:
 * - `getSystemContacts` leaked PII (userId/userName/userEmail) to anonymous
 *   callers because it was `userType: "public"`. It must be `authenticated`.
 * - System/Group names were bare `z.string()`, so empty, whitespace-only, and
 *   100KB+ names reached the DB (the huge ones surfaced as 500s).
 *
 * `~orpc` is the contract-procedure internals (same accessor the sandbox-policy
 * access test uses); `meta.userType` and `inputSchema` are stable fields on it.
 */
function metaFor(procName: keyof typeof catalogContract): {
  userType?: string;
} {
  const proc = catalogContract[procName] as unknown as Record<string, unknown>;
  const orpc = proc["~orpc"] as { meta?: { userType?: string } };
  return orpc.meta ?? {};
}

function inputSchemaFor(procName: keyof typeof catalogContract): ZodType {
  const proc = catalogContract[procName] as unknown as Record<string, unknown>;
  const orpc = proc["~orpc"] as { inputSchema?: ZodType };
  if (!orpc.inputSchema) throw new Error(`${String(procName)} has no input`);
  return orpc.inputSchema;
}

describe("getSystemContacts is gated to authenticated callers (PII)", () => {
  test("userType is authenticated, not public", () => {
    expect(metaFor("getSystemContacts").userType).toBe("authenticated");
  });

  test("anonymous-readable catalog reads stay public (no over-correction)", () => {
    expect(metaFor("getEntities").userType).toBe("public");
    expect(metaFor("getSystem").userType).toBe("public");
  });
});

describe("catalog name validation", () => {
  const cases: Array<keyof typeof catalogContract> = [
    "createSystem",
    "createGroup",
  ];

  for (const procName of cases) {
    test(`${String(procName)} rejects an empty name`, () => {
      expect(inputSchemaFor(procName).safeParse({ name: "" }).success).toBe(
        false,
      );
    });

    test(`${String(procName)} rejects a whitespace-only name`, () => {
      expect(inputSchemaFor(procName).safeParse({ name: "   " }).success).toBe(
        false,
      );
    });

    test(`${String(procName)} rejects a name over 200 chars`, () => {
      expect(
        inputSchemaFor(procName).safeParse({ name: "a".repeat(201) }).success,
      ).toBe(false);
    });

    test(`${String(procName)} trims a valid name`, () => {
      const parsed = inputSchemaFor(procName).safeParse({ name: "  ok  " });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect((parsed.data as { name: string }).name).toBe("ok");
      }
    });
  }

  test("updateSystem rejects a whitespace-only name when provided", () => {
    const schema = inputSchemaFor("updateSystem");
    expect(
      schema.safeParse({ id: "s1", data: { name: "   " } }).success,
    ).toBe(false);
    // ...but omitting the name (partial update) is still allowed.
    expect(schema.safeParse({ id: "s1", data: {} }).success).toBe(true);
  });
});
