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
  deriveDependencyTriggerEvents,
  mirrorDependencyEdge,
  removeDependencyEdge,
  type DependencyEdgeState,
} from "./dependency-entity";

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

describe("dependency edge mirror", () => {
  it("mirrors keyed by dependency id", async () => {
    const calls: Array<{ id: string; next: DependencyEdgeState }> = [];
    const handle = {
      kind: DEPENDENCY_EDGE_ENTITY_KIND,
      async set(id: string, next: DependencyEdgeState) {
        calls.push({ id, next });
      },
    } as unknown as EntityHandle<DependencyEdgeState>;
    await mirrorDependencyEdge({
      handle,
      dependencyId: "dep-9",
      sourceSystemId: "a",
      targetSystemId: "b",
      impactType: "critical",
      transitive: true,
    });
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

  it("removeDependencyEdge tombstones via remove()", async () => {
    const removed: string[] = [];
    const handle = {
      kind: DEPENDENCY_EDGE_ENTITY_KIND,
      async remove(id: string) {
        removed.push(id);
      },
    } as unknown as EntityHandle<DependencyEdgeState>;
    await removeDependencyEdge({ handle, dependencyId: "dep-9" });
    expect(removed).toEqual(["dep-9"]);
  });

  it("no-ops without a handle and routes errors", async () => {
    await mirrorDependencyEdge({
      handle: undefined,
      dependencyId: "x",
      sourceSystemId: "a",
      targetSystemId: "b",
      impactType: "degraded",
      transitive: false,
    });
    let captured: unknown;
    const handle = {
      kind: DEPENDENCY_EDGE_ENTITY_KIND,
      async set() {
        throw new Error("boom");
      },
    } as unknown as EntityHandle<DependencyEdgeState>;
    await mirrorDependencyEdge({
      handle,
      dependencyId: "x",
      sourceSystemId: "a",
      targetSystemId: "b",
      impactType: "degraded",
      transitive: false,
      onError: (e) => {
        captured = e;
      },
    });
    expect((captured as Error).message).toBe("boom");
  });
});
