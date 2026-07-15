import type { OptionsResolver, ResolverOption } from "@checkstack/ui";
import type { ConfigOptionsResolverContext } from "@checkstack/healthcheck-frontend";
import {
  TracestreamApi,
  TRACESTREAM_STREAM_OPTIONS_RESOLVER,
  TRACESTREAM_SERVICE_OPTIONS_RESOLVER,
  TRACESTREAM_OPERATION_OPTIONS_RESOLVER,
  type StreamForPicker,
  type TraceServiceInfo,
  type TraceOperationInfo,
} from "@checkstack/tracestream-common";

/** Map a stream summary to a picker option (value = id, label = name). */
export function streamToOption(stream: StreamForPicker): ResolverOption {
  return { value: stream.id, label: stream.name };
}

/** Map a service summary to a picker option (value = label = service name). */
export function serviceToOption(service: TraceServiceInfo): ResolverOption {
  return { value: service.serviceName, label: service.serviceName };
}

/** Map an operation summary to a picker option (value = label = span name). */
export function operationToOption(
  operation: TraceOperationInfo,
): ResolverOption {
  return { value: operation.spanName, label: operation.spanName };
}

/**
 * Read the stream the operator selected in the STRATEGY form. The
 * `operation-latency` collector lives in a sibling form, so the editor passes
 * the strategy config down as context; the field key is the strategy's own
 * `streamId`. Returns undefined when nothing is chosen yet.
 */
export function readSelectedStreamId(
  strategyConfig: Record<string, unknown>,
): string | undefined {
  const streamId = strategyConfig.streamId;
  return typeof streamId === "string" && streamId.length > 0
    ? streamId
    : undefined;
}

/**
 * Read the `serviceName` the operator chose in the SAME collector form. The
 * operation (span-name) picker resolves against the service selected right
 * beside it (the backend annotates `spanName` with `x-depends-on:
 * ["serviceName"]`), so it reads from the `formValues` the editor hands the
 * resolver - not from the strategy config. Returns undefined until a service is
 * chosen.
 */
export function readCollectorServiceName(
  formValues: Record<string, unknown>,
): string | undefined {
  const serviceName = formValues.serviceName;
  return typeof serviceName === "string" && serviceName.length > 0
    ? serviceName
    : undefined;
}

/**
 * Build the trace-stream editor dropdown resolvers from the health-check
 * editor's generic context. Contributed to
 * `HealthCheckConfigOptionsResolverSlot`; see `tracestream-common`'s
 * resolver-name constants for the annotation contract.
 *
 * - `tracestreamStreamId` lists every stream the caller can pick (the
 *   `listStreamsForPicker` procedure is `typeScoped`, so a team-scoped stream
 *   manager gets options without the global rule - no extra client gating).
 * - `tracestreamServiceName` lists the services of the stream chosen in the
 *   strategy form; it returns `[]` until a stream is selected.
 * - `tracestreamSpanName` lists the operations (span names) of the service
 *   chosen in the SAME collector form. It reads `streamId` from the strategy
 *   config and `serviceName` from the collector's own `formValues`, and returns
 *   `[]` until both are chosen.
 */
export function buildTracestreamOptionsResolvers({
  rpcApi,
  strategyConfig,
}: ConfigOptionsResolverContext): Record<string, OptionsResolver> {
  const client = rpcApi.forPlugin(TracestreamApi);

  const streamIdResolver: OptionsResolver = async () => {
    const streams = await client.listStreamsForPicker();
    return streams.map((stream) => streamToOption(stream));
  };

  const serviceNameResolver: OptionsResolver = async () => {
    const streamId = readSelectedStreamId(strategyConfig);
    if (!streamId) return [];
    const { services } = await client.listServices({ streamId });
    return services.map((service) => serviceToOption(service));
  };

  const spanNameResolver: OptionsResolver = async (formValues) => {
    const streamId = readSelectedStreamId(strategyConfig);
    const serviceName = readCollectorServiceName(formValues);
    if (!streamId || !serviceName) return [];
    const { operations } = await client.listOperations({
      streamId,
      serviceName,
    });
    return operations.map((operation) => operationToOption(operation));
  };

  return {
    [TRACESTREAM_STREAM_OPTIONS_RESOLVER]: streamIdResolver,
    [TRACESTREAM_SERVICE_OPTIONS_RESOLVER]: serviceNameResolver,
    [TRACESTREAM_OPERATION_OPTIONS_RESOLVER]: spanNameResolver,
  };
}
