import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { SYSTEM_ACTOR, type Actor } from "@checkstack/common";
import type { EntityChanged } from "@checkstack/automation-common";

import { createEntityHandle } from "./create-handle";
import { createChangeEmitter, type ChangeEmitter } from "./change-emitter";
import { createFakeEntityStore } from "./fake-entity-store";
import { createRunSecretRegistry } from "../dispatch/run-secret-registry";

const incidentSchema = z.object({
  status: z.enum(["open", "resolved"]),
  severity: z.enum(["low", "high"]),
  systemIds: z.array(z.string()).default([]),
});
type Incident = z.infer<typeof incidentSchema>;

/** Build a handle + a recording emitter that captures every emitted event. */
function setup(opts?: { secretValues?: string[]; runId?: string }) {
  const store = createFakeEntityStore();
  const events: EntityChanged[] = [];
  // Wire the emitter immediately so emits are synchronous in these tests.
  const emitter: ChangeEmitter = createChangeEmitter();
  void emitter.wire(async (payload) => {
    events.push(payload);
  });
  const secretRegistry = createRunSecretRegistry();
  if (opts?.runId && opts.secretValues) {
    secretRegistry.register(opts.runId, opts.secretValues);
  }
  const handle = createEntityHandle<Incident>({
    kind: "incident",
    schema: incidentSchema,
    store,
    emitter,
    secretRegistry,
  });
  return { store, events, handle, secretRegistry };
}

describe("entity handle — set / diff / emit", () => {
  it("validates, persists, and emits a create (prev null)", async () => {
    const { store, events, handle } = setup();
    await handle.set("inc-1", {
      status: "open",
      severity: "high",
      systemIds: ["sys-1"],
    });
    expect(store.rows.get("incident:inc-1")).toEqual({
      status: "open",
      severity: "high",
      systemIds: ["sys-1"],
    });
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.kind).toBe("incident");
    expect(ev.id).toBe("inc-1");
    expect(ev.prev).toBeNull();
    expect(ev.next).toEqual({
      status: "open",
      severity: "high",
      systemIds: ["sys-1"],
    });
    expect(ev.changedFields.sort()).toEqual(["severity", "status", "systemIds"]);
    expect(ev.actor).toEqual(SYSTEM_ACTOR);
    expect(typeof ev.occurredAt).toBe("string");
  });

  it("emits only the changed-field delta on an update", async () => {
    const { events, handle } = setup();
    await handle.set("inc-1", { status: "open", severity: "high", systemIds: [] });
    await handle.set("inc-1", {
      status: "resolved",
      severity: "high",
      systemIds: [],
    });
    expect(events).toHaveLength(2);
    expect(events[1]!.changedFields).toEqual(["status"]);
    expect(events[1]!.delta).toEqual({ status: "resolved" });
    expect(events[1]!.prev).toEqual({
      status: "open",
      severity: "high",
      systemIds: [],
    });
  });

  it("is a NO-OP when the next state is structurally unchanged", async () => {
    const { events, handle, store } = setup();
    await handle.set("inc-1", { status: "open", severity: "high", systemIds: ["a"] });
    // Same values, different key order / array identity → no diff.
    await handle.set("inc-1", { systemIds: ["a"], severity: "high", status: "open" });
    expect(events).toHaveLength(1);
    expect(store.transitions).toHaveLength(3); // only the create's transitions
  });

  it("hard-fails an invalid state via zod", async () => {
    const { handle } = setup();
    await expect(
      // @ts-expect-error — deliberately invalid status
      handle.set("inc-1", { status: "nope", severity: "high", systemIds: [] }),
    ).rejects.toThrow();
  });

  it("carries an explicit actor when provided", async () => {
    const { events, handle } = setup();
    const actor: Actor = { type: "user", id: "u-1", name: "Alice" };
    await handle.set(
      "inc-1",
      { status: "open", severity: "high", systemIds: [] },
      { actor },
    );
    expect(events[0]!.actor).toEqual(actor);
  });
});

describe("entity handle — patch", () => {
  it("shallow-merges onto the prior state", async () => {
    const { store, events, handle } = setup();
    await handle.set("inc-1", { status: "open", severity: "high", systemIds: ["a"] });
    await handle.patch("inc-1", { status: "resolved" });
    expect(store.rows.get("incident:inc-1")).toEqual({
      status: "resolved",
      severity: "high",
      systemIds: ["a"],
    });
    expect(events[1]!.changedFields).toEqual(["status"]);
  });

  it("no-ops when the patch changes nothing", async () => {
    const { events, handle } = setup();
    await handle.set("inc-1", { status: "open", severity: "high", systemIds: [] });
    await handle.patch("inc-1", { severity: "high" });
    expect(events).toHaveLength(1);
  });
});

