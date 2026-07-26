import { createClientDefinition, proc } from "@checkstack/common";
import { z } from "zod";
import {
  ListLinkedStreamStatusesResultSchema,
  ListLinkedStreamStatusesSchema,
  ListStreamsForSystemResultSchema,
  ListStreamsForSystemSchema,
  ListSystemLinksResultSchema,
  ListSystemLinksSchema,
  SetSystemLinksSchema,
} from "@checkstack/telemetry-common";
import { metricstreamAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  MetricStreamSchema,
  CreateMetricStreamSchema,
  UpdateMetricStreamSchema,
  ListMetricNamesSchema,
  ListMetricNamesResultSchema,
  ListLabelKeysSchema,
  ListLabelKeysResultSchema,
  ListLabelValuesSchema,
  ListLabelValuesResultSchema,
  ListMetricSeriesSchema,
  ListMetricSeriesResultSchema,
  GetMetricBucketsSchema,
  GetMetricBucketsResultSchema,
  ListImportantEventsSchema,
  ListImportantEventsResultSchema,
  StreamOverviewSchema,
  StreamForPickerSchema,
  ListStreamSummariesResultSchema,
} from "./schemas";

/**
 * Metric stream RPC contract (oRPC contract-first). Every write proc declares
 * exactly one `instanceAccess` mode so team-scoping stays coherent with the
 * frontend gates (see `.claude/rules/rlac.md`). Streams are the only
 * team-scopable resource; metrics / buckets / events are all scoped by their
 * owning `streamId`. Push-token management lives on the telemetry platform (a
 * `metricstream.push` source instance) - the plugin no longer exposes token
 * mint/list/revoke RPCs. The instanceAccess choices mirror logstream's reviewed
 * contract exactly.
 */
export const metricstreamContract = {
  // ==========================================================================
  // STREAM CRUD
  // ==========================================================================

  /** Create a stream. A team member with a create-capability grant may pass a
   * requested owning `teamId`; the middleware writes the owning-team grant for
   * the created `id`. */
  createStream: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [metricstreamAccess.manage],
    instanceAccess: { create: { teamIdParam: "teamId", idField: "id" } },
  })
    .input(CreateMetricStreamSchema.extend({ teamId: z.string().optional() }))
    .output(MetricStreamSchema),

  updateStream: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [metricstreamAccess.manage],
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "PATCH" })
    .input(z.object({ id: z.string(), body: UpdateMetricStreamSchema }))
    .output(MetricStreamSchema),

  deleteStream: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [metricstreamAccess.manage],
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.void()),

  /** List streams the caller may read (post-filtered by grant). */
  listStreams: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.read],
    instanceAccess: { listKey: "streams" },
  }).output(z.object({ streams: z.array(MetricStreamSchema) })),

  /**
   * Batch row data for the streams-list page in ONE set-based batch (avoids a
   * per-row N+1). Post-filtered by grant on each summary's `id` (the stream id)
   * via `listKey` - the item field MUST be `id`.
   */
  listStreamSummaries: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.read],
    instanceAccess: { listKey: "summaries" },
  }).output(ListStreamSummariesResultSchema),

  /** Read a single stream, authorized against the caller's grant on its id. */
  getStream: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.read],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(MetricStreamSchema),

  /**
   * Compact id+name list for the healthcheck strategy config dropdown and future
   * pickers. `typeScoped` so a team-scoped stream manager (a grant on ANY
   * stream, or create-capability) can populate the picker without the global
   * rule - the exact fix rlac.md prescribes over `global: true` for an editor
   * helper reached by team-scoped managers.
   */
  listStreamsForPicker: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.read],
    instanceAccess: { typeScoped: {} },
  }).output(z.array(StreamForPickerSchema)),

  // ==========================================================================
  // AUTOCOMPLETE + VIEWER READS (read; scoped by the owning stream id)
  // ==========================================================================

  /** Metric-name autocomplete (reads metric_names; cheap). */
  listMetricNames: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(ListMetricNamesSchema)
    .output(ListMetricNamesResultSchema),

  /** DISTINCT label keys for a metric (bounded scan of metric_series). */
  listLabelKeys: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(ListLabelKeysSchema)
    .output(ListLabelKeysResultSchema),

  // ==========================================================================
  // SYSTEM LINKS (explicit stream -> catalog-system mapping; shared schemas
  // live in @checkstack/telemetry-common - see system-links.ts there)
  // ==========================================================================

  /** Systems this stream is explicitly linked to. */
  listSystemLinks: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(ListSystemLinksSchema)
    .output(ListSystemLinksResultSchema),

  /**
   * Replace the stream's linked-system set. The handler MUST verify the
   * caller can READ every NEWLY ADDED system (the diff against the persisted
   * set; retained/removed ids need no readability) via a USER-scoped catalog
   * `getSystems` membership pass BEFORE persisting - a stream manager cannot
   * expose a system they cannot see, but is never dead-locked by a link
   * someone else authorized.
   */
  setSystemLinks: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [metricstreamAccess.manage],
    instanceAccess: { idParam: "streamId" },
    accessNote: {
      summary:
        "beyond MANAGE on the stream, every system you ADD to the links must be " +
        "one you can READ (you cannot expose a stream to a system you cannot " +
        "see); already-linked systems are unaffected.",
    },
  })
    .input(SetSystemLinksSchema)
    .output(z.void()),

  /**
   * Streams linked to one system (the catalog system page direction),
   * post-filtered to the caller's readable streams (`listKey` - each
   * stream's `id` is the key).
   */
  listStreamsForSystem: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.read],
    instanceAccess: { listKey: "streams" },
  })
    .input(ListStreamsForSystemSchema)
    .output(ListStreamsForSystemResultSchema),

  /**
   * Bulk signal-state lookup for the dashboard's system signals: the newest
   * recent important event per linked stream, for all requested systems in
   * one call. Post-filtered to readable streams (`listKey`).
   */
  listLinkedStreamStatuses: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.read],
    instanceAccess: { listKey: "matches" },
  })
    .input(ListLinkedStreamStatusesSchema)
    .output(ListLinkedStreamStatusesResultSchema),

  /** DISTINCT label values for a (metric, key) pair (bounded + limit). */
  listLabelValues: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(ListLabelValuesSchema)
    .output(ListLabelValuesResultSchema),

  /** Sample concrete series for a metric (metrics browser). */
  listMetricSeries: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(ListMetricSeriesSchema)
    .output(ListMetricSeriesResultSchema),

  /** Windowed buckets for a metric selection (charts + overview quick-chart). */
  getMetricBuckets: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(GetMetricBucketsSchema)
    .output(GetMetricBucketsResultSchema),

  listImportantEvents: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(ListImportantEventsSchema)
    .output(ListImportantEventsResultSchema),

  getStreamOverview: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(z.object({ streamId: z.string() }))
    .output(StreamOverviewSchema),
};

export type MetricstreamContract = typeof metricstreamContract;

/**
 * Client definition for type-safe usage.
 * Frontend: `const client = usePluginClient(MetricstreamApi);`
 * Backend:  `const client = rpcClient.forPlugin(MetricstreamApi);`
 */
export const MetricstreamApi = createClientDefinition(
  metricstreamContract,
  pluginMetadata,
);
