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
 *   - the change event is emitted only AFTER the plugin write resolves — a
 *     throwing `apply` emits nothing and appends no transition;
 *   - run-originated writes are masked;
 *   - `get` / `getMany` route to the plugin `read`.
 */
import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { SYSTEM_ACTOR } from "@checkstack/common";
import type { EntityChanged } from "@checkstack/automation-common";

import { createEntityHandle } from "./create-handle";
import { createChangeEmitter, type ChangeEmitter } from "./change-emitter";
import { createFakeEntityStore } from "./fake-entity-store";
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
  // PLUGIN-BACKED kind: `read` points at the plugin's own map.
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
      // PLUGIN-BACKED `apply` takes NO framework tx — the plugin owns its own
      // write/tx. It just returns the post-write state.
      apply: () =>
        Promise.resolve(plugin.put("sat-1", { status: "online", region: "eu" })),
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
          // The plugin write fails (in the plugin's own tx) → nothing else runs.
          throw new Error("write blew up");
        },
      }),
    ).rejects.toThrow(/write blew up/);
    expect(events).toHaveLength(0);
    expect(store.transitions).toHaveLength(0);
  });
});

describe("Model B mutate — cross-plugin tx boundary", () => {
  it("runs the plugin write FIRST, then appends transitions in a SEPARATE framework tx", async () => {
    const { handle, plugin, store } = setup();
    const order: string[] = [];
    // Observe the framework transaction boundary: the plugin write must have
    // already happened (the row is in the plugin map) by the time the
    // framework opens its tx to append the transition.
    store.onTransaction(() => {
      order.push(
        plugin.rows.has("sat-1") ? "framework-tx-after-write" : "framework-tx-before-write",
      );
    });
    await handle.mutate({
      id: "sat-1",
      apply: () => {
        order.push("plugin-write");
        return Promise.resolve(plugin.put("sat-1", { status: "online", region: "eu" }));
      },
    });
    // Plugin write happens BEFORE the framework opens its transition-append tx,
    // and that tx sees the already-committed plugin state.
    expect(order).toEqual(["plugin-write", "framework-tx-after-write"]);
    expect(store.transitions).toHaveLength(2);
  });

  it("does NOT open a framework tx when the plugin write throws", async () => {
    const { handle, plugin, store } = setup();
    let frameworkTxOpened = false;
    store.onTransaction(() => {
      frameworkTxOpened = true;
    });
    plugin.put("sat-1", { status: "online", region: "eu" });
    await expect(
      handle.mutate({
        id: "sat-1",
        apply: () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow(/boom/);
    // The transition-append tx is opened ONLY after a committed plugin write.
    expect(frameworkTxOpened).toBe(false);
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

  // Fix 3 (security) regression: catalog `metadata` is `z.record(z.unknown())`
  // — a nested record, the only reactive catalog field that can carry an
  // arbitrary run-resolved secret string. A run-originated write (runId set)
  // MUST mask that secret in BOTH the emitted `ENTITY_CHANGED` and the durable
  // `entity_transitions` rows, even when nested inside the metadata object.
  it("masks a secret nested inside a record/metadata field (emit + transitions)", async () => {
    const metadataSchema = z.object({
      name: z.string(),
      metadata: z.record(z.string(), z.unknown()),
    });
    type WithMetadata = z.infer<typeof metadataSchema>;
    const store = createFakeEntityStore();
    const events: EntityChanged[] = [];
    const emitter = createChangeEmitter();
    void emitter.wire(async (payload) => {
      events.push(payload);
    });
    const secretRegistry = createRunSecretRegistry();
    secretRegistry.register("run-1", ["s3cr3t"]);
    const rows = new Map<string, WithMetadata>();
    const handle = createEntityHandle<WithMetadata>({
      kind: "catalog-system",
      schema: metadataSchema,
      store,
      emitter,
      secretRegistry,
      read: async (ids) => {
        const out: Record<string, WithMetadata> = {};
        for (const id of ids) {
          const row = rows.get(id);
          if (row) out[id] = row;
        }
        return out;
      },
    });

    const returned = await handle.mutate({
      id: "sys-1",
      opts: { runId: "run-1" },
      apply: () => {
        const next: WithMetadata = {
          name: "API",
          metadata: { token: "s3cr3t" },
        };
        rows.set("sys-1", next);
        return Promise.resolve(next);
      },
    });

    // The plugin gets the REAL value back...
    expect(returned).toEqual({ name: "API", metadata: { token: "s3cr3t" } });
    // ...but the emitted change masks the nested secret...
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]!.next)).not.toContain("s3cr3t");
    // ...and the durable transition rows mask it too.
    expect(store.transitions.some((t) => t.toValue.includes("s3cr3t"))).toBe(
      false,
    );
  });

  it("mutate RETURNS the unmasked state even though the emitted next is masked", async () => {
    // Masking is an emission/persistence concern: the EMITTED payload + the
    // transition rows are masked, but `mutate`'s return is the real resulting
    // state (the contract is "returns the resulting state"). The calling
    // plugin must get its actual value back, not a redaction token.
    const { events, handle, plugin, store } = setup({
      runId: "run-1",
      secretValues: ["s3cr3t"],
    });
    const returned = await handle.mutate({
      id: "sat-1",
      opts: { runId: "run-1" },
      apply: () =>
        Promise.resolve(plugin.put("sat-1", { status: "online", region: "s3cr3t" })),
    });
    // Return value is UNMASKED.
    expect(returned).toEqual({ status: "online", region: "s3cr3t" });
    // ...but the emitted change event masks the secret value.
    expect(JSON.stringify(events[0]!.next)).not.toContain("s3cr3t");
    // ...and the durable transition rows also mask it.
    expect(store.transitions.some((t) => t.toValue.includes("s3cr3t"))).toBe(
      false,
    );
  });
});

describe("Model B — changeId for dispatch dedup", () => {
  it("stamps a distinct changeId on each emitted change", async () => {
    const { events, handle, plugin } = setup();
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "online", region: "eu" })),
    });
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "offline", region: "eu" })),
    });
    expect(events).toHaveLength(2);
    // Each distinct change carries a changeId...
    expect(typeof events[0]!.changeId).toBe("string");
    expect(events[0]!.changeId).not.toHaveLength(0);
    // ...and two distinct changes get distinct ids, even back-to-back (where
    // `occurredAt` can collide at millisecond granularity).
    expect(events[0]!.changeId).not.toBe(events[1]!.changeId);
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

