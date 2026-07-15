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
import { logstreamAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  LogStreamSchema,
  CreateLogStreamSchema,
  UpdateLogStreamSchema,
  SearchEventsSchema,
  SearchEventsResultSchema,
  FindEventsByTraceIdSchema,
  FindEventsByTraceIdResultSchema,
  GetBucketsSchema,
  SeverityBucketsResultSchema,
  PatternBucketsResultSchema,
  ListPatternsSchema,
  LogPatternSchema,
  CreatePatternSchema,
  DeletePatternSchema,
  SetPatternHiddenSchema,
  TestPatternSchema,
  TestPatternResultSchema,
  MaskLineSchema,
  MaskLineResultSchema,
  ListPatternVariablesSchema,
  ListPatternVariablesResultSchema,
  ListImportantEventsSchema,
  ListImportantEventsResultSchema,
  ListServiceNamesSchema,
  ListServiceNamesResultSchema,
  StreamOverviewSchema,
  StreamForPickerSchema,
  ListStreamSummariesResultSchema,
} from "./schemas";

/**
 * Log stream RPC contract (oRPC contract-first). Every write proc declares
 * exactly one `instanceAccess` mode so team-scoping stays coherent with the
 * frontend gates (see `.claude/rules/rlac.md`). Streams are the only
 * team-scopable resource; events/patterns/buckets are all scoped by their
 * owning `streamId`. Push-token management is owned by the telemetry platform
 * (the `logstream.push` source type), not by this contract.
 */
