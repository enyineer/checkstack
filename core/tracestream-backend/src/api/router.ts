import { implement } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
} from "@checkstack/backend-api";
import { tracestreamContract } from "@checkstack/tracestream-common";
import type { TracestreamService } from "./service";

/**
 * The tracestream oRPC router. Deliberately thin: every handler passes straight
 * through to {@link TracestreamService}. Auth + RLAC (listKey / idParam /
 * create / typeScoped) are enforced by `autoAuthMiddleware` from the contract's
 * `instanceAccess`, so handlers never re-check grants (see `.claude/rules/rlac.md`).
 * Unlike metricstream there is no satellite-binding seam - tracestream has no
 * caller-supplied resource the stream gate cannot already authorize.
 */
export function createTracestreamRouter({
  service,
}: {
  service: TracestreamService;
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

    // ── Source tokens ───────────────────────────────────────────────────
    listTokens: os.listTokens.handler(async ({ input }) =>
      service.listTokens({ streamId: input.streamId }),
    ),

    mintToken: os.mintToken.handler(async ({ input }) =>
      service.mintToken({ streamId: input.streamId, name: input.name }),
    ),

    revokeToken: os.revokeToken.handler(async ({ input }) => {
      await service.revokeToken({
        streamId: input.streamId,
        tokenId: input.tokenId,
      });
    }),

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
  });
}

export type TracestreamRouter = ReturnType<typeof createTracestreamRouter>;
