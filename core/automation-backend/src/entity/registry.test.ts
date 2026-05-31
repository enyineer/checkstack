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
/** A trivial plugin `read` returning nothing — every kind needs one (Model B). */
const emptyRead = async () => ({});

describe("entity registry — validation (§6.3)", () => {
  it("rejects a missing/empty kind", () => {
    const reg = makeRegistry();
    expect(() =>
      reg.defineEntity({ kind: "   ", state: stateSchema, read: emptyRead }),
    ).toThrow(/non-empty string/);
  });

  it("rejects a non-z.object state (hard fail)", () => {
    const reg = makeRegistry();
    expect(() =>
      reg.defineEntity({
        kind: "bad",
        // @ts-expect-error — deliberately not a z.object
        state: z.string(),
        read: emptyRead,
      }),
    ).toThrow(/must be a z\.object/);
  });

  it("rejects a duplicate kind (globally unique)", () => {
    const reg = makeRegistry();
    reg.defineEntity({ kind: "incident", state: stateSchema, read: emptyRead });
    expect(() =>
      reg.defineEntity({
        kind: "incident",
        state: stateSchema,
        read: emptyRead,
      }),
    ).toThrow(/duplicate kind/);
  });

  it("rejects a missing `read` (Model B requires a plugin read accessor)", () => {
    const reg = makeRegistry();
    expect(() =>
      // @ts-expect-error — `read` is required in Model B
      reg.defineEntity({ kind: "incident", state: stateSchema }),
    ).toThrow(/`read` must be a function/);
  });

  it("tracks registered kinds in order", () => {
    const reg = makeRegistry();
    reg.defineEntity({ kind: "a", state: stateSchema, read: emptyRead });
    reg.defineEntity({ kind: "b", state: stateSchema, read: emptyRead });
    expect(reg.getKinds()).toEqual(["a", "b"]);
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
    const store = createFakeEntityStore();
    const handle = reg.defineEntity({
      kind: "incident",
      state: stateSchema,
      read: store.readFor("incident"),
    });
    expect(reg.hasStore).toBe(false);
    await expect(
      handle.mutate({
        id: "inc-1",
        apply: async () => {
          store.rows.set("incident:inc-1", { status: "open", region: "eu" });
          return { status: "open", region: "eu" };
        },
      }),
    ).rejects.toThrow(/store not initialized/);
  });

  it("works once the store is bound", async () => {
    const reg = makeRegistry();
    const store = createFakeEntityStore();
    const handle = reg.defineEntity({
      kind: "incident",
      state: stateSchema,
      read: store.readFor("incident"),
    });
    reg.setStore({ store });
    expect(reg.hasStore).toBe(true);
    await handle.mutate({
      id: "inc-1",
      apply: async () => {
        store.rows.set("incident:inc-1", { status: "open", region: "eu" });
        return { status: "open", region: "eu" };
      },
    });
    expect(store.rows.get("incident:inc-1")).toEqual({
      status: "open",
      region: "eu",
    });
  });
});

describe("entity registry — Model B read + entityResolverFor", () => {
  const incidentSchema = z.object({ status: z.string(), severity: z.string() });

  it("rejects a `read` that is not a function", () => {
    const reg = makeRegistry();
    expect(() =>
      reg.defineEntity({
        kind: "incident",
        state: incidentSchema,
        // @ts-expect-error — deliberately not a function
        read: 42,
      }),
    ).toThrow(/`read` must be a function/);
  });

  it("entityResolverFor routes a kind to its plugin `read`", async () => {
    const reg = makeRegistry();
    const read = async (ids: ReadonlyArray<string>) => {
      const out: Record<string, { status: string; severity: string }> = {};
      for (const id of ids) out[id] = { status: "open", severity: "high" };
      return out;
    };
    reg.defineEntity({ kind: "incident", state: incidentSchema, read });
    const resolver = reg.entityResolverFor("incident");
    expect(resolver).toBeDefined();
    expect(await resolver!(["inc-1"])).toEqual({
      "inc-1": { status: "open", severity: "high" },
    });
  });

  it("entityResolverFor routes a homeless kind through its keyed-store `read`", async () => {
    const reg = makeRegistry();
    const store = createFakeEntityStore();
    // Homeless kind: opt into the framework keyed store and pass its readMany.
    const keyedStore = store.keyedStore<{
      status: string;
      severity: string;
    }>("health");
    reg.defineEntity({
      kind: "health",
      state: incidentSchema,
      read: keyedStore.readMany,
    });
    reg.setStore({ store });
    store.rows.set("health:sys-1", { status: "open", severity: "low" });
    const resolver = reg.entityResolverFor("health");
    expect(resolver).toBeDefined();
    expect(await resolver!(["sys-1"])).toEqual({
      "sys-1": { status: "open", severity: "low" },
    });
  });

  it("entityResolverFor returns undefined for an unknown kind", () => {
    const reg = makeRegistry();
    expect(reg.entityResolverFor("nope")).toBeUndefined();
  });
});
