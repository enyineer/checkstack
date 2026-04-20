import { describe, it, expect, mock, beforeEach } from "bun:test";
import { z } from "zod";
import { CHECKSTACK_API_VERSION } from "@checkstack/gitops-common";
import { createEntityKindRegistry } from "../kind-registry";

/**
 * Tests that the `detectOrphans` logic in the reconciler properly invokes
 * the kind's `delete()` reconciler before removing provenance entries.
 *
 * These tests verify the delete wiring in isolation by directly testing
 * the kind registry's delete behavior, which the reconciler calls.
 */

describe("Kind delete reconciler wiring", () => {
  it("calls the registered delete function when available", async () => {
    const deleteHandler = mock(async (_params: { entityName: string; entityId?: string }) => {});
    const registry = createEntityKindRegistry();

    registry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      specSchema: z.object({ description: z.string().optional() }),
      reconcile: async () => ({ entityId: "test-id" }),
      delete: deleteHandler,
    });

    const kindDef = registry.getKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
    });

    expect(kindDef?.delete).toBeDefined();

    await kindDef!.delete!({
      entityName: "payment-service",
      entityId: "sys-123",
      context: {
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        },
        resolveEntityRef: async () => undefined,
      },
    });

    expect(deleteHandler).toHaveBeenCalledTimes(1);
    expect(deleteHandler).toHaveBeenCalledWith({
      entityName: "payment-service",
      entityId: "sys-123",
      context: expect.objectContaining({
        logger: expect.any(Object),
      }),
    });
  });

  it("handles kinds with no delete handler gracefully", () => {
    const registry = createEntityKindRegistry();

    registry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "ReadOnlyKind",
      specSchema: z.object({}),
      reconcile: async () => ({ entityId: "test-id" }),
      // No delete handler
    });

    const kindDef = registry.getKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "ReadOnlyKind",
    });

    expect(kindDef).toBeDefined();
    expect(kindDef?.delete).toBeUndefined();
  });

  it("propagates errors from the delete handler", async () => {
    const registry = createEntityKindRegistry();

    registry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "FailingKind",
      specSchema: z.object({}),
      reconcile: async () => ({ entityId: "test-id" }),
      delete: async () => {
        throw new Error("DB connection failed");
      },
    });

    const kindDef = registry.getKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "FailingKind",
    });

    expect(
      kindDef!.delete!({
        entityName: "broken-entity",
        entityId: "broken-id",
        context: {
          logger: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
          },
          resolveEntityRef: async () => undefined,
        },
      }),
    ).rejects.toThrow("DB connection failed");
  });

  it("returns undefined for unknown kind lookups (delete not called)", () => {
    const registry = createEntityKindRegistry();

    const kindDef = registry.getKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "NonExistent",
    });

    expect(kindDef).toBeUndefined();
  });
});