export const logstreamContract = {
  // ==========================================================================
  // STREAM CRUD
  // ==========================================================================

  /** Create a stream. A team member with a create-capability grant may pass a
   * requested owning `teamId`; the middleware writes the owning-team grant for
   * the created `id`. */
  createStream: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [logstreamAccess.manage],
    instanceAccess: { create: { teamIdParam: "teamId", idField: "id" } },
  })
    .input(CreateLogStreamSchema.extend({ teamId: z.string().optional() }))
    .output(LogStreamSchema),

  updateStream: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [logstreamAccess.manage],
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "PATCH" })
    .input(z.object({ id: z.string(), body: UpdateLogStreamSchema }))
    .output(LogStreamSchema),

  deleteStream: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [logstreamAccess.manage],
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.void()),

  /** List streams the caller may read (post-filtered by grant). */
  listStreams: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { listKey: "streams" },
  }).output(z.object({ streams: z.array(LogStreamSchema) })),

  /**
   * Batch row data for the streams-list page: per readable stream, last
   * activity + last-24h error/warn counts + pattern count, in ONE set-based
   * batch (avoids a per-row N+1 on the list). Post-filtered by grant on each
   * summary's `id` (the stream id) via `listKey`.
   */
  listStreamSummaries: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { listKey: "summaries" },
  }).output(ListStreamSummariesResultSchema),

  /** Read a single stream, authorized against the caller's grant on its id. */
  getStream: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(LogStreamSchema),

  /**
   * Compact id+name list for the healthcheck strategy config dropdown and
   * future pickers. `typeScoped` so a team-scoped stream manager (a grant on
   * ANY stream, or create-capability) can populate the picker without the
   * global rule - the exact fix rlac.md prescribes over `global: true` for an
   * editor helper reached by team-scoped managers.
   */
  listStreamsForPicker: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { typeScoped: {} },
  }).output(z.array(StreamForPickerSchema)),

  // ==========================================================================
  // SYSTEM LINKS (explicit stream -> catalog-system mapping; shared schemas
  // live in @checkstack/telemetry-common - see system-links.ts there)
  // ==========================================================================

  /** Systems this stream is explicitly linked to. */
  listSystemLinks: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
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
    access: [logstreamAccess.manage],
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
    access: [logstreamAccess.read],
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
    access: [logstreamAccess.read],
    instanceAccess: { listKey: "matches" },
  })
    .input(ListLinkedStreamStatusesSchema)
    .output(ListLinkedStreamStatusesResultSchema),

  /**
   * Distinct `service.name` resource values observed in the stream's stored
   * events (bounded, newest-biased) - the suggestion source for the
   * system-link editor. Suggestions are never auto-applied.
   */
  listServiceNames: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(ListServiceNamesSchema)
    .output(ListServiceNamesResultSchema),

  // ==========================================================================
  // VIEWER READS (read; scoped by the owning stream id)
  // ==========================================================================

  searchEvents: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(SearchEventsSchema)
    .output(SearchEventsResultSchema),

  /**
   * Cross-stream "which logs belong to this trace" lookup (no stream id in
   * the input): returns per-stream match groups, post-filtered to the
   * caller's readable streams via `listKey` (each match's `id` IS the stream
   * id). Powers the trace-view correlations panel.
   */
  findEventsByTraceId: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { listKey: "matches" },
  })
    .input(FindEventsByTraceIdSchema)
    .output(FindEventsByTraceIdResultSchema),

  getSeverityBuckets: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(GetBucketsSchema)
    .output(SeverityBucketsResultSchema),

  getPatternBuckets: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(GetBucketsSchema)
    .output(PatternBucketsResultSchema),

  listPatterns: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(ListPatternsSchema)
    .output(z.array(LogPatternSchema)),

  // ==========================================================================
  // CUSTOM PATTERNS (author up front; manage-gated on the owning stream)
  // ==========================================================================

  /**
   * Create a user-authored pattern. Gated by `manage` on the owning stream
   * (same mode as token mint). The handler derives
   * `patternId = sha256(streamId + template)`, stores `origin: 'user'`, and
   * returns a 409-style conflict if that id already exists.
   */
  createPattern: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [logstreamAccess.manage],
    instanceAccess: { idParam: "streamId" },
  })
    .input(CreatePatternSchema)
    .output(LogPatternSchema),

  /**
   * Delete a user-authored pattern. Gated by `manage` on the owning stream.
   * ONLY `origin: 'user'` patterns may be deleted; a `mined` pattern id is
   * rejected (mined patterns are owned by the Drain engine, not the user).
   */
  deletePattern: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [logstreamAccess.manage],
    instanceAccess: { idParam: "streamId" },
  })
    .route({ method: "DELETE" })
    .input(DeletePatternSchema)
    .output(z.void()),

  /**
   * Hide or unhide a pattern (mined or user-authored). Gated by `manage` on
   * the owning stream. A hidden pattern keeps counting in every aggregate but
   * stops persisting raw lines and leaves the default pattern listings; it can
   * be unhidden at any time from the Patterns tab.
   */
  setPatternHidden: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [logstreamAccess.manage],
    instanceAccess: { idParam: "streamId" },
  })
    .input(SetPatternHiddenSchema)
    .output(LogPatternSchema),

  /**
   * Dry-run a candidate template against the newest raw lines (read-gated on the
   * stream, like `listPatterns`). Runs the SAME matcher the ingest path uses and
   * returns the match count plus up to 3 matched samples for the live preview.
   */
  testPattern: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(TestPatternSchema)
    .output(TestPatternResultSchema),

  /**
   * Mask a raw log line into its Drain template, so the pattern builder can seed
   * its chips from a pasted line in the EXACT backend mask space (a browser
   * re-implementation of the masker would drift). Read-gated on the stream, same
   * mode as `testPattern`.
   */
  maskLine: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(MaskLineSchema)
    .output(MaskLineResultSchema),

  /**
   * Per-`<*>`-position recent-sample summary for a pattern, driving the
   * pattern-metric collector's variable picker. Read-gated on the stream (same
   * mode as `listPatterns`), so a team-scoped stream reader configuring a check
   * can populate the picker.
   */
  listPatternVariables: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(ListPatternVariablesSchema)
    .output(ListPatternVariablesResultSchema),

  listImportantEvents: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(ListImportantEventsSchema)
    .output(ListImportantEventsResultSchema),

  getStreamOverview: proc({
    operationType: "query",
    userType: "authenticated",
    access: [logstreamAccess.read],
    instanceAccess: { idParam: "streamId" },
  })
    .input(z.object({ streamId: z.string() }))
    .output(StreamOverviewSchema),
};

export type LogstreamContract = typeof logstreamContract;

/**
 * Client definition for type-safe usage.
 * Frontend: `const client = usePluginClient(LogstreamApi);`
 * Backend:  `const client = rpcClient.forPlugin(LogstreamApi);`
 */
export const LogstreamApi = createClientDefinition(
  logstreamContract,
  pluginMetadata,
);
