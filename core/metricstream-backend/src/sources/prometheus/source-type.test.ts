import { describe, it, expect } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import {
  EMPTY_MASKING_CONTEXT,
  type SecretResolverService,
} from "@checkstack/secrets-backend";
import type {
  BoundTelemetrySink,
  TelemetryPullContext,
} from "@checkstack/telemetry-backend";
import type {
  NormalizedMetricPoint,
  SourceBinding,
} from "@checkstack/telemetry-common";
import type {
  ImportantEvent,
  RecordImportantEventInput,
} from "@checkstack/metricstream-common";
import type { ImportantEventRecorder } from "../../events/recorder";
import {
  createPrometheusScrapeSourceType,
  executePrometheusPull,
  DEFAULT_SCRAPE_MAX_BYTES,
  PrometheusScrapeConfigSchema,
  SCRAPE_FAILING_THRESHOLD,
  type PrometheusScrapeConfig,
} from "./source-type";

/** A sink that records every emitted metric point (only "metrics" is bound). */
function recordingSink(): {
  sink: BoundTelemetrySink;
  emitted: NormalizedMetricPoint[];
} {
  const emitted: NormalizedMetricPoint[] = [];
  const sink: BoundTelemetrySink = {
    boundSignals: ["metrics"],
    emit: async (signal, records) => {
      if (signal === "metrics") {
        emitted.push(...(records as NormalizedMetricPoint[]));
      }
      return { accepted: records.length, rejected: 0, bound: true };
    },
  };
  return { sink, emitted };
}

/** A secret resolver that echoes the env back (identity), for `${{ }}` tests. */
const echoResolver: Pick<SecretResolverService, "resolveForRun"> = {
  resolveForRun: async ({ secretEnv }) => ({
    env: secretEnv ?? {},
    masking: EMPTY_MASKING_CONTEXT,
  }),
};

/** A resolver that maps ANY reference to a fixed plaintext. */
function fixedResolver(value: string): Pick<SecretResolverService, "resolveForRun"> {
  return {
    resolveForRun: async ({ secretEnv }) => {
      const env: Record<string, string> = {};
      for (const key of Object.keys(secretEnv ?? {})) env[key] = value;
      return { env, masking: EMPTY_MASKING_CONTEXT };
    },
  };
}

function buildCtx({
  config,
  fetchImpl,
}: {
  config: PrometheusScrapeConfig;
  fetchImpl: typeof fetch;
}): TelemetryPullContext<PrometheusScrapeConfig> {
  return {
    config,
    sink: recordingSink().sink,
    fetch: fetchImpl,
    logger: createMockLogger(),
    abortSignal: new AbortController().signal,
  };
}

const PROM_BODY = [
  "# TYPE http_requests_total counter",
  'http_requests_total{method="get"} 1200',
  'http_requests_total{method="post"} 42',
  "# TYPE inflight gauge",
  "inflight 7",
].join("\n");

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

