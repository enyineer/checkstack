import { createClientDefinition, proc } from "@checkstack/common";
import { z } from "zod";
import { metricstreamAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  MetricStreamSchema,
  CreateMetricStreamSchema,
  UpdateMetricStreamSchema,
  MetricStreamTokenSchema,
  MintTokenSchema,
  MintTokenResultSchema,
  RevokeTokenSchema,
  MetricScrapeTargetSchema,
  CreateScrapeTargetSchema,
  UpdateScrapeTargetSchema,
  DeleteScrapeTargetSchema,
  ListScrapeTargetsSchema,
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
 * team-scopable resource; tokens / scrape targets / metrics / buckets / events
 * are all scoped by their owning `streamId`. The instanceAccess choices mirror
 * logstream's reviewed contract exactly.
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
  // SOURCE TOKENS (manage; scoped by the owning stream id)
  // ==========================================================================

  listTokens: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.manage],
    instanceAccess: { idParam: "streamId" },
  })
    .input(z.object({ streamId: z.string() }))
    .output(z.array(MetricStreamTokenSchema)),

  /** Mint a token; returns the full secret ONCE plus the persisted row. */
  mintToken: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [metricstreamAccess.manage],
    instanceAccess: { idParam: "streamId" },
  })
    .input(MintTokenSchema)
    .output(MintTokenResultSchema),

  /** Revoke a token. The handler MUST invalidate the ingest auth cache entry. */
  revokeToken: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [metricstreamAccess.manage],
    instanceAccess: { idParam: "streamId" },
  })
    .input(RevokeTokenSchema)
    .output(z.void()),

  // ==========================================================================
  // SCRAPE TARGETS (Prometheus pull; manage-gated on the owning stream)
  // ==========================================================================

  listScrapeTargets: proc({
    operationType: "query",
    userType: "authenticated",
    access: [metricstreamAccess.manage],
    instanceAccess: { idParam: "streamId" },
  })
    .input(ListScrapeTargetsSchema)
    .output(z.array(MetricScrapeTargetSchema)),

  createScrapeTarget: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [metricstreamAccess.manage],
    instanceAccess: { idParam: "streamId" },
  })
    .input(CreateScrapeTargetSchema)
    .output(MetricScrapeTargetSchema),

  updateScrapeTarget: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [metricstreamAccess.manage],
    instanceAccess: { idParam: "streamId" },
  })
    .route({ method: "PATCH" })
    .input(UpdateScrapeTargetSchema)
    .output(MetricScrapeTargetSchema),

  deleteScrapeTarget: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [metricstreamAccess.manage],
    instanceAccess: { idParam: "streamId" },
  })
    .route({ method: "DELETE" })
    .input(DeleteScrapeTargetSchema)
    .output(z.void()),

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
