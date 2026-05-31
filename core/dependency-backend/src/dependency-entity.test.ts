import { describe, it, expect } from "bun:test";
import type {
  EntityChanged,
  EntityHandle,
} from "@checkstack/automation-backend";
import { SYSTEM_ACTOR } from "@checkstack/common";

import {
  DEPENDENCY_EDGE_ENTITY_KIND,
  DEPENDENCY_TRIGGER_EVENTS,
  DependencyEdgeStateSchema,
  createDependencyEntityRead,
  dependencyChangeToPayload,
  deriveDependencyTriggerEvents,
  removeDependencyEdge,
  toDependencyEdgeState,
  writeDependencyEdge,
  type DependencyEdgeState,
} from "./dependency-entity";
import {
  dependencyCreatedTrigger,
  dependencyDeletedTrigger,
  dependencyUpdatedTrigger,
} from "./automations";
import type { DependencyService } from "./services/dependency-service";

function change(overrides: Partial<EntityChanged> = {}): EntityChanged {
  return {
    kind: DEPENDENCY_EDGE_ENTITY_KIND,
    id: "dep-1",
    prev: {
      sourceSystemId: "a",
      targetSystemId: "b",
      impactType: "degraded",
      transitive: false,
    },
    next: {
      sourceSystemId: "a",
      targetSystemId: "b",
      impactType: "critical",
      transitive: false,
    },
    delta: { impactType: "critical" },
    changedFields: ["impactType"],
    actor: SYSTEM_ACTOR,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("dependencyChangeToPayload — payloadSchema parity", () => {
  it("a create payload validates against the created trigger's payloadSchema", () => {
    const payload = dependencyChangeToPayload(
      change({
        prev: null,
        next: {
          sourceSystemId: "a",
          targetSystemId: "b",
          impactType: "degraded",
          transitive: false,
        },
      }),
    );
    const parsed = dependencyCreatedTrigger.payloadSchema.parse(payload);
    expect(parsed.dependencyId).toBe("dep-1");
    expect(parsed.sourceSystemId).toBe("a");
    expect(parsed.targetSystemId).toBe("b");
    expect(parsed.impactType).toBe("degraded");
  });

  it("an update payload validates against the updated trigger's payloadSchema", () => {
    const parsed = dependencyUpdatedTrigger.payloadSchema.parse(
      dependencyChangeToPayload(change()),
    );
    expect(parsed.dependencyId).toBe("dep-1");
    expect(parsed.impactType).toBe("critical");
  });

  it("a delete payload validates against the deleted trigger's payloadSchema (endpoints from prev)", () => {
    const parsed = dependencyDeletedTrigger.payloadSchema.parse(
      dependencyChangeToPayload(change({ next: null })),
    );
    expect(parsed.dependencyId).toBe("dep-1");
    // The deleted edge's endpoints come from `prev` (next is the tombstone).
    expect(parsed.sourceSystemId).toBe("a");
    expect(parsed.targetSystemId).toBe("b");
  });
});

describe("deriveDependencyTriggerEvents", () => {
  it("create → dependency.created", () => {
    expect(
      deriveDependencyTriggerEvents(
        change({
          prev: null,
          next: {
            sourceSystemId: "a",
            targetSystemId: "b",
            impactType: "degraded",
            transitive: false,
          },
        }),
      ),
    ).toEqual([DEPENDENCY_TRIGGER_EVENTS.created]);
  });
  it("tombstone → dependency.deleted", () => {
    expect(deriveDependencyTriggerEvents(change({ next: null }))).toEqual([
      DEPENDENCY_TRIGGER_EVENTS.deleted,
    ]);
  });
  it("update → dependency.updated", () => {
    expect(deriveDependencyTriggerEvents(change())).toEqual([
      DEPENDENCY_TRIGGER_EVENTS.updated,
    ]);
  });
});

describe("DependencyEdgeStateSchema", () => {
  it("parses the reactive subset", () => {
    const parsed = DependencyEdgeStateSchema.parse({
      sourceSystemId: "a",
      targetSystemId: "b",
      impactType: "degraded",
      transitive: true,
    });
    expect(parsed.transitive).toBe(true);
  });
});

describe("toDependencyEdgeState", () => {
  it("projects the reactive subset off a full dependency", () => {
    expect(
      toDependencyEdgeState({
        sourceSystemId: "a",
        targetSystemId: "b",
        impactType: "critical",
        transitive: true,
      }),
    ).toEqual({
      sourceSystemId: "a",
      targetSystemId: "b",
      impactType: "critical",
      transitive: true,
    });
  });
});

describe("createDependencyEntityRead", () => {
  it("routes the batched read straight to the service (plugin-backed)", async () => {
    const seen: ReadonlyArray<string>[] = [];
    const service = {
      async getManyEntityStates(ids: ReadonlyArray<string>) {
        seen.push(ids);
        return {
          "dep-1": {
            sourceSystemId: "a",
            targetSystemId: "b",
            impactType: "degraded" as const,
            transitive: false,
          },
        };
      },
    } as unknown as DependencyService;
    const read = createDependencyEntityRead(service);
    const out = await read(["dep-1", "dep-2"]);
    expect(seen).toEqual([["dep-1", "dep-2"]]);
    expect(out["dep-1"]).toEqual({
      sourceSystemId: "a",
      targetSystemId: "b",
      impactType: "degraded",
      transitive: false,
    });
  });
});

describe("writeDependencyEdge", () => {
  it("drives the write through handle.mutate keyed by dependency id", async () => {
    const calls: Array<{ id: string; next: DependencyEdgeState }> = [];
    const handle = {
      kind: DEPENDENCY_EDGE_ENTITY_KIND,
      async mutate(input: {
        id: string;
        apply: () => Promise<DependencyEdgeState>;
      }) {
        const next = await input.apply();
        calls.push({ id: input.id, next });
        return next;
      },
    } as unknown as EntityHandle<DependencyEdgeState>;
    let applied = false;
    await writeDependencyEdge({
      handle,
      dependencyId: "dep-9",
      apply: async () => {
        applied = true;
        return {
          sourceSystemId: "a",
          targetSystemId: "b",
          impactType: "critical",
          transitive: true,
        };
      },
    });
    expect(applied).toBe(true);
    expect(calls).toEqual([
      {
        id: "dep-9",
        next: {
          sourceSystemId: "a",
          targetSystemId: "b",
          impactType: "critical",
          transitive: true,
        },
      },
    ]);
  });

  it("still runs the plugin write when no handle is wired", async () => {
    let applied = false;
    await writeDependencyEdge({
      handle: undefined,
      dependencyId: "x",
      apply: async () => {
        applied = true;
        return {
          sourceSystemId: "a",
          targetSystemId: "b",
          impactType: "degraded",
          transitive: false,
        };
      },
    });
    expect(applied).toBe(true);
  });
});

describe("removeDependencyEdge", () => {
  it("tombstones via handle.remove({ apply })", async () => {
    const removed: string[] = [];
    let deleted = false;
    const handle = {
      kind: DEPENDENCY_EDGE_ENTITY_KIND,
      async remove(input: { id: string; apply: () => Promise<void> }) {
        await input.apply();
        removed.push(input.id);
      },
    } as unknown as EntityHandle<DependencyEdgeState>;
    await removeDependencyEdge({
      handle,
      dependencyId: "dep-9",
      apply: async () => {
        deleted = true;
      },
    });
    expect(deleted).toBe(true);
    expect(removed).toEqual(["dep-9"]);
  });

  it("still runs the delete when no handle is wired", async () => {
    let deleted = false;
    await removeDependencyEdge({
      handle: undefined,
      dependencyId: "x",
      apply: async () => {
        deleted = true;
      },
    });
    expect(deleted).toBe(true);
  });
});
