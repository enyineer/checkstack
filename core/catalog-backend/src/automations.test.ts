/**
 * Behaviour tests for the catalog automation triggers + actions.
 *
 * The triggers are dataclasses (id, payloadSchema, hook, contextKey),
 * so we lock down their payload validation + contextKey extraction.
 * The `update_metadata` action carries the real behaviour: shallow
 * merge vs. replace, cache invalidation, hook emission, the
 * "missing system" failure path, and the "race-deleted mid-update"
 * failure path.
 */
import { describe, expect, it, mock } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";

import {
  catalogTriggers,
  createCatalogActions,
  systemCreatedTrigger,
  systemDeletedTrigger,
  systemRecordArtifactType,
  systemUpdatedTrigger,
} from "./automations";
import type { EntityService } from "./services/entity-service";
import type { createCatalogCache } from "./cache";

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

// ─── Triggers ──────────────────────────────────────────────────────────

describe("catalog triggers", () => {
  it("exposes three triggers in a stable order", () => {
    expect(catalogTriggers).toHaveLength(3);
    expect(catalogTriggers[0]).toBe(
      systemCreatedTrigger as (typeof catalogTriggers)[number],
    );
    expect(catalogTriggers[1]).toBe(
      systemUpdatedTrigger as (typeof catalogTriggers)[number],
    );
    expect(catalogTriggers[2]).toBe(
      systemDeletedTrigger as (typeof catalogTriggers)[number],
    );
  });

  it("validates the systemCreated payload + extracts systemId as contextKey", () => {
    const payload = { systemId: "sys-1", systemName: "API" };
    const parsed = systemCreatedTrigger.payloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(systemCreatedTrigger.contextKey?.(payload)).toBe("sys-1");
    // Entity-driven now (§10.4): no hook, a no-op setup keeps it in the
    // editor catalog; the `catalog-system` deriver fires `catalog.created`.
    expect(systemCreatedTrigger.hook).toBeUndefined();
    expect(typeof systemCreatedTrigger.setup).toBe("function");
  });

  it("requires changedFields on the systemUpdated payload", () => {
    const ok = systemUpdatedTrigger.payloadSchema.safeParse({
      systemId: "sys-1",
      systemName: "API",
      changedFields: ["metadata"],
    });
    expect(ok.success).toBe(true);

    const bad = systemUpdatedTrigger.payloadSchema.safeParse({
      systemId: "sys-1",
      systemName: "API",
    });
    expect(bad.success).toBe(false);

    const badEnum = systemUpdatedTrigger.payloadSchema.safeParse({
      systemId: "sys-1",
      systemName: "API",
      changedFields: ["unknown_field"],
    });
    expect(badEnum.success).toBe(false);
  });

  it("accepts an optional systemName on the systemDeleted payload", () => {
    const withName = systemDeletedTrigger.payloadSchema.safeParse({
      systemId: "sys-1",
      systemName: "API",
    });
    const withoutName = systemDeletedTrigger.payloadSchema.safeParse({
      systemId: "sys-1",
    });
    expect(withName.success).toBe(true);
    expect(withoutName.success).toBe(true);
  });
});

// ─── Artifact type ─────────────────────────────────────────────────────

describe("systemRecordArtifactType", () => {
  it("validates the canonical artifact shape", () => {
    const ok = systemRecordArtifactType.schema.safeParse({
      systemId: "sys-1",
      systemName: "API",
      metadata: { tier: "gold" },
    });
    expect(ok.success).toBe(true);
  });

  it("rejects when metadata is missing", () => {
    const bad = systemRecordArtifactType.schema.safeParse({
      systemId: "sys-1",
      systemName: "API",
    });
    expect(bad.success).toBe(false);
  });
});

// ─── Action: system.update_metadata ────────────────────────────────────

interface FakeSystemRow {
  id: string;
  name: string;
  description?: string | null;
  metadata: Record<string, unknown> | null;
}

interface ActionFixture {
  service: EntityService;
  cache: ReturnType<typeof createCatalogCache>;
  setMock: ReturnType<typeof mock>;
  getSystemEntity: () => never;
  updateSystemMock: ReturnType<typeof mock>;
  getSystemMock: ReturnType<typeof mock>;
  invalidateTopologyMock: ReturnType<typeof mock>;
}

function makeFixture(args: {
  initialRow: FakeSystemRow | undefined;
  /**
   * If set, updateSystem returns this value instead of the merged
   * row. Use `{ value: undefined }` to simulate a race-deleted row.
   * Omit to get the default "merge + return updated row" behaviour.
   */
  updateResult?: { value: FakeSystemRow | undefined };
}): ActionFixture {
  let row = args.initialRow ? { ...args.initialRow } : undefined;
  const getSystemMock = mock(async (_id: string) => row);
  const updateSystemMock = mock(
    async (id: string, data: { metadata?: Record<string, unknown> }) => {
      if (args.updateResult) return args.updateResult.value;
      if (row) {
        row = { ...row, metadata: data.metadata ?? row.metadata };
        return row;
      }
      return undefined;
    },
  );
  const service = {
    getSystem: getSystemMock,
    updateSystem: updateSystemMock,
  } as unknown as EntityService;

  const invalidateTopologyMock = mock(async () => {});
  const cache = {
    invalidateTopology: invalidateTopologyMock,
    // Other cache methods aren't exercised by the action; cast to the
    // full shape so the factory's deps typecheck.
    invalidateContacts: mock(async () => {}),
  } as unknown as ReturnType<typeof createCatalogCache>;

  const setMock = mock(async (_id: string, _next: unknown) => {});
  const getSystemEntity = () =>
    ({ kind: "catalog-system", set: setMock }) as never;

  return {
    service,
    cache,
    setMock,
    getSystemEntity,
    updateSystemMock,
    getSystemMock,
    invalidateTopologyMock,
  };
}

