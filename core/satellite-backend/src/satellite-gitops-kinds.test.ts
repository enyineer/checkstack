import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  CHECKSTACK_API_VERSION,
  type ReconcileContext,
} from "@checkstack/gitops-common";
import type { SatelliteWithStatus } from "@checkstack/satellite-common";
import type { SatelliteService } from "./service";
import { buildSatelliteKind } from "./satellite-gitops-kinds";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const buildContext = (
  overrides: Partial<ReconcileContext> = {},
): ReconcileContext =>
  ({
    logger: noopLogger,
    resolveEntityRef: async () => undefined,
    resolveSecretsBySchema: async ({ value }) => ({
      resolved: value,
      warnings: [],
    }),
    ...overrides,
  }) as ReconcileContext;

const stubService = (initial?: SatelliteWithStatus | undefined) => {
  let stored = initial;
  const getSatellite = mock(async (id: string) =>
    stored && stored.id === id ? stored : undefined,
  );
  const getSatelliteByName = mock(async (name: string) =>
    stored && stored.name === name ? stored : undefined,
  );
  const createSatellite = mock(
    async (props: {
      name: string;
      region: string;
      tags: Record<string, string>;
    }) => {
      const satellite: SatelliteWithStatus = {
        id: "sat-new",
        name: props.name,
        region: props.region,
        tags: props.tags,
        capabilities: [],
        createdAt: new Date(),
        status: "offline",
      };
      stored = satellite;
      return { satellite, plaintextToken: "csat_test-token" };
    },
  );
  const updateSatelliteMetadata = mock(
    async (props: {
      id: string;
      name?: string;
      region?: string;
      tags?: Record<string, string>;
    }) => {
      if (!stored || stored.id !== props.id) return undefined;
      stored = {
        ...stored,
        name: props.name ?? stored.name,
        region: props.region ?? stored.region,
        tags: props.tags ?? stored.tags,
      };
      return stored;
    },
  );
  const deleteSatellite = mock(async (id: string) => {
    if (stored && stored.id === id) stored = undefined;
  });
  return {
    getSatellite,
    getSatelliteByName,
    createSatellite,
    updateSatelliteMetadata,
    deleteSatellite,
    service: {
      getSatellite,
      getSatelliteByName,
      createSatellite,
      updateSatelliteMetadata,
      deleteSatellite,
    } as unknown as SatelliteService,
    get current() {
      return stored;
    },
  };
};

const mkEntity = (
  name: string,
  spec: { region: string },
  metadataExtras: { labels?: Record<string, string> } = {},
) => ({
  apiVersion: CHECKSTACK_API_VERSION,
  kind: "Satellite",
  metadata: { name, ...metadataExtras },
  spec,
});

describe("buildSatelliteKind", () => {
  let kind: ReturnType<typeof buildSatelliteKind>;
  let stub: ReturnType<typeof stubService>;

  beforeEach(() => {
    stub = stubService();
    kind = buildSatelliteKind({ getService: () => stub.service });
  });

  it("registers as Satellite kind", () => {
    expect(kind.kind).toBe("Satellite");
  });

  it("creates a satellite when none exists, discarding the plaintext token", async () => {
    const result = await kind.reconcile({
      entity: mkEntity(
        "eu-west-1",
        { region: "eu-west-1" },
        { labels: { tier: "prod" } },
      ),
      context: buildContext(),
    });

    expect(stub.createSatellite).toHaveBeenCalledTimes(1);
    expect(stub.createSatellite).toHaveBeenCalledWith({
      name: "eu-west-1",
      region: "eu-west-1",
      tags: { tier: "prod" },
    });
    expect(result.entityId).toBe("sat-new");
  });

  it("adopts an existing satellite by name on first sync", async () => {
    const existing: SatelliteWithStatus = {
      id: "sat-existing",
      name: "eu-west-1",
      region: "eu-west-1",
      tags: {},
      capabilities: [],
      createdAt: new Date(),
      status: "online",
    };
    stub = stubService(existing);
    kind = buildSatelliteKind({ getService: () => stub.service });

    const result = await kind.reconcile({
      entity: mkEntity(
        "eu-west-1",
        { region: "eu-west-2" },
        { labels: { tier: "prod" } },
      ),
      context: buildContext(),
    });

    expect(stub.createSatellite).not.toHaveBeenCalled();
    expect(stub.updateSatelliteMetadata).toHaveBeenCalledWith({
      id: "sat-existing",
      name: "eu-west-1",
      region: "eu-west-2",
      tags: { tier: "prod" },
    });
    expect(result.entityId).toBe("sat-existing");
  });

  it("uses the provenance entityId hint when provided", async () => {
    const existing: SatelliteWithStatus = {
      id: "sat-known",
      name: "renamed",
      region: "eu-west-1",
      tags: {},
      capabilities: [],
      createdAt: new Date(),
      status: "online",
    };
    stub = stubService(existing);
    kind = buildSatelliteKind({ getService: () => stub.service });

    const result = await kind.reconcile({
      entity: mkEntity("renamed", { region: "eu-west-1" }),
      existingEntityId: "sat-known",
      context: buildContext(),
    });

    expect(stub.getSatellite).toHaveBeenCalledWith("sat-known");
    expect(stub.getSatelliteByName).not.toHaveBeenCalled();
    expect(result.entityId).toBe("sat-known");
  });

  it("treats pending-* entityIds as fresh and falls back to name lookup", async () => {
    const existing: SatelliteWithStatus = {
      id: "sat-existing",
      name: "eu-west-1",
      region: "eu-west-1",
      tags: {},
      capabilities: [],
      createdAt: new Date(),
      status: "online",
    };
    stub = stubService(existing);
    kind = buildSatelliteKind({ getService: () => stub.service });

    await kind.reconcile({
      entity: mkEntity("eu-west-1", { region: "eu-west-1" }),
      existingEntityId: "pending-foo",
      context: buildContext(),
    });

    expect(stub.getSatellite).not.toHaveBeenCalledWith("pending-foo");
    expect(stub.getSatelliteByName).toHaveBeenCalledWith("eu-west-1");
  });

  it("normalizes missing metadata.labels to an empty tags object", async () => {
    await kind.reconcile({
      entity: mkEntity("eu-west-1", { region: "eu-west-1" }),
      context: buildContext(),
    });
    expect(stub.createSatellite).toHaveBeenCalledWith({
      name: "eu-west-1",
      region: "eu-west-1",
      tags: {},
    });
  });

  it("delegates delete to the service", async () => {
    await kind.delete!({
      entityName: "eu-west-1",
      entityId: "sat-1",
      context: buildContext(),
    });
    expect(stub.deleteSatellite).toHaveBeenCalledWith("sat-1");
  });

  it("delete is a no-op without entityId", async () => {
    await kind.delete!({ entityName: "x", context: buildContext() });
    expect(stub.deleteSatellite).not.toHaveBeenCalled();
  });
});