describe("Model B mutate — validation + actor", () => {
  it("hard-fails an invalid state via zod (apply returns a bad shape)", async () => {
    const { handle, plugin } = setup();
    await expect(
      handle.mutate({
        id: "sat-1",
        apply: () =>
          Promise.resolve(
            // @ts-expect-error — deliberately invalid status
            plugin.put("sat-1", { status: "nope", region: "eu" }),
          ),
      }),
    ).rejects.toThrow();
  });

  it("carries an explicit actor when provided", async () => {
    const { events, handle, plugin } = setup();
    const actor = { type: "user" as const, id: "u-1", name: "Alice" };
    await handle.mutate({
      id: "sat-1",
      opts: { actor },
      apply: () =>
        Promise.resolve(plugin.put("sat-1", { status: "online", region: "eu" })),
    });
    expect(events[0]!.actor).toEqual(actor);
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

  it("inStateForMs reflects the elapsed time since the latest transition", async () => {
    const { handle, plugin, store } = setup();
    const start = new Date(Date.now() - 5_000);
    store.setClock(() => start);
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "online", region: "eu" })),
    });
    const ms = await handle.inStateForMs("sat-1", "status");
    expect(ms).toBeGreaterThanOrEqual(4_000);
  });

  it("transitionCount counts transitions of a field in the window", async () => {
    const { handle, plugin, store } = setup();
    const now = Date.now();
    let t = now - 3 * 60_000;
    store.setClock(() => new Date(t));
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "online", region: "eu" })),
    });
    t += 60_000;
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "offline", region: "eu" })),
    });
    t += 60_000;
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "online", region: "eu" })),
    });
    const count = await handle.transitionCount({
      id: "sat-1",
      field: "status",
      windowMs: 10 * 60_000,
    });
    expect(count).toBe(3);
  });

  it("transitionCount excludes transitions outside the window", async () => {
    const { handle, plugin, store } = setup();
    const now = Date.now();
    store.setClock(() => new Date(now - 60 * 60_000)); // 1h ago
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "online", region: "eu" })),
    });
    store.setClock(() => new Date(now - 30_000)); // 30s ago
    await handle.mutate({
      id: "sat-1",
      apply: () => Promise.resolve(plugin.put("sat-1", { status: "offline", region: "eu" })),
    });
    const count = await handle.transitionCount({
      id: "sat-1",
      field: "status",
      windowMs: 5 * 60_000, // only the last 5 min
    });
    expect(count).toBe(1);
  });
});
