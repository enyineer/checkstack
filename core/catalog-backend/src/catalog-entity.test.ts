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
  catalogSystemChangeToPayload,
  createCatalogGroupEntityRead,
  createCatalogSystemEntityRead,
  deriveCatalogGroupTriggerEvents,
  deriveCatalogSystemTriggerEvents,
  removeCatalogEntity,
  toCatalogGroupState,
  toCatalogSystemState,
  writeCatalogGroupEntity,
  writeCatalogSystemEntity,
  type CatalogGroupState,
  type CatalogSystemState,
} from "./catalog-entity";
import {
  systemCreatedTrigger,
  systemDeletedTrigger,
  systemUpdatedTrigger,
} from "./automations";
import type { EntityService } from "./services/entity-service";

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

describe("catalogSystemChangeToPayload — payloadSchema parity", () => {
  it("a create payload validates against the created trigger's payloadSchema", () => {
    const payload = catalogSystemChangeToPayload(
      change({
        prev: null,
        next: { name: "new", description: null, metadata: {} },
        delta: { name: "new" },
        changedFields: ["name", "description", "metadata"],
      }),
    );
    const parsed = systemCreatedTrigger.payloadSchema.parse(payload);
    expect(parsed.systemId).toBe("sys-1");
    expect(parsed.systemName).toBe("new");
  });

  it("an update payload validates against the updated trigger's payloadSchema with changedFields", () => {
    const payload = catalogSystemChangeToPayload(
      change({ changedFields: ["name", "metadata"] }),
    );
    const parsed = systemUpdatedTrigger.payloadSchema.parse(payload);
    expect(parsed.systemId).toBe("sys-1");
    expect(parsed.systemName).toBe("new");
    expect(parsed.changedFields).toEqual(["name", "metadata"]);
  });

  it("a delete payload validates against the deleted trigger's payloadSchema (systemName omitted on tombstone)", () => {
    const payload = catalogSystemChangeToPayload(change({ next: null }));
    const parsed = systemDeletedTrigger.payloadSchema.parse(payload);
    expect(parsed.systemId).toBe("sys-1");
    expect(parsed.systemName).toBeUndefined();
  });

  it("drops non-enum changedFields (only name/description/metadata survive)", () => {
    const payload = catalogSystemChangeToPayload(
      change({ changedFields: ["name", "ownerId", "metadata"] }),
    );
    const parsed = systemUpdatedTrigger.payloadSchema.parse(payload);
    expect(parsed.changedFields).toEqual(["name", "metadata"]);
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

describe("toCatalogSystemState / toCatalogGroupState", () => {
  it("projects a system, normalising null description + metadata", () => {
    expect(
      toCatalogSystemState({
        name: "API",
        description: undefined,
        metadata: undefined,
      }),
    ).toEqual({ name: "API", description: null, metadata: {} });
  });

  it("projects a group, normalising null metadata", () => {
    expect(
      toCatalogGroupState({ name: "Team A", metadata: null }),
    ).toEqual({ name: "Team A", metadata: {} });
  });
});

describe("createCatalogSystemEntityRead", () => {
  it("routes the batched read straight to the service (plugin-backed)", async () => {
    const seen: ReadonlyArray<string>[] = [];
    const service = {
      async getManySystemEntityStates(ids: ReadonlyArray<string>) {
        seen.push(ids);
        return {
          "sys-1": { name: "API", description: null, metadata: { tier: "1" } },
        };
      },
    } as unknown as EntityService;
    const read = createCatalogSystemEntityRead(service);
    const out = await read(["sys-1", "sys-2"]);
    expect(seen).toEqual([["sys-1", "sys-2"]]);
    expect(out["sys-1"]).toEqual({
      name: "API",
      description: null,
      metadata: { tier: "1" },
    });
  });
});

describe("createCatalogGroupEntityRead", () => {
  it("routes the batched read straight to the service (plugin-backed)", async () => {
    const seen: ReadonlyArray<string>[] = [];
    const service = {
      async getManyGroupEntityStates(ids: ReadonlyArray<string>) {
        seen.push(ids);
        return { "g-1": { name: "Team A", metadata: {} } };
      },
    } as unknown as EntityService;
    const read = createCatalogGroupEntityRead(service);
    const out = await read(["g-1"]);
    expect(seen).toEqual([["g-1"]]);
    expect(out["g-1"]).toEqual({ name: "Team A", metadata: {} });
  });
});

describe("writeCatalogSystemEntity", () => {
  it("drives the write through handle.mutate keyed by system id", async () => {
    const calls: Array<{ id: string; next: CatalogSystemState }> = [];
    const handle = {
      kind: CATALOG_SYSTEM_ENTITY_KIND,
      async mutate(input: {
        id: string;
        apply: () => Promise<CatalogSystemState>;
      }) {
        const next = await input.apply();
        calls.push({ id: input.id, next });
        return next;
      },
    } as unknown as EntityHandle<CatalogSystemState>;
    let applied = false;
    await writeCatalogSystemEntity({
      handle,
      systemId: "sys-9",
      apply: async () => {
        applied = true;
        return { name: "API", description: null, metadata: {} };
      },
    });
    expect(applied).toBe(true);
    expect(calls).toEqual([
      { id: "sys-9", next: { name: "API", description: null, metadata: {} } },
    ]);
  });

  it("still runs the plugin write when no handle is wired", async () => {
    let applied = false;
    await writeCatalogSystemEntity({
      handle: undefined,
      systemId: "sys-9",
      apply: async () => {
        applied = true;
        return { name: "API", description: null, metadata: {} };
      },
    });
    expect(applied).toBe(true);
  });
});

describe("writeCatalogGroupEntity", () => {
  it("drives the write through handle.mutate keyed by group id", async () => {
    const calls: Array<{ id: string; next: CatalogGroupState }> = [];
    const handle = {
      kind: CATALOG_GROUP_ENTITY_KIND,
      async mutate(input: {
        id: string;
        apply: () => Promise<CatalogGroupState>;
      }) {
        const next = await input.apply();
        calls.push({ id: input.id, next });
        return next;
      },
    } as unknown as EntityHandle<CatalogGroupState>;
    await writeCatalogGroupEntity({
      handle,
      groupId: "g-1",
      apply: async () => ({ name: "Team A", metadata: { tier: "1" } }),
    });
    expect(calls).toEqual([
      { id: "g-1", next: { name: "Team A", metadata: { tier: "1" } } },
    ]);
  });
});

describe("removeCatalogEntity", () => {
  it("tombstones via handle.remove({ apply })", async () => {
    const removed: string[] = [];
    let deleted = false;
    const handle = {
      kind: CATALOG_SYSTEM_ENTITY_KIND,
      async remove(input: { id: string; apply: () => Promise<void> }) {
        await input.apply();
        removed.push(input.id);
      },
    } as unknown as EntityHandle<Record<string, unknown>>;
    await removeCatalogEntity({
      handle,
      id: "sys-9",
      apply: async () => {
        deleted = true;
      },
    });
    expect(deleted).toBe(true);
    expect(removed).toEqual(["sys-9"]);
  });

  it("still runs the delete when no handle is wired", async () => {
    let deleted = false;
    await removeCatalogEntity({
      handle: undefined,
      id: "x",
      apply: async () => {
        deleted = true;
      },
    });
    expect(deleted).toBe(true);
  });
});