describe("executePrometheusPull", () => {
  it("parses the exposition and emits mapped metric points (ISO-safe Date ts)", async () => {
    const { sink, emitted } = recordingSink();
    const fetchImpl = (async () => textResponse(PROM_BODY)) as unknown as typeof fetch;
    const ctx: TelemetryPullContext<PrometheusScrapeConfig> = {
      config: { url: "https://target.example/metrics", timeoutMs: 5000 },
      sink,
      fetch: fetchImpl,
      logger: createMockLogger(),
      abortSignal: new AbortController().signal,
    };

    await executePrometheusPull({ ctx, secretResolver: echoResolver });

    expect(emitted).toHaveLength(3);
    const counter = emitted.find(
      (p) => p.name === "http_requests_total" && p.labels.method === "get",
    );
    expect(counter?.type).toBe("counter");
    expect(counter?.counterKind).toBe("cumulative");
    expect(counter?.value).toBe(1200);
    const gauge = emitted.find((p) => p.name === "inflight");
    expect(gauge?.type).toBe("gauge");
    expect(gauge?.ts).toBeInstanceOf(Date);
  });

  it("sends a plaintext bearer token as an Authorization header", async () => {
    const seen: { auth: string | null } = { auth: null };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.auth = new Headers(init.headers).get("authorization");
      return textResponse("# TYPE up gauge\nup 1");
    }) as unknown as typeof fetch;

    await executePrometheusPull({
      ctx: buildCtx({
        config: {
          url: "https://target.example/metrics",
          timeoutMs: 5000,
          bearerToken: "plain-token",
        },
        fetchImpl,
      }),
      secretResolver: echoResolver,
    });
    expect(seen.auth).toBe("Bearer plain-token");
  });

  it("resolves a `${{ secrets.NAME }}` bearer reference before sending it", async () => {
    const seen: { auth: string | null } = { auth: null };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.auth = new Headers(init.headers).get("authorization");
      return textResponse("# TYPE up gauge\nup 1");
    }) as unknown as typeof fetch;

    await executePrometheusPull({
      ctx: buildCtx({
        config: {
          url: "https://target.example/metrics",
          timeoutMs: 5000,
          bearerToken: "${{ secrets.PROM_TOKEN }}",
        },
        fetchImpl,
      }),
      secretResolver: fixedResolver("resolved-secret"),
    });
    expect(seen.auth).toBe("Bearer resolved-secret");
  });

  it("throws on a non-2xx response (transport failure)", async () => {
    const fetchImpl = (async () => textResponse("nope", 503)) as unknown as typeof fetch;
    await expect(
      executePrometheusPull({
        ctx: buildCtx({
          config: { url: "https://target.example/metrics", timeoutMs: 5000 },
          fetchImpl,
        }),
        secretResolver: echoResolver,
      }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("throws when the fetch itself rejects (connect failure)", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(
      executePrometheusPull({
        ctx: buildCtx({
          config: { url: "https://target.example/metrics", timeoutMs: 5000 },
          fetchImpl,
        }),
        secretResolver: echoResolver,
      }),
    ).rejects.toThrow(/scrape request failed/);
  });

  it("rejects a non-http(s) URL scheme at the run guard", async () => {
    const fetchImpl = (async () => textResponse("")) as unknown as typeof fetch;
    await expect(
      executePrometheusPull({
        ctx: buildCtx({
          config: { url: "ftp://target.example/metrics", timeoutMs: 5000 },
          fetchImpl,
        }),
        secretResolver: echoResolver,
      }),
    ).rejects.toThrow(/scheme not allowed/);
  });

  it("a 2xx scrape exposing zero series is a success (no emit)", async () => {
    const { sink, emitted } = recordingSink();
    const fetchImpl = (async () => textResponse("")) as unknown as typeof fetch;
    await executePrometheusPull({
      ctx: {
        config: { url: "https://target.example/metrics", timeoutMs: 5000 },
        sink,
        fetch: fetchImpl,
        logger: createMockLogger(),
        abortSignal: new AbortController().signal,
      },
      secretResolver: echoResolver,
    });
    expect(emitted).toHaveLength(0);
  });

  it("rejects a body over the size cap (declared content-length)", async () => {
    const fetchImpl = (async () =>
      new Response("x", {
        status: 200,
        headers: {
          "content-type": "text/plain",
          "content-length": String(DEFAULT_SCRAPE_MAX_BYTES + 1),
        },
      })) as unknown as typeof fetch;
    await expect(
      executePrometheusPull({
        ctx: buildCtx({
          config: { url: "https://target.example/metrics", timeoutMs: 5000 },
          fetchImpl,
        }),
        secretResolver: echoResolver,
      }),
    ).rejects.toThrow(/exceeds cap/);
  });

  it("caps the scrape to maxSeries distinct series", async () => {
    const { sink, emitted } = recordingSink();
    const body = `# TYPE g gauge\ng{h="a"} 1\ng{h="b"} 2\ng{h="c"} 3`;
    const fetchImpl = (async () => textResponse(body)) as unknown as typeof fetch;
    await executePrometheusPull({
      ctx: {
        config: { url: "https://target.example/metrics", timeoutMs: 5000 },
        sink,
        fetch: fetchImpl,
        logger: createMockLogger(),
        abortSignal: new AbortController().signal,
      },
      secretResolver: echoResolver,
      maxSeries: 2,
    });
    expect(emitted).toHaveLength(2);
  });
});

describe("PrometheusScrapeConfigSchema", () => {
  it("describes every config field for the editor", () => {
    const { shape } = PrometheusScrapeConfigSchema;
    expect(shape.url.description).toBeTruthy();
    expect(shape.timeoutMs.description).toBeTruthy();
    expect(shape.bearerToken.description).toBeTruthy();
  });
});

describe("prometheus-scrape onRunFailure (scrape_failing event)", () => {
  function fakeRecorder(): {
    recorder: ImportantEventRecorder;
    records: RecordImportantEventInput[];
  } {
    const records: RecordImportantEventInput[] = [];
    const recorder: ImportantEventRecorder = {
      record: async (input) => {
        records.push(input);
        const event: ImportantEvent = {
          id: "evt-1",
          streamId: input.streamId,
          ts: input.ts,
          type: input.type,
          title: input.title,
          detail: input.detail ?? null,
          createdAt: input.ts,
        };
        return event;
      },
    };
    return { recorder, records };
  }

  const metricsBinding: SourceBinding[] = [
    { signal: "metrics", streamId: "stream-9" },
  ];
  const failArgs = {
    sourceId: "src-1",
    sourceName: "prod",
    config: { url: "https://t/metrics", timeoutMs: 5000 },
    error: "scrape returned HTTP 503",
  };

  it("records the event exactly on the threshold crossing, on the bound metrics stream", async () => {
    const { recorder, records } = fakeRecorder();
    const sourceType = createPrometheusScrapeSourceType({
      secretResolver: echoResolver,
      recorder,
    });
    await sourceType.pull!.onRunFailure!({
      ...failArgs,
      consecutiveFailures: SCRAPE_FAILING_THRESHOLD,
      bindings: metricsBinding,
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      streamId: "stream-9",
      type: "scrape_failing",
      title: 'Scrape target "prod" is failing',
      detail: {
        sourceId: "src-1",
        consecutiveFailures: SCRAPE_FAILING_THRESHOLD,
        lastError: "scrape returned HTTP 503",
      },
    });
  });

  it("does NOT record below or above the threshold (once per outage episode)", async () => {
    const { recorder, records } = fakeRecorder();
    const sourceType = createPrometheusScrapeSourceType({
      secretResolver: echoResolver,
      recorder,
    });
    for (const consecutiveFailures of [
      SCRAPE_FAILING_THRESHOLD - 1,
      SCRAPE_FAILING_THRESHOLD + 1,
    ]) {
      await sourceType.pull!.onRunFailure!({
        ...failArgs,
        consecutiveFailures,
        bindings: metricsBinding,
      });
    }
    expect(records).toHaveLength(0);
  });

  it("is a silent no-op when the source has no metrics binding", async () => {
    const { recorder, records } = fakeRecorder();
    const sourceType = createPrometheusScrapeSourceType({
      secretResolver: echoResolver,
      recorder,
    });
    await sourceType.pull!.onRunFailure!({
      ...failArgs,
      consecutiveFailures: SCRAPE_FAILING_THRESHOLD,
      bindings: [{ signal: "logs", streamId: "logs-1" }],
    });
    await sourceType.pull!.onRunFailure!({
      ...failArgs,
      consecutiveFailures: SCRAPE_FAILING_THRESHOLD,
      bindings: [],
    });
    expect(records).toHaveLength(0);
  });

  it("does not implement onRunRecovery (parity with the old reconciler)", () => {
    const { recorder } = fakeRecorder();
    const sourceType = createPrometheusScrapeSourceType({
      secretResolver: echoResolver,
      recorder,
    });
    expect(sourceType.pull!.onRunRecovery).toBeUndefined();
  });
});
