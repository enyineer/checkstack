/**
 * Model B reactive wrapper — driven `mutate` / `remove` over a PLUGIN-OWNED
 * store (reactive automation engine §4, reshaped).
 *
 * These tests use a FAKE plugin store (a plain in-memory map) as the `read`
 * accessor + the `apply` write target — NOT `entity_state`. They prove the
 * Model B invariants:
 *
 *   - `mutate` emits on a real diff, no-ops on an equal write;
 *   - `remove` emits a tombstone (next = null);
 *   - a transition is appended on EVERY change, even though current state
 *     lives in a non-`entity_state` backing (durable platform history for a
 *     homeless/in-memory kind);
 *   - `prev` is snapshotted BEFORE `apply`, so a change is never missed;
 *   - the change event is emitted only AFTER the tx commits — a throwing
 *     `apply` (rolled-back tx) emits nothing and logs nothing;
 *   - run-originated writes are masked;
 *   - `get` / `getMany` route to the plugin `read`.
 */
import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { SYSTEM_ACTOR } from "@checkstack/common";
import type { EntityChanged } from "@checkstack/automation-common";

import { createEntityHandle } from "./create-handle";
import { createChangeEmitter, type ChangeEmitter } from "./change-emitter";
import { createFakeEntityStore, FAKE_TX } from "./fake-entity-store";
import type { EntityTx } from "./entity-store";
import { createRunSecretRegistry } from "../dispatch/run-secret-registry";

const satelliteSchema = z.object({
  status: z.enum(["online", "offline"]),
  region: z.string(),
});
type Satellite = z.infer<typeof satelliteSchema>;

/**
 * A FAKE plugin store: an in-memory map standing in for a domain table or an
 * in-memory connection map. `read` + the per-write `apply` operate on it; the
 * framework `entity_state` table is NEVER touched.
 */
function fakePluginStore() {
  const rows = new Map<string, Satellite>();
  return {
    rows,
    read: async (ids: ReadonlyArray<string>) => {
      const out: Record<string, Satellite> = {};
      for (const id of ids) {
        const row = rows.get(id);
        if (row) out[id] = row;
      }
      return out;
    },
    /** Write current state in the plugin store (mirrors `apply`'s job). */
    put: (id: string, state: Satellite) => {
      rows.set(id, state);
      return state;
    },
    del: (id: string) => {
      rows.delete(id);
    },
  };
}

function setup(opts?: { secretValues?: string[]; runId?: string }) {
  const store = createFakeEntityStore();
  const events: EntityChanged[] = [];
  const emitter: ChangeEmitter = createChangeEmitter();
  void emitter.wire(async (payload) => {
    events.push(payload);
  });
  const secretRegistry = createRunSecretRegistry();
  if (opts?.runId && opts.secretValues) {
    secretRegistry.register(opts.runId, opts.secretValues);
  }
  const plugin = fakePluginStore();
  // PLUGIN-BACKED kind: no keyedStore — `read` points at the plugin map.
  const handle = createEntityHandle<Satellite>({
    kind: "satellite-connection",
    schema: satelliteSchema,
    store,
    emitter,
    secretRegistry,
    read: plugin.read,
  });
  return { store, events, handle, plugin, secretRegistry };
}

describe("Model B mutate — emit on diff / no-op on equal", () => {
  it("emits a create (prev null) and appends transitions, with NO entity_state row", async () => {
    const { store, events, handle, plugin } = setup();
    const next = await handle.mutate({
      id: "sat-1",
      apply: (tx: EntityTx) => {
        expect(tx).toBe(FAKE_TX);
        return Promise.resolve(plugin.put("sat-1", { status: "online", region: "eu" }));
      },
    });
    expect(next).toEqual({ status: "online", region: "eu" });
    // The current state lives ONLY in the plugin map — entity_state untouched.
    expect(store.rows.size).toBe(0);
    // But a durable transition is recorded for every change (history).
    expect(store.transitions.map((t) => t.field).sort()).toEqual([
      "region",
      "status",
    ]);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.kind).toBe("satellite-connection");
    expect(ev.id).toBe("sat-1");
    expect(ev.prev).toBeNull();
    expect(ev.next).toEqual({ status: "online", region: "eu" });
    expect(ev.changedFields.sort()).toEqual(["region", "status"]);
    expect(ev.actor).toEqual(SYSTEM_ACTOR);
  });

  it("emits only the changed-field delta on an update", async () => {
    const { events, handle, plugin, store } = setup();
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "online", region: "eu" })),
    });
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "offline", region: "eu" })),
    });
    expect(events).toHaveLength(2);
    expect(events[1]!.changedFields).toEqual(["status"]);
    expect(events[1]!.delta).toEqual({ status: "offline" });
    // One transition per change: 2 (create) + 1 (status flip).
    expect(store.transitions).toHaveLength(3);
  });

  it("no-ops (no emit, no transition) when apply returns an equal state", async () => {
    const { events, handle, plugin, store } = setup();
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "online", region: "eu" })),
    });
    const before = store.transitions.length;
    // A write that does not change the state (same values) → no emit.
    const result = await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { region: "eu", status: "online" })),
    });
    expect(result).toEqual({ status: "online", region: "eu" });
    expect(events).toHaveLength(1);
    expect(store.transitions).toHaveLength(before);
  });
});

