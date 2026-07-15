import { describe, it, expect, mock } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type {
  AdvisoryLockService,
  RpcClient,
} from "@checkstack/backend-api";
import type { InternalSecretsService } from "@checkstack/secrets-backend";
import { configSecretMarker } from "@checkstack/secrets-common";
import { rekeyMigratedScrapeBearers } from "./rekey";
import {
  PROMETHEUS_SCRAPE_QUALIFIED_ID,
} from "./source-type";
import { METRICSTREAM_SECRET_MARKER_PREFIX } from "../../secrets/scrape-target-secret";

/** A source row as the telemetry read DTO exposes it (config carries markers). */
type StubSource = { id: string; config: Record<string, unknown> };

function buildDeps({
  sources,
  storedSecrets,
  lockAcquired = true,
}: {
  sources: StubSource[];
  storedSecrets: Record<string, string>;
  lockAcquired?: boolean;
}) {
  const updateCalls: { id: string; bearerToken: unknown }[] = [];
  const listSources = mock(async () => ({ sources }));
  const updateSource = mock(
    async ({ id, body }: { id: string; body: { config?: Record<string, unknown> } }) => {
      updateCalls.push({ id, bearerToken: body.config?.bearerToken });
      return {};
    },
  );
  const rpcClient = {
    forPlugin: () => ({ listSources, updateSource }),
  } as unknown as RpcClient;

  const deletedKeys: string[] = [];
  const internalSecrets = {
    get: async ({ parts }: { parts: string[] }) =>
      storedSecrets[parts.join("/")],
    delete: async ({ parts }: { parts: string[] }) => {
      deletedKeys.push(parts.join("/"));
    },
  } as unknown as InternalSecretsService;

  const release = mock(async () => {});
  const advisoryLock = {
    tryAcquire: mock(async () => (lockAcquired ? { release } : null)),
  } as unknown as AdvisoryLockService;

  return {
    rpcClient,
    internalSecrets,
    advisoryLock,
    logger: createMockLogger(),
    listSources,
    updateSource,
    updateCalls,
    deletedKeys,
    release,
  };
}

/** Internal-secret key for a target's bearer (mirrors scrapeBearerKeyParts). */
const bearerKey = (id: string) =>
  ["metricstream", "scrape-target", id, "bearerToken"].join("/");

describe("rekeyMigratedScrapeBearers", () => {
  it("re-keys a metricstream inline-secret marker to the resolved plaintext", async () => {
    const deps = buildDeps({
      sources: [
        {
          id: "src-1",
          config: {
            url: "https://a/metrics",
            timeoutMs: 10_000,
            bearerToken: configSecretMarker(
              METRICSTREAM_SECRET_MARKER_PREFIX,
              "src-1",
            ),
          },
        },
      ],
      storedSecrets: { [bearerKey("src-1")]: "the-plaintext" },
    });

    await rekeyMigratedScrapeBearers(deps);

    expect(deps.updateCalls).toEqual([
      { id: "src-1", bearerToken: "the-plaintext" },
    ]);
    // After the successful re-key the orphaned metricstream internal secret is
    // deleted, so nothing survives the dropped legacy table.
    expect(deps.deletedKeys).toEqual([bearerKey("src-1")]);
    expect(deps.release).toHaveBeenCalledTimes(1);
  });

  it("does NOT delete the internal secret when there was nothing to re-key", async () => {
    const deps = buildDeps({
      sources: [
        {
          id: "src-ref",
          config: { url: "https://a/metrics", bearerToken: "${{ secrets.PROM }}" },
        },
      ],
      storedSecrets: {},
    });

    await rekeyMigratedScrapeBearers(deps);
    expect(deps.updateCalls).toHaveLength(0);
    expect(deps.deletedKeys).toEqual([]);
  });

  it("leaves a `${{ secrets.NAME }}` reference untouched", async () => {
    const deps = buildDeps({
      sources: [
        {
          id: "src-ref",
          config: {
            url: "https://a/metrics",
            bearerToken: "${{ secrets.PROM }}",
          },
        },
      ],
      storedSecrets: {},
    });

    await rekeyMigratedScrapeBearers(deps);
    expect(deps.updateCalls).toHaveLength(0);
  });

  it("is a no-op for an already-migrated source (no bearer marker on read)", async () => {
    const deps = buildDeps({
      sources: [
        { id: "src-plain", config: { url: "https://a/metrics" } },
      ],
      storedSecrets: {},
    });

    await rekeyMigratedScrapeBearers(deps);
    expect(deps.updateCalls).toHaveLength(0);
  });

  it("skips a marker whose stored secret is missing (leaves it for a retry)", async () => {
    const deps = buildDeps({
      sources: [
        {
          id: "src-orphan",
          config: {
            bearerToken: configSecretMarker(
              METRICSTREAM_SECRET_MARKER_PREFIX,
              "src-orphan",
            ),
          },
        },
      ],
      storedSecrets: {},
    });

    await rekeyMigratedScrapeBearers(deps);
    expect(deps.updateCalls).toHaveLength(0);
  });

  it("does nothing when the advisory lock is already held by another pod", async () => {
    const deps = buildDeps({
      sources: [
        {
          id: "src-1",
          config: {
            bearerToken: configSecretMarker(
              METRICSTREAM_SECRET_MARKER_PREFIX,
              "src-1",
            ),
          },
        },
      ],
      storedSecrets: { [bearerKey("src-1")]: "x" },
      lockAcquired: false,
    });

    await rekeyMigratedScrapeBearers(deps);
    expect(deps.listSources).not.toHaveBeenCalled();
    expect(deps.updateCalls).toHaveLength(0);
  });

  it("isolates a failing source: a rejected updateSource still re-keys the rest", async () => {
    const marker = (id: string) =>
      configSecretMarker(METRICSTREAM_SECRET_MARKER_PREFIX, id);
    const sources: StubSource[] = [
      { id: "src-1", config: { url: "https://a/metrics", bearerToken: marker("src-1") } },
      { id: "src-2", config: { url: "https://b/metrics", bearerToken: marker("src-2") } },
      { id: "src-3", config: { url: "https://c/metrics", bearerToken: marker("src-3") } },
    ];
    const rekeyed: string[] = [];
    const listSources = mock(async () => ({ sources }));
    const updateSource = mock(
      async ({ id }: { id: string; body: { config?: Record<string, unknown> } }) => {
        // The middle source is rejected (e.g. a config the current schema no
        // longer accepts); it must not abort re-keying the later sources.
        if (id === "src-2") throw new Error("schema rejected");
        rekeyed.push(id);
        return {};
      },
    );
    const rpcClient = {
      forPlugin: () => ({ listSources, updateSource }),
    } as unknown as RpcClient;
    const internalSecrets = {
      get: async ({ parts }: { parts: string[] }) => `plain-${parts[2]}`,
    } as unknown as InternalSecretsService;
    const release = mock(async () => {});
    const advisoryLock = {
      tryAcquire: mock(async () => ({ release })),
    } as unknown as AdvisoryLockService;

    await rekeyMigratedScrapeBearers({
      rpcClient,
      internalSecrets,
      advisoryLock,
      logger: createMockLogger(),
    });

    expect(rekeyed).toEqual(["src-1", "src-3"]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("only lists the prometheus-scrape source type", async () => {
    const deps = buildDeps({ sources: [], storedSecrets: {} });
    await rekeyMigratedScrapeBearers(deps);
    expect(deps.listSources).toHaveBeenCalledWith({
      sourceTypeId: PROMETHEUS_SCRAPE_QUALIFIED_ID,
    });
  });
});
