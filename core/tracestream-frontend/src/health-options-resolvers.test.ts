import { describe, expect, it } from "bun:test";
import type { ConfigOptionsResolverContext } from "@checkstack/healthcheck-frontend";
import {
  TRACESTREAM_STREAM_OPTIONS_RESOLVER,
  TRACESTREAM_SERVICE_OPTIONS_RESOLVER,
  TRACESTREAM_OPERATION_OPTIONS_RESOLVER,
  type ListOperationsResult,
  type ListServicesResult,
  type StreamForPicker,
  type TraceOperationInfo,
  type TraceServiceInfo,
} from "@checkstack/tracestream-common";
import {
  buildTracestreamOptionsResolvers,
  operationToOption,
  readCollectorServiceName,
  readSelectedStreamId,
  serviceToOption,
  streamToOption,
} from "./health-options-resolvers";

// The factory only calls forPlugin(TracestreamApi) and the three procedures
// stubbed below, so a minimal typed client suffices for the resolver tests.
interface StubClient {
  listStreamsForPicker: () => Promise<StreamForPicker[]>;
  listServices: (input: { streamId: string }) => Promise<ListServicesResult>;
  listOperations: (input: {
    streamId: string;
    serviceName: string;
  }) => Promise<ListOperationsResult>;
}

function makeCtx({
  strategyConfig = {},
  client,
}: {
  strategyConfig?: Record<string, unknown>;
  client: Partial<StubClient>;
}): ConfigOptionsResolverContext {
  return {
    strategyConfig,
    // `as never` mirrors the sibling registry test: the generated client type is
    // not worth reconstructing, and the factory only touches the stubbed procs.
    rpcApi: { client: undefined, forPlugin: () => client } as never,
  };
}

const service = (over: Partial<TraceServiceInfo> = {}): TraceServiceInfo => ({
  serviceName: "checkout",
  operationCount: 3,
  lastSeenAt: new Date(),
  ...over,
});

const operation = (
  over: Partial<TraceOperationInfo> = {},
): TraceOperationInfo => ({
  spanName: "POST /pay",
  kind: "server",
  lastSeenAt: new Date(),
  ...over,
});

describe("streamToOption", () => {
  it("maps id to value and name to label", () => {
    const stream: StreamForPicker = { id: "s1", name: "prod-traces" };
    expect(streamToOption(stream)).toEqual({
      value: "s1",
      label: "prod-traces",
    });
  });
});

describe("serviceToOption", () => {
  it("uses the service name for both value and label", () => {
    expect(serviceToOption(service({ serviceName: "cart" }))).toEqual({
      value: "cart",
      label: "cart",
    });
  });
});

describe("operationToOption", () => {
  it("uses the span name for both value and label", () => {
    expect(operationToOption(operation({ spanName: "GET /health" }))).toEqual({
      value: "GET /health",
      label: "GET /health",
    });
  });
});

describe("readSelectedStreamId", () => {
  it("returns the streamId when a non-empty string is present", () => {
    expect(readSelectedStreamId({ streamId: "s1" })).toBe("s1");
  });

  it("returns undefined for an empty, missing, or non-string streamId", () => {
    expect(readSelectedStreamId({ streamId: "" })).toBeUndefined();
    expect(readSelectedStreamId({})).toBeUndefined();
    expect(readSelectedStreamId({ streamId: 42 })).toBeUndefined();
  });
});

describe("readCollectorServiceName", () => {
  it("returns the serviceName from the collector's own form values", () => {
    expect(readCollectorServiceName({ serviceName: "cart" })).toBe("cart");
  });

  it("returns undefined for an empty, missing, or non-string serviceName", () => {
    expect(readCollectorServiceName({ serviceName: "" })).toBeUndefined();
    expect(readCollectorServiceName({})).toBeUndefined();
    expect(readCollectorServiceName({ serviceName: 7 })).toBeUndefined();
  });
});

describe("buildTracestreamOptionsResolvers", () => {
  it("maps the stream picker options from listStreamsForPicker", async () => {
    const resolvers = buildTracestreamOptionsResolvers(
      makeCtx({
        client: {
          listStreamsForPicker: async () => [
            { id: "s1", name: "prod" },
            { id: "s2", name: "staging" },
          ],
        },
      }),
    );
    const options =
      await resolvers[TRACESTREAM_STREAM_OPTIONS_RESOLVER]({});
    expect(options).toEqual([
      { value: "s1", label: "prod" },
      { value: "s2", label: "staging" },
    ]);
  });

  it("returns [] for the service resolver when no stream is selected", async () => {
    const listServices = async (): Promise<ListServicesResult> => {
      throw new Error("listServices should not be called without a stream");
    };
    const resolvers = buildTracestreamOptionsResolvers(
      makeCtx({ strategyConfig: {}, client: { listServices } }),
    );
    expect(await resolvers[TRACESTREAM_SERVICE_OPTIONS_RESOLVER]({})).toEqual([]);
  });

  it("maps the service options from listServices for the selected stream", async () => {
    const resolvers = buildTracestreamOptionsResolvers(
      makeCtx({
        strategyConfig: { streamId: "s1" },
        client: {
          listServices: async ({ streamId }) => {
            expect(streamId).toBe("s1");
            return {
              services: [service({ serviceName: "cart" }), service({ serviceName: "auth" })],
            };
          },
        },
      }),
    );
    expect(await resolvers[TRACESTREAM_SERVICE_OPTIONS_RESOLVER]({})).toEqual([
      { value: "cart", label: "cart" },
      { value: "auth", label: "auth" },
    ]);
  });

  it("returns [] for the operation resolver when no serviceName is chosen", async () => {
    const listOperations = async (): Promise<ListOperationsResult> => {
      throw new Error("listOperations should not be called without a service");
    };
    const resolvers = buildTracestreamOptionsResolvers(
      makeCtx({ strategyConfig: { streamId: "s1" }, client: { listOperations } }),
    );
    expect(await resolvers[TRACESTREAM_OPERATION_OPTIONS_RESOLVER]({})).toEqual(
      [],
    );
  });

  it("returns [] for the operation resolver when no stream is selected", async () => {
    const resolvers = buildTracestreamOptionsResolvers(
      makeCtx({ strategyConfig: {}, client: {} }),
    );
    expect(
      await resolvers[TRACESTREAM_OPERATION_OPTIONS_RESOLVER]({
        serviceName: "cart",
      }),
    ).toEqual([]);
  });

  it("maps the operation options from listOperations for the stream + service", async () => {
    const resolvers = buildTracestreamOptionsResolvers(
      makeCtx({
        strategyConfig: { streamId: "s1" },
        client: {
          listOperations: async ({ streamId, serviceName }) => {
            expect(streamId).toBe("s1");
            expect(serviceName).toBe("cart");
            return {
              operations: [
                operation({ spanName: "POST /pay" }),
                operation({ spanName: "GET /cart" }),
              ],
            };
          },
        },
      }),
    );
    expect(
      await resolvers[TRACESTREAM_OPERATION_OPTIONS_RESOLVER]({
        serviceName: "cart",
      }),
    ).toEqual([
      { value: "POST /pay", label: "POST /pay" },
      { value: "GET /cart", label: "GET /cart" },
    ]);
  });
});
