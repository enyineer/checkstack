import { implement } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
} from "@checkstack/backend-api";
import { tracestreamContract } from "@checkstack/tracestream-common";
import type { TracestreamService } from "./service";
import type { SystemLinkAuthorizer } from "./system-links-auth";

/**
 * The tracestream oRPC router. Deliberately thin: every handler passes straight
 * through to {@link TracestreamService}. Auth + RLAC (listKey / idParam /
 * create / typeScoped) are enforced by `autoAuthMiddleware` from the contract's
 * `instanceAccess`, so handlers never re-check grants (see `.claude/rules/rlac.md`).
 *
 * The ONE thing instanceAccess cannot express is authorizing the caller-supplied
 * `systemIds` on `setSystemLinks`: the stream gate proves the caller may manage
 * their stream, not that they may READ the systems they attach. `authorizeSystemLinks`
 * closes that (a stream manager cannot expose a system they cannot see) and is
 * REQUIRED - never optional. See `./system-links-auth.ts`.
 */
export function createTracestreamRouter({
  service,
  authorizeSystemLinks,
}: {
  service: TracestreamService;
  authorizeSystemLinks: SystemLinkAuthorizer;
}) {
  const os = implement(tracestreamContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return os.router({
    // ── Stream CRUD ─────────────────────────────────────────────────────
    createStream: os.createStream.handler(async ({ input }) => {
      // `teamId` is consumed by the create-mode middleware (owning-team grant)
      // and must NOT reach the insert - streams have no such column.
      const { teamId: _teamId, ...rest } = input;
      return service.createStream(rest);
    }),

    updateStream: os.updateStream.handler(async ({ input }) =>
      service.updateStream({ id: input.id, body: input.body }),
    ),

    deleteStream: os.deleteStream.handler(async ({ input }) => {
      await service.deleteStream({ id: input.id });
    }),

    listStreams: os.listStreams.handler(async () => service.listStreams()),

    listStreamSummaries: os.listStreamSummaries.handler(async () =>
      service.listStreamSummaries(),
    ),

    getStream: os.getStream.handler(async ({ input }) =>
      service.getStream({ id: input.id }),
    ),

    listStreamsForPicker: os.listStreamsForPicker.handler(async () =>
      service.listStreamsForPicker(),
    ),

    // ── Viewer reads ────────────────────────────────────────────────────
    searchTraces: os.searchTraces.handler(async ({ input }) =>
      service.searchTraces(input),
    ),

    getTrace: os.getTrace.handler(async ({ input }) => service.getTrace(input)),

    getOpBuckets: os.getOpBuckets.handler(async ({ input }) =>
      service.getOpBuckets(input),
    ),

    listServices: os.listServices.handler(async ({ input }) =>
      service.listServices(input),
    ),

    listOperations: os.listOperations.handler(async ({ input }) =>
      service.listOperations(input),
    ),

    getStreamOverview: os.getStreamOverview.handler(async ({ input }) =>
      service.getStreamOverview({ streamId: input.streamId }),
    ),

    listImportantEvents: os.listImportantEvents.handler(async ({ input }) =>
      service.listImportantEvents(input),
    ),

    findTraceById: os.findTraceById.handler(async ({ input }) =>
      service.findTraceById(input),
    ),

    // ── System links ────────────────────────────────────────────────────
    listSystemLinks: os.listSystemLinks.handler(async ({ input }) =>
      service.listSystemLinks(input),
    ),

    setSystemLinks: os.setSystemLinks.handler(async ({ input, context }) => {
      const requested = [...new Set(input.systemIds)];
      // Existence-first: throws NOT_FOUND before any catalog round-trip, and
      // yields the persisted set so only NEWLY ADDED systems are readability-
      // checked (retained/removed ids need no read - see system-links-auth.ts).
      const persisted = await service.getSystemLinksForWrite({
        streamId: input.streamId,
      });
      const persistedSet = new Set(persisted);
      const added = requested.filter((id) => !persistedSet.has(id));
      // Authorize the ADDED systems AS the caller BEFORE persisting: a stream
      // manager cannot expose a system they cannot read (propagates FORBIDDEN).
      await authorizeSystemLinks({
        addedSystemIds: added,
        requestHeaders: context.requestHeaders,
      });
      await service.setSystemLinks({
        streamId: input.streamId,
        systemIds: requested,
      });
    }),

    listStreamsForSystem: os.listStreamsForSystem.handler(async ({ input }) =>
      service.listStreamsForSystem(input),
    ),

    listLinkedStreamStatuses: os.listLinkedStreamStatuses.handler(
      async ({ input }) => service.listLinkedStreamStatuses(input),
    ),
  });
}

export type TracestreamRouter = ReturnType<typeof createTracestreamRouter>;
