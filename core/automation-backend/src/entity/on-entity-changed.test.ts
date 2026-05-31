import { describe, it, expect } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import type { HookEventMeta } from "@checkstack/backend-api";
import type { EntityChanged } from "@checkstack/automation-common";

import {
  createEntityChangedSubscriptions,
  type OnHookFn,
} from "./on-entity-changed";
import { ENTITY_CHANGED_HOOK } from "./hook";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Parameters<
  ReturnType<typeof createEntityChangedSubscriptions>["wire"]
>[0]["logger"];

/**
 * A fake `onHook` that records each subscription with its options and lets
 * a test emit a payload to the matching hook id.
 */
function fakeOnHook() {
  const subs: Array<{
    hookId: string;
    listener: (payload: unknown, meta?: HookEventMeta) => Promise<void>;
    options: unknown;
    active: boolean;
  }> = [];
  const onHook = ((hook, listener, options) => {
    const entry = {
      hookId: hook.id,
      listener: listener as (
        payload: unknown,
        meta?: HookEventMeta,
      ) => Promise<void>,
      options,
      active: true,
    };
    subs.push(entry);
    return async () => {
      entry.active = false;
    };
  }) as OnHookFn;
  const emit = async (payload: EntityChanged) => {
    for (const s of subs) {
      if (s.active && s.hookId === ENTITY_CHANGED_HOOK.id) {
        await s.listener(payload, { actor: SYSTEM_ACTOR });
      }
    }
  };
  return { onHook, subs, emit };
}

function change(overrides: Partial<EntityChanged> = {}): EntityChanged {
  return {
    kind: "health",
    id: "sys-1",
    prev: { status: "healthy" },
    next: { status: "degraded" },
    delta: { status: "degraded" },
    changedFields: ["status"],
    actor: SYSTEM_ACTOR,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("onEntityChanged", () => {
  it("delivers matching-kind changes to the handler after wiring", async () => {
    const svc = createEntityChangedSubscriptions();
    const got: EntityChanged[] = [];
    svc.onEntityChanged({ kind: "health", handler: (c) => void got.push(c) });

    const fake = fakeOnHook();
    svc.wire({ onHook: fake.onHook, logger: noopLogger });

    await fake.emit(change());
    expect(got).toHaveLength(1);
    expect(got[0]?.id).toBe("sys-1");
    expect(got[0]?.delta).toEqual({ status: "degraded" });
  });

  it("filters out changes of a different kind", async () => {
    const svc = createEntityChangedSubscriptions();
    const got: EntityChanged[] = [];
    svc.onEntityChanged({ kind: "incident", handler: (c) => void got.push(c) });
    const fake = fakeOnHook();
    svc.wire({ onHook: fake.onHook, logger: noopLogger });

    await fake.emit(change({ kind: "health" }));
    expect(got).toHaveLength(0);
  });

  it("defaults to broadcast delivery", () => {
    const svc = createEntityChangedSubscriptions();
    svc.onEntityChanged({ kind: "health", handler: () => {} });
    const fake = fakeOnHook();
    svc.wire({ onHook: fake.onHook, logger: noopLogger });
    expect(fake.subs[0]?.options).toEqual({ mode: "broadcast" });
  });

  it("honours work-queue delivery with a worker group", () => {
    const svc = createEntityChangedSubscriptions();
    svc.onEntityChanged({
      kind: "incident",
      handler: () => {},
      delivery: { mode: "work-queue", workerGroup: "slo-react", maxRetries: 2 },
    });
    const fake = fakeOnHook();
    svc.wire({ onHook: fake.onHook, logger: noopLogger });
    expect(fake.subs[0]?.options).toEqual({
      mode: "work-queue",
      workerGroup: "slo-react",
      maxRetries: 2,
    });
  });

  it("rejects work-queue delivery without a worker group", () => {
    const svc = createEntityChangedSubscriptions();
    expect(() =>
      svc.onEntityChanged({
        kind: "incident",
        handler: () => {},
        // @ts-expect-error — intentionally omit the required workerGroup
        delivery: { mode: "work-queue" },
      }),
    ).toThrow(/workerGroup/);
  });

  it("rejects an empty kind", () => {
    const svc = createEntityChangedSubscriptions();
    expect(() =>
      svc.onEntityChanged({ kind: "  ", handler: () => {} }),
    ).toThrow(/kind/);
  });

  it("buffers a subscription registered before wiring", async () => {
    const svc = createEntityChangedSubscriptions();
    const got: EntityChanged[] = [];
    // Register BEFORE wire().
    svc.onEntityChanged({ kind: "health", handler: (c) => void got.push(c) });
    const fake = fakeOnHook();
    // No subscription wired yet.
    expect(fake.subs).toHaveLength(0);
    svc.wire({ onHook: fake.onHook, logger: noopLogger });
    expect(fake.subs).toHaveLength(1);
    await fake.emit(change());
    expect(got).toHaveLength(1);
  });

  it("stops delivering after unsubscribe", async () => {
    const svc = createEntityChangedSubscriptions();
    const got: EntityChanged[] = [];
    const unsub = svc.onEntityChanged({
      kind: "health",
      handler: (c) => void got.push(c),
    });
    const fake = fakeOnHook();
    svc.wire({ onHook: fake.onHook, logger: noopLogger });
    await fake.emit(change());
    await unsub();
    await fake.emit(change());
    expect(got).toHaveLength(1);
  });

  it("isolates a throwing handler", async () => {
    const svc = createEntityChangedSubscriptions();
    let secondRan = false;
    svc.onEntityChanged({
      kind: "health",
      handler: () => {
        throw new Error("boom");
      },
    });
    svc.onEntityChanged({
      kind: "health",
      handler: () => {
        secondRan = true;
      },
    });
    const fake = fakeOnHook();
    svc.wire({ onHook: fake.onHook, logger: noopLogger });
    await fake.emit(change());
    expect(secondRan).toBe(true);
  });
});
