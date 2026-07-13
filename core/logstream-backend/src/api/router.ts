import { implement } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
} from "@checkstack/backend-api";
import { logstreamContract } from "@checkstack/logstream-common";
import type { LogstreamService } from "./service";

/**
 * The logstream oRPC router. Deliberately thin: every handler passes straight
 * through to {@link LogstreamService}. Auth + RLAC (listKey / idParam / create /
 * typeScoped) are enforced by `autoAuthMiddleware` from the contract's
 * `instanceAccess`, so handlers never re-check grants (see `.claude/rules/rlac.md`).
 */
export function createLogstreamRouter({
  service,
}: {
  service: LogstreamService;
}) {
  const os = implement(logstreamContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return os.router({
    // ── Stream CRUD ─────────────────────────────────────────────────────
    createStream: os.createStream.handler(async ({ input }) => {
      // `teamId` is consumed by the create-mode middleware (owning-team grant)
      // and must NOT reach the insert - the `log_streams` table has no such
      // column.
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
    searchEvents: os.searchEvents.handler(async ({ input }) =>
      service.searchEvents(input),
    ),

    getSeverityBuckets: os.getSeverityBuckets.handler(async ({ input }) =>
      service.getSeverityBuckets(input),
    ),

    getPatternBuckets: os.getPatternBuckets.handler(async ({ input }) =>
      service.getPatternBuckets(input),
    ),

    listPatterns: os.listPatterns.handler(async ({ input }) =>
      service.listPatterns({ streamId: input.streamId, limit: input.limit }),
    ),

    // ── Custom patterns + pattern variables ─────────────────────────────
    createPattern: os.createPattern.handler(async ({ input }) =>
      service.createPattern(input),
    ),

    deletePattern: os.deletePattern.handler(async ({ input }) => {
      await service.deletePattern(input);
    }),

    testPattern: os.testPattern.handler(async ({ input }) =>
      service.testPattern(input),
    ),

    maskLine: os.maskLine.handler(async ({ input }) => service.maskLine(input)),

    listPatternVariables: os.listPatternVariables.handler(async ({ input }) =>
      service.listPatternVariables(input),
    ),

    listImportantEvents: os.listImportantEvents.handler(async ({ input }) =>
      service.listImportantEvents(input),
    ),

    getStreamOverview: os.getStreamOverview.handler(async ({ input }) =>
      service.getStreamOverview({ streamId: input.streamId }),
    ),
  });
}

export type LogstreamRouter = ReturnType<typeof createLogstreamRouter>;
