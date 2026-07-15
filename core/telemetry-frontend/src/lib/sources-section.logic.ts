import type {
  SourceTypeDescriptor,
  TelemetrySource,
} from "@checkstack/telemetry-common";

/**
 * Whether the `StreamSourcesSection` embed should render NOTHING. The platform
 * ships before any source type exists, so an owning stream page must not show
 * an empty "Sources" shell: hide the section entirely when the signal has no
 * contributed source types AND the stream has no already-bound source
 * instances. Once either exists there is something to manage, so the section
 * appears.
 *
 * Both inputs are the signal-filtered query results (`listSourceTypes({signal})`
 * / `listSources({streamId, signal})`), so this is a pure emptiness check.
 */
export function shouldHideSourcesSection({
  sourceTypes,
  sources,
}: {
  sourceTypes: SourceTypeDescriptor[];
  sources: TelemetrySource[];
}): boolean {
  return sourceTypes.length === 0 && sources.length === 0;
}

/** Index descriptors by their qualified id for row/type lookups. */
export function indexSourceTypes(
  sourceTypes: SourceTypeDescriptor[],
): Map<string, SourceTypeDescriptor> {
  return new Map(sourceTypes.map((type) => [type.id, type]));
}
