/**
 * Behaviour tests for the dependency automation triggers + actions.
 */
import { describe, expect, it, mock } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";

import {
  createDependencyActions,
  dependencyArtifactType,
  dependencyCreatedTrigger,
  dependencyDeletedTrigger,
  dependencyImpactPropagatedTrigger,
  dependencyTriggers,
  dependencyUpdatedTrigger,
} from "./automations";
import type { DependencyService } from "./services/dependency-service";

const logger = createMockLogger() as Logger;

const ctxBase = {
  runId: "run-1",
  automationId: "auto-1",
  contextKey: null,
  logger,
  getService: async <T,>(): Promise<T> => {
    throw new Error("not used");
  },
};

describe("dependency triggers", () => {
  it("exposes four triggers in a stable order", () => {
    expect(dependencyTriggers).toHaveLength(4);
    expect(dependencyTriggers[0]).toBe(
      dependencyCreatedTrigger as (typeof dependencyTriggers)[number],
    );
    expect(dependencyTriggers[1]).toBe(
      dependencyUpdatedTrigger as (typeof dependencyTriggers)[number],
    );
    expect(dependencyTriggers[2]).toBe(
      dependencyDeletedTrigger as (typeof dependencyTriggers)[number],
    );
    expect(dependencyTriggers[3]).toBe(
      dependencyImpactPropagatedTrigger as (typeof dependencyTriggers)[number],
    );
  });

  it("extracts dependencyId as the contextKey on the edge-lifecycle triggers", () => {
    const payload = {
      dependencyId: "dep-1",
      sourceSystemId: "sys-a",
      targetSystemId: "sys-b",
      impactType: "critical",
    } as const;
    expect(dependencyCreatedTrigger.contextKey?.(payload)).toBe("dep-1");
    expect(dependencyUpdatedTrigger.contextKey?.(payload)).toBe("dep-1");
    expect(dependencyDeletedTrigger.contextKey?.(payload)).toBe("dep-1");
  });

  it("extracts sourceSystemId as the contextKey on impactPropagated", () => {
    const payload = {
      sourceSystemId: "sys-upstream",
      affectedSystems: [
        { systemId: "sys-a", previousState: null, newState: "degraded" as const },
      ],
      timestamp: "2026-05-29T12:00:00Z",
    };
    expect(dependencyImpactPropagatedTrigger.contextKey?.(payload)).toBe(
      "sys-upstream",
    );
  });

  it("requires affectedSystems on the impactPropagated payload", () => {
    const ok = dependencyImpactPropagatedTrigger.payloadSchema.safeParse({
      sourceSystemId: "sys-1",
      affectedSystems: [],
      timestamp: "2026-05-29T12:00:00Z",
    });
    expect(ok.success).toBe(true);

    const bad = dependencyImpactPropagatedTrigger.payloadSchema.safeParse({
      sourceSystemId: "sys-1",
      timestamp: "2026-05-29T12:00:00Z",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects edge-lifecycle payloads missing required fields", () => {
    const bad = dependencyCreatedTrigger.payloadSchema.safeParse({
      dependencyId: "dep-1",
      sourceSystemId: "sys-a",
    });
    expect(bad.success).toBe(false);
  });
});

describe("dependencyArtifactType", () => {
  it("validates the canonical edge shape", () => {
    const ok = dependencyArtifactType.schema.safeParse({
      dependencyId: "dep-1",
      sourceSystemId: "sys-a",
      targetSystemId: "sys-b",
      impactType: "critical",
    });
    expect(ok.success).toBe(true);

    // The artifact schema now uses the canonical ImpactType enum, so a
    // value outside it is rejected.
    const bad = dependencyArtifactType.schema.safeParse({
      dependencyId: "dep-1",
      sourceSystemId: "sys-a",
      targetSystemId: "sys-b",
      impactType: "soft",
    });
    expect(bad.success).toBe(false);
  });
});

interface FakeDependencyRow {
  id: string;
  sourceSystemId: string;
  targetSystemId: string;
  impactType: string;
  transitive: boolean;
  label: string | null;
}

function makeService(args: {
  createBehaviour?:
    | { ok: true; row: FakeDependencyRow }
    | { ok: false; error: string };
  existingForRemove?: FakeDependencyRow;
  deleteResult?: boolean;
}): DependencyService & {
  createMock: ReturnType<typeof mock>;
  deleteMock: ReturnType<typeof mock>;
  getByIdMock: ReturnType<typeof mock>;
} {
  const createMock = mock(async (input: unknown) => {
    if (args.createBehaviour && !args.createBehaviour.ok) {
      throw new Error(args.createBehaviour.error);
    }
    if (args.createBehaviour?.ok) return args.createBehaviour.row;
    const i = input as { sourceSystemId: string; targetSystemId: string; impactType: string };
    return {
      id: "generated",
      sourceSystemId: i.sourceSystemId,
      targetSystemId: i.targetSystemId,
      impactType: i.impactType,
      transitive: false,
      label: null,
    };
  });
  const deleteMock = mock(async (_id: string) => args.deleteResult ?? true);
  const getByIdMock = mock(async (_id: string) => args.existingForRemove);
  return {
    createDependency: createMock,
    deleteDependency: deleteMock,
    getDependencyById: getByIdMock,
    createMock,
    deleteMock,
    getByIdMock,
  } as unknown as DependencyService & {
    createMock: ReturnType<typeof mock>;
    deleteMock: ReturnType<typeof mock>;
    getByIdMock: ReturnType<typeof mock>;
  };
}

describe("dependency.create", () => {
  it("creates an edge, fires dependencyCreated, and emits an artifact", async () => {
    const service = makeService({
      createBehaviour: {
        ok: true,
        row: {
          id: "dep-1",
          sourceSystemId: "sys-a",
          targetSystemId: "sys-b",
          impactType: "critical",
          transitive: false,
          label: null,
        },
      },
    });
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const setCalls: Array<{ id: string; next: unknown }> = [];
    const getDependencyEntity = () =>
      ({
        kind: "dependency-edge",
        async set(id: string, next: unknown) {
          setCalls.push({ id, next });
        },
      }) as never;
    const [create] = createDependencyActions({
      service,
      emitHook: emitHook as never,
      getDependencyEntity,
    });

    const result = await create!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        sourceSystemId: "sys-a",
        targetSystemId: "sys-b",
        impactType: "critical",
        transitive: false,
      } as never,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBe("dep-1");
    expect((result.artifact as { dependencyId: string }).dependencyId).toBe("dep-1");
    // The old `dependencyCreated` hook emission was replaced by mirroring the
    // edge into the reactive `dependency-edge` entity (§10.5).
    expect(emitHook).not.toHaveBeenCalled();
    expect(setCalls).toEqual([
      {
        id: "dep-1",
        next: {
          sourceSystemId: "sys-a",
          targetSystemId: "sys-b",
          impactType: "critical",
          transitive: false,
        },
      },
    ]);
  });

  it("returns a failure when service.createDependency throws (e.g. cycle detected)", async () => {
    const service = makeService({
      createBehaviour: {
        ok: false,
        error: "Cannot create dependency: would form a circular chain: a → b → a",
      },
    });
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const [create] = createDependencyActions({ service, emitHook: emitHook as never });

    const result = await create!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        sourceSystemId: "a",
        targetSystemId: "b",
        impactType: "soft",
      } as never,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/circular chain/);
    expect(emitHook).not.toHaveBeenCalled();
  });
});

