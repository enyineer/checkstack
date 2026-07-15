import { implement } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
} from "@checkstack/backend-api";
import { logstreamContract } from "@checkstack/logstream-common";
import type { LogstreamService } from "./service";
import type { SystemLinkAuthorizer } from "./system-links-auth";

/**
 * The logstream oRPC router. Deliberately thin: every handler passes straight
 * through to {@link LogstreamService}. Auth + RLAC (listKey / idParam / create /
 * typeScoped) are enforced by `autoAuthMiddleware` from the contract's
 * `instanceAccess`, so handlers never re-check grants (see `.claude/rules/rlac.md`).
 *
 * The ONE thing instanceAccess cannot express is authorizing the caller-supplied
 * `systemIds` on `setSystemLinks`: the stream gate proves the caller may manage
 * their stream, not that they may READ the systems they attach. `authorizeSystemLinks`
 * closes that over the ADDED subset (a stream manager cannot expose a system they
 * cannot see) and is REQUIRED - never optional. See `./system-links-auth.ts`.
 */
export function createLogstreamRouter({
  service,
  authorizeSystemLinks,
}: {
  service: LogstreamService;
  authorizeSystemLinks: SystemLinkAuthorizer;
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

    findEventsByTraceId: os.findEventsByTraceId.handler(async ({ input }) =>
      service.findEventsByTraceId(input),
    ),

    getSeverityBuckets: os.getSeverityBuckets.handler(async ({ input }) =>
      service.getSeverityBuckets(input),
    ),

    getPatternBuckets: os.getPatternBuckets.handler(async ({ input }) =>
      service.getPatternBuckets(input),
    ),

    listPatterns: os.listPatterns.handler(async ({ input }) =>
      service.listPatterns(input),
    ),

    // ── Custom patterns + pattern variables ─────────────────────────────
    createPattern: os.createPattern.handler(async ({ input }) =>
      service.createPattern(input),
    ),

    deletePattern: os.deletePattern.handler(async ({ input }) => {
      await service.deletePattern(input);
    }),

    setPatternHidden: os.setPatternHidden.handler(async ({ input }) =>
      service.setPatternHidden(input),
    ),

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

    // ── System links (explicit stream -> catalog-system mapping) ─────────
    listSystemLinks: os.listSystemLinks.handler(async ({ input }) =>
      service.listSystemLinks({ streamId: input.streamId }),
    ),

    setSystemLinks: os.setSystemLinks.handler(async ({ input, context }) => {
      // Existence-check-first: throws NOT_FOUND for an unknown stream BEFORE any
      // catalog round-trip, and returns the currently-persisted set.
      const { systemIds: persisted } = await service.getSystemLinksForUpdate({
        streamId: input.streamId,
      });
      const requested = [...new Set(input.systemIds)];
      const persistedSet = new Set(persisted);
      // ADDED-ONLY: only NEWLY-added systems are gated for readability. Unlinking
      // (or re-saving a retained system the caller can no longer read) is never
      // blocked, so an unrelated edit is not held hostage by a stale link.
      const added = requested.filter((id) => !persistedSet.has(id));
      if (added.length > 0) {
        // Authorize the added systems AS the caller (a stream manager cannot
        // expose a system they cannot read); propagates FORBIDDEN naming them.
        await authorizeSystemLinks({
          systemIds: added,
          requestHeaders: context.requestHeaders,
        });
      }
      await service.setSystemLinks({
        streamId: input.streamId,
        systemIds: requested,
      });
    }),

    listStreamsForSystem: os.listStreamsForSystem.handler(async ({ input }) =>
      service.listStreamsForSystem({ systemId: input.systemId }),
    ),

    listLinkedStreamStatuses: os.listLinkedStreamStatuses.handler(
      async ({ input }) =>
        service.listLinkedStreamStatuses({ systemIds: input.systemIds }),
    ),

    listServiceNames: os.listServiceNames.handler(async ({ input }) =>
      service.listServiceNames({ streamId: input.streamId }),
    ),
  });
}

export type LogstreamRouter = ReturnType<typeof createLogstreamRouter>;
