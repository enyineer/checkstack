import { describe, it, expect } from "bun:test";
import { z } from "zod";

import { createEntityRegistry } from "./registry";
import { createChangeEmitter } from "./change-emitter";
import { createFakeEntityStore } from "./fake-entity-store";
import { createRunSecretRegistry } from "../dispatch/run-secret-registry";

function makeRegistry() {
  const secretRegistry = createRunSecretRegistry();
  const emitter = createChangeEmitter();
  return createEntityRegistry({ secretRegistry, emitter });
}

const stateSchema = z.object({ status: z.string(), region: z.string() });

describe("entity registry — validation (§6.3)", () => {
  it("rejects a missing/empty kind", () => {
    const reg = makeRegistry();
    expect(() =>
      reg.defineEntity({ kind: "   ", state: stateSchema }),
    ).toThrow(/non-empty string/);
  });

  it("rejects a non-z.object state (hard fail)", () => {
    const reg = makeRegistry();
    expect(() =>
      reg.defineEntity({
        kind: "bad",
        // @ts-expect-error — deliberately not a z.object
        state: z.string(),
      }),
    ).toThrow(/must be a z\.object/);
  });

  it("rejects a duplicate kind (globally unique)", () => {
    const reg = makeRegistry();
    reg.defineEntity({ kind: "incident", state: stateSchema });
    expect(() =>
      reg.defineEntity({ kind: "incident", state: stateSchema }),
    ).toThrow(/duplicate kind/);
  });

  it("rejects an index referencing an unknown state field", () => {
    const reg = makeRegistry();
    // `fields` is statically `keyof TState`; this models the runtime guard
    // against an untyped caller reaching us through the extension point.
    const unknownField = "nope" as keyof z.infer<typeof stateSchema> & string;
    expect(() =>
      reg.defineEntity({
        kind: "incident",
        state: stateSchema,
        indexes: [{ name: "by_unknown", fields: [unknownField] }],
      }),
    ).toThrow(/unknown state field/);
  });

  it("tracks registered kinds in order", () => {
    const reg = makeRegistry();
    reg.defineEntity({ kind: "a", state: stateSchema });
    reg.defineEntity({ kind: "b", state: stateSchema });
    expect(reg.getKinds()).toEqual(["a", "b"]);
  });
});

describe("entity registry — index DDL collection", () => {
  it("collects one CREATE INDEX IF NOT EXISTS per spec", () => {
    const reg = makeRegistry();
    reg.defineEntity({
      kind: "incident",
      state: stateSchema,
      indexes: [
        { name: "by_status", fields: ["status"] },
        { name: "by_status_region", fields: ["status", "region"] },
      ],
    });
    const ddl = reg.getIndexDdl();
    expect(ddl).toHaveLength(2);
    expect(ddl[0]).toContain('CREATE INDEX IF NOT EXISTS "entity_state_incident_by_status_idx"');
    expect(ddl[0]).toContain("(state->>'status')");
    expect(ddl[0]).toContain("WHERE \"kind\" = 'incident'");
    expect(ddl[1]).toContain("(state->>'status'), (state->>'region')");
  });
});

describe("entity registry — declareNonReactiveState", () => {
  it("records declarations for the lint rule", () => {
    const reg = makeRegistry();
    reg.declareNonReactiveState({
      table: "health_check_runs",
      reason: "raw-sample",
      note: "firehose; the aggregate is the entity",
    });
    const decls = reg.getNonReactiveDeclarations();
    expect(decls).toHaveLength(1);
    expect(decls[0]).toEqual({
      table: "health_check_runs",
      reason: "raw-sample",
      note: "firehose; the aggregate is the entity",
    });
  });
});

describe("entity registry — store binding", () => {
  it("throws a clear error if a handle mutates before the store is bound", async () => {
    const reg = makeRegistry();
    const handle = reg.defineEntity({ kind: "incident", state: stateSchema });
    expect(reg.hasStore).toBe(false);
    await expect(
      handle.set("inc-1", { status: "open", region: "eu" }),
    ).rejects.toThrow(/store not initialized/);
  });

  it("works once the store is bound", async () => {
    const reg = makeRegistry();
    const handle = reg.defineEntity({ kind: "incident", state: stateSchema });
    const store = createFakeEntityStore();
    reg.setStore(store);
    expect(reg.hasStore).toBe(true);
    await handle.set("inc-1", { status: "open", region: "eu" });
    expect(store.rows.get("incident:inc-1")).toEqual({
      status: "open",
      region: "eu",
    });
  });
});