describe("catalog.system.update_metadata", () => {
  it("shallow-merges by default and preserves untouched keys", async () => {
    const fx = makeFixture({
      initialRow: {
        id: "sys-1",
        name: "API",
        metadata: { tier: "gold", region: "eu-central-1" },
      },
    });
    const [action] = createCatalogActions({
      entityService: fx.service,
      cache: fx.cache,
      getSystemEntity: fx.getSystemEntity,
    });

    const result = await action!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        systemId: "sys-1",
        strategy: "merge",
        metadata: { tier: "platinum", owner: "platform" },
      } as never,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const artifact = result.artifact as {
      metadata: Record<string, unknown>;
    };
    expect(artifact.metadata).toEqual({
      tier: "platinum",
      region: "eu-central-1",
      owner: "platform",
    });

    // Service was called with the merged metadata, not the partial config.
    expect(fx.updateSystemMock).toHaveBeenCalledTimes(1);
    const updateCall = fx.updateSystemMock.mock.calls[0]!;
    expect(updateCall[0]).toBe("sys-1");
    expect((updateCall[1] as { metadata: Record<string, unknown> }).metadata)
      .toEqual({
        tier: "platinum",
        region: "eu-central-1",
        owner: "platform",
      });

    expect(fx.invalidateTopologyMock).toHaveBeenCalledTimes(1);
    // The old `systemUpdated` hook emission was replaced by mirroring the
    // edit into the reactive `catalog-system` entity (§10.4).
    expect(fx.setMock).toHaveBeenCalledTimes(1);
    const setCall = fx.setMock.mock.calls[0]!;
    expect(setCall[0]).toBe("sys-1");
    expect(setCall[1]).toEqual({
      name: "API",
      description: null,
      metadata: {
        tier: "platinum",
        region: "eu-central-1",
        owner: "platform",
      },
    });
  });

  it("replaces the whole metadata object when strategy=replace", async () => {
    const fx = makeFixture({
      initialRow: {
        id: "sys-1",
        name: "API",
        metadata: { tier: "gold", region: "eu-central-1" },
      },
    });
    const [action] = createCatalogActions({
      entityService: fx.service,
      cache: fx.cache,
      getSystemEntity: fx.getSystemEntity,
    });

    const result = await action!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        systemId: "sys-1",
        strategy: "replace",
        metadata: { owner: "platform" },
      } as never,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const artifact = result.artifact as {
      metadata: Record<string, unknown>;
    };
    expect(artifact.metadata).toEqual({ owner: "platform" });

    const updateCall = fx.updateSystemMock.mock.calls[0]!;
    expect((updateCall[1] as { metadata: Record<string, unknown> }).metadata)
      .toEqual({ owner: "platform" });
  });

  it("treats a null existing metadata as an empty object when merging", async () => {
    const fx = makeFixture({
      initialRow: {
        id: "sys-1",
        name: "API",
        metadata: null,
      },
    });
    const [action] = createCatalogActions({
      entityService: fx.service,
      cache: fx.cache,
      getSystemEntity: fx.getSystemEntity,
    });

    const result = await action!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        systemId: "sys-1",
        strategy: "merge",
        metadata: { tier: "gold" },
      } as never,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const artifact = result.artifact as {
      metadata: Record<string, unknown>;
    };
    expect(artifact.metadata).toEqual({ tier: "gold" });
  });

  it("returns failure when the target system does not exist", async () => {
    const fx = makeFixture({ initialRow: undefined });
    const [action] = createCatalogActions({
      entityService: fx.service,
      cache: fx.cache,
      getSystemEntity: fx.getSystemEntity,
    });

    const result = await action!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        systemId: "missing",
        strategy: "merge",
        metadata: { tier: "gold" },
      } as never,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/System not found/);
    expect(fx.updateSystemMock).not.toHaveBeenCalled();
    expect(fx.invalidateTopologyMock).not.toHaveBeenCalled();
    expect(fx.setMock).not.toHaveBeenCalled();
  });

  it("returns failure if updateSystem returns undefined (race-deleted mid-update)", async () => {
    const fx = makeFixture({
      initialRow: {
        id: "sys-1",
        name: "API",
        metadata: {},
      },
      // Simulate a race: getSystem found the row, but updateSystem
      // returned `undefined` (the row was deleted between the two
      // queries).
      updateResult: { value: undefined },
    });
    const [action] = createCatalogActions({
      entityService: fx.service,
      cache: fx.cache,
      getSystemEntity: fx.getSystemEntity,
    });

    const result = await action!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        systemId: "sys-1",
        strategy: "merge",
        metadata: { tier: "gold" },
      } as never,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/disappeared mid-update/);
    expect(fx.invalidateTopologyMock).not.toHaveBeenCalled();
    expect(fx.setMock).not.toHaveBeenCalled();
  });
});
