import { describe, it, expect } from "bun:test";
import type { Logger } from "@checkstack/common";
import type {
  BoundTelemetrySink,
  TelemetryEmitResult,
} from "@checkstack/telemetry-backend";
import type { TelemetryRecord } from "@checkstack/telemetry-common";
import { k8sEventsConfigSchema } from "@checkstack/k8s-events-common";
import { k8sEventsSourceType } from "./index";

// The platform `execute` uses real wall-clock time (no `now` injection), so the
// event must be recent relative to actual now to fall inside the default window.
const RECENT_ISO = new Date(Date.now() - 5_000).toISOString();

const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

function fakeSink(): {
  sink: BoundTelemetrySink;
  emits: Array<{ signal: string; records: readonly unknown[] }>;
} {
  const emits: Array<{ signal: string; records: readonly unknown[] }> = [];
  const sink: BoundTelemetrySink = {
    boundSignals: ["logs"],
    async emit<S extends "logs" | "metrics" | "traces">(
      signal: S,
      records: TelemetryRecord<S>[],
    ): Promise<TelemetryEmitResult> {
      emits.push({ signal, records });
      return { bound: true, accepted: records.length, rejected: 0 };
    },
  };
  return { sink, emits };
}

/** Wrap a bare handler as a `fetch` test double (adds the unused preconnect). */
function asFetch(
  fn: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
): typeof fetch {
  return Object.assign(fn, { preconnect: () => {} });
}

function eventsResponse(items: unknown[]): typeof fetch {
  return asFetch(async () =>
    new Response(
      JSON.stringify({
        kind: "EventList",
        apiVersion: "events.k8s.io/v1",
        metadata: {},
        items,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

const config = k8sEventsConfigSchema.parse({
  apiServerUrl: "https://k8s.example:6443",
  bearerToken: "tok",
});

describe("k8sEventsSourceType definition", () => {
  it("declares a satellite-capable logs pull source", () => {
    expect(k8sEventsSourceType.id).toBe("k8s-events");
    expect(k8sEventsSourceType.signals).toEqual(["logs"]);
    expect(k8sEventsSourceType.supportsSatellite).toBe(true);
    expect(k8sEventsSourceType.pull?.defaultIntervalSeconds).toBe(60);
    expect(k8sEventsSourceType.pull?.minIntervalSeconds).toBe(15);
  });
});

describe("k8sEventsSourceType.pull.execute", () => {
  it("emits mapped log records to the logs sink", async () => {
    const { sink, emits } = fakeSink();
    await k8sEventsSourceType.pull?.execute({
      config,
      sink,
      fetch: eventsResponse([
        {
          metadata: { uid: "u1", namespace: "prod" },
          eventTime: RECENT_ISO,
          type: "Warning",
          reason: "BackOff",
          note: "boom",
          regarding: { kind: "Pod", name: "web-0" },
        },
      ]),
      logger: noopLogger,
      abortSignal: new AbortController().signal,
    });

    expect(emits).toHaveLength(1);
    expect(emits[0]!.signal).toBe("logs");
    expect(emits[0]!.records).toHaveLength(1);
  });

  it("does not emit when the window yields no records", async () => {
    const { sink, emits } = fakeSink();
    await k8sEventsSourceType.pull?.execute({
      config,
      sink,
      fetch: eventsResponse([]),
      logger: noopLogger,
      abortSignal: new AbortController().signal,
    });
    expect(emits).toHaveLength(0);
  });

  it("propagates a transport failure (non-2xx throws)", async () => {
    const { sink } = fakeSink();
    const failing = asFetch(async () =>
      new Response("no", { status: 500, statusText: "Server Error" }),
    );
    await expect(
      k8sEventsSourceType.pull?.execute({
        config,
        sink,
        fetch: failing,
        logger: noopLogger,
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toThrow(/HTTP 500/);
  });
});