describe("Model B mutate — prev snapshotted BEFORE apply", () => {
  it("captures prev before the plugin write so a change is never missed", async () => {
    const { events, handle, plugin } = setup();
    plugin.put("sat-1", { status: "online", region: "eu" });
    await handle.mutate({
      id: "sat-1",
      // `apply` mutates the SAME map `read` reads. If prev were re-read AFTER
      // the write, prev would equal next and the change would vanish.
      apply: () =>
        Promise.resolve(plugin.put("sat-1", { status: "offline", region: "eu" })),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.prev).toEqual({ status: "online", region: "eu" });
    expect(events[0]!.next).toEqual({ status: "offline", region: "eu" });
    expect(events[0]!.changedFields).toEqual(["status"]);
  });
});

describe("Model B mutate — post-commit emit (no emit on rollback)", () => {
  it("emits nothing and appends no transition when apply throws", async () => {
    const { events, handle, store, plugin } = setup();
    plugin.put("sat-1", { status: "online", region: "eu" });
    await expect(
      handle.mutate({
        id: "sat-1",
        apply: () => {
          // The plugin write fails inside the tx → rollback.
          throw new Error("write blew up");
        },
      }),
    ).rejects.toThrow(/write blew up/);
    expect(events).toHaveLength(0);
    expect(store.transitions).toHaveLength(0);
  });
});

describe("Model B remove — tombstone", () => {
  it("emits a tombstone (next null) from the plugin delete", async () => {
    const { events, handle, plugin, store } = setup();
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "online", region: "eu" })),
    });
    await handle.remove({
      id: "sat-1",
      apply: async () => {
        plugin.del("sat-1");
      },
    });
    expect(events).toHaveLength(2);
    const tombstone = events[1]!;
    expect(tombstone.next).toBeNull();
    expect(tombstone.prev).toEqual({ status: "online", region: "eu" });
    expect(tombstone.delta).toEqual({});
    expect(store.rows.size).toBe(0);
  });

  it("removing an absent entity is a no-op (no event)", async () => {
    const { events, handle } = setup();
    await handle.remove({
      id: "ghost",
      apply: async () => {
        /* nothing to delete */
      },
    });
    expect(events).toHaveLength(0);
  });
});

describe("Model B — masking run-originated writes", () => {
  it("masks secret values in the emitted next when runId is set", async () => {
    const { events, handle, plugin } = setup({
      runId: "run-1",
      secretValues: ["s3cr3t"],
    });
    await handle.mutate({
      id: "sat-1",
      opts: { runId: "run-1" },
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "online", region: "s3cr3t" })),
    });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]!.next)).not.toContain("s3cr3t");
  });

  it("does not mask when the write is not run-originated", async () => {
    const { events, handle, plugin } = setup({
      runId: "run-1",
      secretValues: ["s3cr3t"],
    });
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "online", region: "s3cr3t" })),
    });
    expect(JSON.stringify(events[0]!.next)).toContain("s3cr3t");
  });
});

describe("Model B — get / getMany route to plugin read", () => {
  it("get / getMany read from the plugin store", async () => {
    const { handle, plugin, store } = setup();
    plugin.put("sat-1", { status: "online", region: "eu" });
    plugin.put("sat-2", { status: "offline", region: "us" });
    expect(await handle.get("sat-1")).toEqual({ status: "online", region: "eu" });
    expect(await handle.get("missing")).toBeUndefined();
    const many = await handle.getMany(["sat-1", "sat-2", "missing"]);
    expect(Object.keys(many).sort()).toEqual(["sat-1", "sat-2"]);
    // Reads never touch entity_state.
    expect(store.rows.size).toBe(0);
  });
});

describe("Model B — store-owned sugar rejected on a plugin-backed kind", () => {
  it("rejects `set` / `patch` / `remove(id)` when a `read` is declared", async () => {
    const { handle } = setup();
    await expect(
      handle.set("sat-1", { status: "online", region: "eu" }),
    ).rejects.toThrow(/store-owned sugar/);
    await expect(handle.patch("sat-1", { status: "offline" })).rejects.toThrow(
      /store-owned sugar/,
    );
    await expect(handle.remove("sat-1")).rejects.toThrow(/store-owned sugar/);
  });
});

describe("Model B — transition helpers over plugin-backed state", () => {
  it("inStateSince matches the plugin store's current value", async () => {
    const { handle, plugin, store } = setup();
    store.setClock(() => new Date("2026-01-01T00:00:00.000Z"));
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "online", region: "eu" })),
    });
    store.setClock(() => new Date("2026-01-01T01:00:00.000Z"));
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "offline", region: "eu" })),
    });
    const since = await handle.inStateSince("sat-1", "status");
    expect(since?.toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });
});
