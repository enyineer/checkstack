import { implement } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
} from "@checkstack/backend-api";
import { metricstreamContract } from "@checkstack/metricstream-common";
import type { MetricstreamService } from "./service";
import type { SatelliteBindingAuthorizer } from "../satellite/binding-auth";
import type { SystemLinksReadableAuthorizer } from "./system-links-auth";

/**
 * The metricstream oRPC router. Deliberately thin: every handler passes straight
 * through to {@link MetricstreamService}. Auth + RLAC (listKey / idParam /
 * create / typeScoped) are enforced by `autoAuthMiddleware` from the contract's
 * `instanceAccess`, so handlers never re-check grants (see `.claude/rules/rlac.md`).
 *
 * The ONE thing instanceAccess cannot express is authorizing the caller-supplied
 * `satelliteId` on a scrape target (the stream gate does not prove the caller may
 * use a satellite). `assertSatelliteBindable` closes that (SAT-C SSRF fix) and is
 * REQUIRED - never optional - so a scrape target can never bind to a satellite the
 * caller cannot read + scrape. See `../satellite/binding-auth.ts`.
 */
export function createMetricstreamRouter({
  service,
  assertSatelliteBindable,
  assertLinkedSystemsReadable,
}: {
  service: MetricstreamService;
  assertSatelliteBindable: SatelliteBindingAuthorizer;
  /**
   * The system-links "cannot expose what you cannot see" gate. Like
   * `assertSatelliteBindable`, instanceAccess cannot express it: the stream
   * `manage` gate does not prove the caller can READ the systems being linked.
   * Injected so tests substitute a deterministic authorizer (no HTTP re-entry).
   */
  assertLinkedSystemsReadable: SystemLinksReadableAuthorizer;
}) {
  const os = implement(metricstreamContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return os.router({
    // ── Stream CRUD ─────────────────────────────────────────────────────
    createStream: os.createStream.handler(async ({ input }) => {
      // `teamId` is consumed by the create-mode middleware (owning-team grant)
      // and must NOT reach the insert - the `metric_streams` table has no such
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

    // ── Scrape targets ──────────────────────────────────────────────────
    listScrapeTargets: os.listScrapeTargets.handler(async ({ input }) =>
      service.listScrapeTargets({ streamId: input.streamId }),
    ),

    createScrapeTarget: os.createScrapeTarget.handler(async ({ input, context }) => {
      // Authorize the binding BEFORE persisting: a non-null satelliteId must be a
      // satellite the caller can READ and that advertises `scrape` (SAT-C fix).
      if (typeof input.satelliteId === "string") {
        await assertSatelliteBindable({
          satelliteId: input.satelliteId,
          requestHeaders: context.requestHeaders,
        });
      }
      return service.createScrapeTarget(input);
    }),

    updateScrapeTarget: os.updateScrapeTarget.handler(async ({ input, context }) => {
      // Same gate on the rebind path (null->sat, sat->other-sat). A null unbind
      // (back to core) or an omitted field (keep) needs no satellite authorization.
      if (typeof input.satelliteId === "string") {
        await assertSatelliteBindable({
          satelliteId: input.satelliteId,
          requestHeaders: context.requestHeaders,
        });
      }
      return service.updateScrapeTarget(input);
    }),

    deleteScrapeTarget: os.deleteScrapeTarget.handler(async ({ input }) => {
      await service.deleteScrapeTarget({
        streamId: input.streamId,
        targetId: input.targetId,
      });
    }),

    // ── Autocomplete + viewer reads ─────────────────────────────────────
    listMetricNames: os.listMetricNames.handler(async ({ input }) =>
      service.listMetricNames(input),
    ),

    listLabelKeys: os.listLabelKeys.handler(async ({ input }) =>
      service.listLabelKeys(input),
    ),

    listLabelValues: os.listLabelValues.handler(async ({ input }) =>
      service.listLabelValues(input),
    ),

    listMetricSeries: os.listMetricSeries.handler(async ({ input }) =>
      service.listMetricSeries(input),
    ),

    getMetricBuckets: os.getMetricBuckets.handler(async ({ input }) =>
      service.getMetricBuckets(input),
    ),

    listImportantEvents: os.listImportantEvents.handler(async ({ input }) =>
      service.listImportantEvents(input),
    ),

    getStreamOverview: os.getStreamOverview.handler(async ({ input }) =>
      service.getStreamOverview({ streamId: input.streamId }),
    ),

    // ── System links (explicit stream -> catalog-system mapping) ────────
    listSystemLinks: os.listSystemLinks.handler(async ({ input }) =>
      service.listSystemLinks({ streamId: input.streamId }),
    ),

    setSystemLinks: os.setSystemLinks.handler(async ({ input, context }) => {
      // The service checks existence FIRST, diffs the requested set against the
      // persisted one, and gates ONLY the NEWLY ADDED systems via this callback
      // (re-enters catalog AS the caller). The stream `manage` gate the
      // middleware enforced only proves the caller may manage the stream, not
      // that they may SEE the systems - so a manager can never EXPOSE a system
      // they cannot read, but is never dead-locked by a link someone else added.
      await service.setSystemLinks({
        streamId: input.streamId,
        systemIds: input.systemIds,
        assertAddedReadable: (addedSystemIds) =>
          assertLinkedSystemsReadable({
            addedSystemIds,
            requestHeaders: context.requestHeaders,
          }),
      });
    }),

    listStreamsForSystem: os.listStreamsForSystem.handler(async ({ input }) =>
      service.listStreamsForSystem({ systemId: input.systemId }),
    ),

    listLinkedStreamStatuses: os.listLinkedStreamStatuses.handler(
      async ({ input }) =>
        service.listLinkedStreamStatuses({ systemIds: input.systemIds }),
    ),
  });
}

export type MetricstreamRouter = ReturnType<typeof createMetricstreamRouter>;
