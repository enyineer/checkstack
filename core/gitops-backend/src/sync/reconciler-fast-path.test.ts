import { describe, it, expect, mock } from "bun:test";
import { reconcileProvider } from "./reconciler";
import { createEntityKindRegistry } from "../kind-registry";
import { CHECKSTACK_API_VERSION } from "@checkstack/gitops-common";
import { z } from "zod";
import { computeHash } from "./document-parser";

const DUMMY_YAML = `apiVersion: ${CHECKSTACK_API_VERSION}
kind: TestKind
metadata:
  name: test-entity
spec: {}`;

describe("GitOps reconciler fast-path retry logic", () => {
  it("skips reconciliation if file hash matches and status is synced", async () => {
    const hash = computeHash({ input: DUMMY_YAML });
    let whereCalls = 0;
    
    const mockDb = {
      select: () => mockDb,
      from: () => mockDb,
      where: async () => {
        whereCalls++;
        if (whereCalls === 1) { // existingProvenance lookup
          return [{
            id: "prov-1",
            status: "synced",
            lastSyncHash: hash,
            entityId: "real-id"
          }];
        }
        return [];
      },
      update: () => mockDb,
      set: () => mockDb,
      insert: () => mockDb,
      values: async () => [],
      delete: () => mockDb,
    } as any;

    const kindRegistry = createEntityKindRegistry();
    const reconcileMock = mock(async () => ({ entityId: "new-id" }));
    kindRegistry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "TestKind",
      specSchema: z.object({}),
      reconcile: reconcileMock,
    });

    const result = await reconcileProvider({
      providerId: "test-provider",
      providerType: "github",
      target: "test-target",
      pathPattern: "*.yaml",
      deletionPolicy: "orphan",
      db: mockDb,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any,
      kindRegistry,
      secretStore: { resolve: async () => {} } as any,
      scraper: {
        discoverFiles: async () => [{
          repository: "repo",
          filePath: "test.yaml",
          branch: "main",
          content: DUMMY_YAML,
        }],
      },
    });

    // Should skip because hash matches and status is synced
    expect(result.unchanged).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.created).toBe(0);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("retries reconciliation if file hash matches but status is error", async () => {
    const hash = computeHash({ input: DUMMY_YAML });
    let whereCalls = 0;
    
    const mockDb = {
      select: () => mockDb,
      from: () => mockDb,
      where: async () => {
        whereCalls++;
        if (whereCalls === 1) { // existingProvenance lookup
          return [{
            id: "prov-1",
            status: "error",
            lastSyncHash: hash,
            entityId: "pending-123"
          }];
        }
        return [];
      },
      update: () => mockDb,
      set: () => mockDb,
      insert: () => mockDb,
      values: async () => [],
      delete: () => mockDb,
    } as any;

    const kindRegistry = createEntityKindRegistry();
    const reconcileMock = mock(async () => ({ entityId: "new-id" }));
    kindRegistry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "TestKind",
      specSchema: z.object({}),
      reconcile: reconcileMock,
    });

    const result = await reconcileProvider({
      providerId: "test-provider",
      providerType: "github",
      target: "test-target",
      pathPattern: "*.yaml",
      deletionPolicy: "orphan",
      db: mockDb,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any,
      kindRegistry,
      secretStore: { resolve: async () => {} } as any,
      scraper: {
        discoverFiles: async () => [{
          repository: "repo",
          filePath: "test.yaml",
          branch: "main",
          content: DUMMY_YAML,
        }],
      },
    });

    // Should retry because status is error, even if hash matches
    expect(result.unchanged).toBe(0);
    expect(result.updated).toBe(1);
    expect(reconcileMock).toHaveBeenCalledTimes(1);
  });
});