describe("dependency.remove", () => {
  it("removes an edge, fires dependencyDeleted, and emits an artifact reflecting the removed edge", async () => {
    const service = makeService({
      existingForRemove: {
        id: "dep-1",
        sourceSystemId: "sys-a",
        targetSystemId: "sys-b",
        impactType: "critical",
        transitive: false,
        label: null,
      },
      deleteResult: true,
    });
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const removeCalls: string[] = [];
    const getDependencyEntity = () =>
      ({
        kind: "dependency-edge",
        async remove(id: string) {
          removeCalls.push(id);
        },
      }) as never;
    const [, remove] = createDependencyActions({
      service,
      emitHook: emitHook as never,
      getDependencyEntity,
    });

    const result = await remove!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { dependencyId: "dep-1" } as never,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBe("dep-1");
    // The old `dependencyDeleted` hook emission was replaced by tombstoning
    // the reactive `dependency-edge` entity (§10.5).
    expect(emitHook).not.toHaveBeenCalled();
    expect(removeCalls).toEqual(["dep-1"]);
  });

  it("returns failure if the dependency does not exist", async () => {
    const service = makeService({ existingForRemove: undefined });
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const [, remove] = createDependencyActions({ service, emitHook: emitHook as never });

    const result = await remove!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { dependencyId: "missing" } as never,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/not found/i);
    expect(emitHook).not.toHaveBeenCalled();
  });

  it("returns failure if delete returns false (race-deleted)", async () => {
    const service = makeService({
      existingForRemove: {
        id: "dep-1",
        sourceSystemId: "sys-a",
        targetSystemId: "sys-b",
        impactType: "critical",
        transitive: false,
        label: null,
      },
      deleteResult: false,
    });
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const [, remove] = createDependencyActions({ service, emitHook: emitHook as never });

    const result = await remove!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { dependencyId: "dep-1" } as never,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/disappeared mid-delete/);
    expect(emitHook).not.toHaveBeenCalled();
  });
});
