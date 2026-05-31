import { describe, it, expect } from "bun:test";
import type {
  EntityChanged,
  EntityHandle,
} from "@checkstack/automation-backend";
import { SYSTEM_ACTOR } from "@checkstack/common";

import {
  CATALOG_GROUP_ENTITY_KIND,
  CATALOG_GROUP_TRIGGER_EVENTS,
  CATALOG_SYSTEM_ENTITY_KIND,
  CATALOG_SYSTEM_TRIGGER_EVENTS,
  deriveCatalogGroupTriggerEvents,
  deriveCatalogSystemTriggerEvents,
  mirrorCatalogGroup,
  mirrorCatalogSystem,
  removeCatalogEntity,
  type CatalogGroupState,
  type CatalogSystemState,
} from "./catalog-entity";

function change(overrides: Partial<EntityChanged> = {}): EntityChanged {
  return {
    kind: CATALOG_SYSTEM_ENTITY_KIND,
    id: "sys-1",
    prev: { name: "old", description: null, metadata: {} },
    next: { name: "new", description: null, metadata: {} },
    delta: { name: "new" },
    changedFields: ["name"],
    actor: SYSTEM_ACTOR,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("CATALOG_SYSTEM_TRIGGER_EVENTS (must equal the trigger qualifiedIds)", () => {
  it("emits the registered system trigger qualifiedIds, not the dotted hook ids", () => {
    // The catalog system triggers have ids `created`/`updated`/`deleted`
    // (pluginId `catalog`), so the deriver MUST emit `catalog.created` etc.,
    // NOT the dotted hook ids `catalog.system.created`.
    expect(CATALOG_SYSTEM_TRIGGER_EVENTS.created).toBe("catalog.created");
    expect(CATALOG_SYSTEM_TRIGGER_EVENTS.updated).toBe("catalog.updated");
    expect(CATALOG_SYSTEM_TRIGGER_EVENTS.deleted).toBe("catalog.deleted");
  });
});

describe("deriveCatalogSystemTriggerEvents", () => {
  it("maps a create (prev === null) to system.created", () => {
    expect(
      deriveCatalogSystemTriggerEvents(
        change({ prev: null, next: { name: "n", description: null, metadata: {} } }),
      ),
    ).toEqual([CATALOG_SYSTEM_TRIGGER_EVENTS.created]);
  });
  it("maps a tombstone (next === null) to system.deleted", () => {
    expect(
      deriveCatalogSystemTriggerEvents(change({ next: null })),
    ).toEqual([CATALOG_SYSTEM_TRIGGER_EVENTS.deleted]);
  });
  it("maps a field update to system.updated", () => {
    expect(deriveCatalogSystemTriggerEvents(change())).toEqual([
      CATALOG_SYSTEM_TRIGGER_EVENTS.updated,
    ]);
  });
});

describe("deriveCatalogGroupTriggerEvents", () => {
  it("maps a create to group.created", () => {
    expect(
      deriveCatalogGroupTriggerEvents(
        change({
          kind: CATALOG_GROUP_ENTITY_KIND,
          prev: null,
          next: { name: "g", metadata: {} },
        }),
      ),
    ).toEqual([CATALOG_GROUP_TRIGGER_EVENTS.created]);
  });
  it("maps a tombstone to group.deleted", () => {
    expect(
      deriveCatalogGroupTriggerEvents(
        change({ kind: CATALOG_GROUP_ENTITY_KIND, next: null }),
      ),
    ).toEqual([CATALOG_GROUP_TRIGGER_EVENTS.deleted]);
  });
  it("fires nothing on a group update (no group.updated hook)", () => {
    expect(
      deriveCatalogGroupTriggerEvents(
        change({
          kind: CATALOG_GROUP_ENTITY_KIND,
          prev: { name: "a", metadata: {} },
          next: { name: "b", metadata: {} },
        }),
      ),
    ).toEqual([]);
  });
});

describe("catalog mirrors", () => {
  it("mirrors a system normalising null description + metadata", async () => {
    const calls: Array<{ id: string; next: CatalogSystemState }> = [];
    const handle = {
      kind: CATALOG_SYSTEM_ENTITY_KIND,
      async set(id: string, next: CatalogSystemState) {
        calls.push({ id, next });
      },
    } as unknown as EntityHandle<CatalogSystemState>;
    await mirrorCatalogSystem({
      handle,
      systemId: "sys-9",
      name: "API",
      description: undefined,
      metadata: undefined,
    });
    expect(calls).toEqual([
      { id: "sys-9", next: { name: "API", description: null, metadata: {} } },
    ]);
  });

  it("mirrors a group", async () => {
    const calls: Array<{ id: string; next: CatalogGroupState }> = [];
    const handle = {
      kind: CATALOG_GROUP_ENTITY_KIND,
      async set(id: string, next: CatalogGroupState) {
        calls.push({ id, next });
      },
    } as unknown as EntityHandle<CatalogGroupState>;
    await mirrorCatalogGroup({
      handle,
      groupId: "g-1",
      name: "Team A",
      metadata: { tier: "1" },
    });
    expect(calls).toEqual([
      { id: "g-1", next: { name: "Team A", metadata: { tier: "1" } } },
    ]);
  });

  it("removeCatalogEntity tombstones via remove()", async () => {
    const removed: string[] = [];
    const handle = {
      kind: CATALOG_SYSTEM_ENTITY_KIND,
      async remove(id: string) {
        removed.push(id);
      },
    } as unknown as EntityHandle<Record<string, unknown>>;
    await removeCatalogEntity({ handle, id: "sys-9" });
    expect(removed).toEqual(["sys-9"]);
  });

  it("is a no-op when handle is undefined", async () => {
    await mirrorCatalogSystem({
      handle: undefined,
      systemId: "x",
      name: "x",
      description: null,
      metadata: null,
    });
    await removeCatalogEntity({ handle: undefined, id: "x" });
    expect(true).toBe(true);
  });

  it("routes errors to onError", async () => {
    let captured: unknown;
    const handle = {
      kind: CATALOG_SYSTEM_ENTITY_KIND,
      async set() {
        throw new Error("boom");
      },
    } as unknown as EntityHandle<CatalogSystemState>;
    await mirrorCatalogSystem({
      handle,
      systemId: "x",
      name: "x",
      description: null,
      metadata: null,
      onError: (e) => {
        captured = e;
      },
    });
    expect((captured as Error).message).toBe("boom");
  });
});