describe("entity handle — masking run-originated writes", () => {
  it("masks secret values in the persisted state and the change event", async () => {
    const { store, events, handle } = setup({
      runId: "run-1",
      secretValues: ["s3cr3t"],
    });
    await handle.set(
      "inc-1",
      { status: "open", severity: "high", systemIds: ["s3cr3t"] },
      { runId: "run-1" },
    );
    const persisted = store.rows.get("incident:inc-1");
    expect(JSON.stringify(persisted)).not.toContain("s3cr3t");
    expect(JSON.stringify(events[0]!.next)).not.toContain("s3cr3t");
  });

  it("does not mask when the write is not run-originated", async () => {
    const { store, handle } = setup({ runId: "run-1", secretValues: ["s3cr3t"] });
    // No runId on opts → no masking.
    await handle.set("inc-1", {
      status: "open",
      severity: "high",
      systemIds: ["s3cr3t"],
    });
    expect(JSON.stringify(store.rows.get("incident:inc-1"))).toContain("s3cr3t");
  });
});

describe("entity handle — get / getMany", () => {
  it("get returns the current state or undefined", async () => {
    const { handle } = setup();
    expect(await handle.get("inc-1")).toBeUndefined();
    await handle.set("inc-1", { status: "open", severity: "low", systemIds: [] });
    expect(await handle.get("inc-1")).toEqual({
      status: "open",
      severity: "low",
      systemIds: [],
    });
  });

  it("getMany batches and omits missing ids", async () => {
    const { handle } = setup();
    await handle.set("inc-1", { status: "open", severity: "low", systemIds: [] });
    await handle.set("inc-2", { status: "resolved", severity: "high", systemIds: [] });
    const many = await handle.getMany(["inc-1", "inc-2", "inc-missing"]);
    expect(Object.keys(many).sort()).toEqual(["inc-1", "inc-2"]);
    expect(many["inc-1"]!.status).toBe("open");
  });
});

describe("entity handle — remove / tombstone", () => {
  it("emits a tombstone (next null) and deletes the row", async () => {
    const { store, events, handle } = setup();
    await handle.set("inc-1", { status: "open", severity: "low", systemIds: [] });
    await handle.remove("inc-1");
    expect(store.rows.has("incident:inc-1")).toBe(false);
    const tombstone = events[1]!;
    expect(tombstone.next).toBeNull();
    expect(tombstone.prev).toEqual({
      status: "open",
      severity: "low",
      systemIds: [],
    });
    expect(tombstone.delta).toEqual({});
  });

  it("removing an absent entity is a no-op (no event)", async () => {
    const { events, handle } = setup();
    await handle.remove("ghost");
    expect(events).toHaveLength(0);
  });
});

describe("entity handle — transition helpers", () => {
  it("inStateSince returns the timestamp of the latest transition into the current value", async () => {
    const { store, handle } = setup();
    store.setClock(() => new Date("2026-01-01T00:00:00.000Z"));
    await handle.set("inc-1", { status: "open", severity: "low", systemIds: [] });
    store.setClock(() => new Date("2026-01-01T01:00:00.000Z"));
    await handle.set("inc-1", { status: "resolved", severity: "low", systemIds: [] });
    const since = await handle.inStateSince("inc-1", "status");
    expect(since?.toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });

  it("inStateForMs reflects the elapsed time since the latest transition", async () => {
    const { store, handle } = setup();
    const start = new Date(Date.now() - 5_000);
    store.setClock(() => start);
    await handle.set("inc-1", { status: "open", severity: "low", systemIds: [] });
    const ms = await handle.inStateForMs("inc-1", "status");
    expect(ms).toBeGreaterThanOrEqual(4_000);
  });

  it("transitionCount counts transitions of a field in the window", async () => {
    const { store, handle } = setup();
    // Anchor transitions just before real `now` (the handle counts against
    // a fresh `now`), spaced one minute apart inside the window.
    const now = Date.now();
    let t = now - 3 * 60_000;
    store.setClock(() => new Date(t));
    await handle.set("inc-1", { status: "open", severity: "low", systemIds: [] });
    t += 60_000;
    await handle.set("inc-1", { status: "resolved", severity: "low", systemIds: [] });
    t += 60_000;
    await handle.set("inc-1", { status: "open", severity: "low", systemIds: [] });
    // 3 status transitions written within the trailing 10 min → all counted.
    const count = await handle.transitionCount({
      id: "inc-1",
      field: "status",
      windowMs: 10 * 60_000,
    });
    expect(count).toBe(3);
  });

  it("transitionCount excludes transitions outside the window", async () => {
    const { store, handle } = setup();
    const now = Date.now();
    store.setClock(() => new Date(now - 60 * 60_000)); // 1h ago
    await handle.set("inc-1", { status: "open", severity: "low", systemIds: [] });
    store.setClock(() => new Date(now - 30_000)); // 30s ago
    await handle.set("inc-1", { status: "resolved", severity: "low", systemIds: [] });
    const count = await handle.transitionCount({
      id: "inc-1",
      field: "status",
      windowMs: 5 * 60_000, // only the last 5 min
    });
    expect(count).toBe(1);
  });
});
