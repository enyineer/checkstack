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
import { tracestreamAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  TraceStreamSchema,
  CreateTraceStreamSchema,
  UpdateTraceStreamSchema,
  SearchTracesSchema,
  SearchTracesResultSchema,
  GetTraceSchema,
  GetTraceResultSchema,
  GetOpBucketsSchema,
  GetOpBucketsResultSchema,
  ListServicesSchema,
  ListServicesResultSchema,
  ListOperationsSchema,
  ListOperationsResultSchema,
  GetStreamOverviewSchema,
  StreamOverviewSchema,
  ListImportantEventsSchema,
  ListImportantEventsResultSchema,
  FindTraceByIdSchema,
  FindTraceByIdResultSchema,
  StreamForPickerSchema,
  ListStreamSummariesResultSchema,
} from "./schemas";

/**
 * Trace stream RPC contract (oRPC contract-first). Every write proc declares
 * exactly one `instanceAccess` mode so team-scoping stays coherent with the
 * frontend gates (see `.claude/rules/rlac.md`). Streams are the only
 * team-scopable resource; traces / spans / buckets / services / operations /
 * events are all scoped by their owning `streamId`. Push-token management moved
 * to the telemetry platform (`tracestream.push` source instances), so this
 * contract no longer carries token procedures. The instanceAccess choices
 * mirror metricstream's reviewed contract exactly.
 */
export const tracestreamContract = {
  // ==========================================================================
  // STREAM CRUD
  // ==========================================================================

  /** Create a stream. A team member with a create-capability grant may pass a
   * requested owning `teamId`; the middleware writes the owning-team grant for
   * the created `id`. */
  createStream: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [tracestreamAccess.manage],
    instanceAccess: { create: { teamIdParam: "teamId", idField: "id" } },
  })
    .input(CreateTraceStreamSchema.extend({ teamId: z.string().optional() }))
    .output(TraceStreamSchema),

  updateStream: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [tracestreamAccess.manage],
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "PATCH" })
    .input(z.object({ id: z.string(), body: UpdateTraceStreamSchema }))
    .output(TraceStreamSchema),

  deleteStream: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [tracestreamAccess.manage],
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.void()),

  /** List streams the caller may read (post-filtered by grant). */
  listStreams: proc({
    operationType: "query",
    userType: "authenticated",
    access: [tracestreamAccess.read],
    instanceAccess: { listKey: "streams" },
  }).output(z.object({ streams: z.array(TraceStreamSchema) })),

  /**
   * Batch row data for the streams-list page in ONE set-based batch (avoids a
   * per-row N+1). Post-filtered by grant on each summary's `id` (the stream id)
   * via `listKey` - the item field MUST be `id`.
   */
  listStreamSummaries: proc({
    operationType: "query",
    userType: "authenticated",
    access: [tracestreamAccess.read],
    instanceAccess: { listKey: "summaries" },
  }).output(ListStreamSummariesResultSchema),

  /** Read a single stream, authorized against the caller's grant on its id. */
  getStream: proc({
    operationType: "query",
    userType: "authenticated",
    access: [tracestreamAccess.read],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(TraceStreamSchema),

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
    access: [tracestreamAccess.read],
    instanceAccess: { typeScoped: {} },
  }).output(z.array(StreamForPickerSchema)),

  // ==========================================================================
  // VIEWER READS (read; scoped by the owning stream id)
  // ==========================================================================

  /** Keyset-paginated trace search over the summary rows. */
  searchTraces: proc({
    operationType: "query",
    userType: "authenticated",
    access: [tracestreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(SearchTracesSchema)
    .output(SearchTracesResultSchema),

  /** One trace's summary + its full span set (the waterfall). */
  getTrace: proc({
    operationType: "query",
    userType: "authenticated",
    access: [tracestreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(GetTraceSchema)
    .output(GetTraceResultSchema),

  /** Windowed operation buckets for a (service, operation) selection (charts). */
  getOpBuckets: proc({
    operationType: "query",
    userType: "authenticated",
    access: [tracestreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(GetOpBucketsSchema)
    .output(GetOpBucketsResultSchema),

  // ==========================================================================
  // SYSTEM LINKS (explicit stream -> catalog-system mapping; shared schemas
  // live in @checkstack/telemetry-common - see system-links.ts there)
  // ==========================================================================

  /** Systems this stream is explicitly linked to. */
  listSystemLinks: proc({
    operationType: "query",
    userType: "authenticated",
    access: [tracestreamAccess.read],
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
    access: [tracestreamAccess.manage],
    instanceAccess: { idParam: "streamId" },
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
    access: [tracestreamAccess.read],
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
    access: [tracestreamAccess.read],
    instanceAccess: { listKey: "matches" },
  })
    .input(ListLinkedStreamStatusesSchema)
    .output(ListLinkedStreamStatusesResultSchema),

  /** Services seen in a stream (service-list + autocomplete). */
  listServices: proc({
    operationType: "query",
    userType: "authenticated",
    access: [tracestreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(ListServicesSchema)
    .output(ListServicesResultSchema),

  /** Operations (span names) seen for a service (autocomplete). */
  listOperations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [tracestreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(ListOperationsSchema)
    .output(ListOperationsResultSchema),

  getStreamOverview: proc({
    operationType: "query",
    userType: "authenticated",
    access: [tracestreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(GetStreamOverviewSchema)
    .output(StreamOverviewSchema),

  listImportantEvents: proc({
    operationType: "query",
    userType: "authenticated",
    access: [tracestreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(ListImportantEventsSchema)
    .output(ListImportantEventsResultSchema),

  /**
   * Cross-stream "jump to trace by id": returns every stream (the caller may
   * read) in which the id appears. Post-filtered by the caller's stream grants
   * via `listKey` - the item field the filter keys on is `id` (the STREAM id).
   */
  findTraceById: proc({
    operationType: "query",
    userType: "authenticated",
    access: [tracestreamAccess.read],
    instanceAccess: { listKey: "matches" },
  })
    .input(FindTraceByIdSchema)
    .output(FindTraceByIdResultSchema),
};

export type TracestreamContract = typeof tracestreamContract;

/**
 * Client definition for type-safe usage.
 * Frontend: `const client = usePluginClient(TracestreamApi);`
 * Backend:  `const client = rpcClient.forPlugin(TracestreamApi);`
 */
export const TracestreamApi = createClientDefinition(
  tracestreamContract,
  pluginMetadata,
);
