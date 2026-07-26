import { implement } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
} from "@checkstack/backend-api";
import { telemetryContract } from "@checkstack/telemetry-common";
import type { TelemetryService } from "./service";

/**
 * The telemetry oRPC router. Thin: every handler passes through to
 * {@link TelemetryService}. Auth + RLAC (typeScoped / create / idParam /
 * listKey) are enforced by `autoAuthMiddleware` from the contract's
 * `instanceAccess`, so handlers never re-check the source grant
 * (see `.claude/rules/rlac.md`).
 *
 * "Test connection" is split so BOTH cases are contract-declared: the fresh
 * -editor dry run (`testSourceConfig`, `typeScoped`) and the secret-reuse dry run
 * (`testExistingSource`, `idParam: "sourceId"`). Neither re-checks a grant by
 * hand - the previous in-handler manage check on `sourceId` was removed.
 */
export function createTelemetryRouter({
  service,
}: {
  service: TelemetryService;
}) {
  const os = implement(telemetryContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return os.router({
    listSourceTypes: os.listSourceTypes.handler(async ({ input }) =>
      service.listSourceTypes(input),
    ),

    createSource: os.createSource.handler(async ({ input, context }) => {
      // `teamId` is consumed by the create-mode middleware (owning-team grant)
      // and must NOT reach the insert - `telemetry_sources` has no such column.
      const { teamId: _teamId, ...rest } = input;
      return service.createSource({
        input: rest,
        user: context.user,
        requestHeaders: context.requestHeaders,
      });
    }),

    updateSource: os.updateSource.handler(async ({ input, context }) =>
      service.updateSource({
        id: input.id,
        body: input.body,
        user: context.user,
        requestHeaders: context.requestHeaders,
      }),
    ),

    deleteSource: os.deleteSource.handler(async ({ input }) => {
      await service.deleteSource({ id: input.id });
    }),

    getSource: os.getSource.handler(async ({ input }) =>
      service.getSource({ id: input.id }),
    ),

    listSources: os.listSources.handler(async ({ input }) =>
      service.listSources(input),
    ),

    listBindableStreams: os.listBindableStreams.handler(
      async ({ input, context }) =>
        service.listBindableStreams({ signal: input.signal, user: context.user }),
    ),

    rotateWebhookSecret: os.rotateWebhookSecret.handler(async ({ input }) =>
      service.rotateWebhookSecret({ id: input.id }),
    ),

    rotatePushToken: os.rotatePushToken.handler(async ({ input }) =>
      service.rotatePushToken({ id: input.id }),
    ),

    // Fresh-editor dry run (no stored secrets): typeScoped, middleware-enforced.
    testSourceConfig: os.testSourceConfig.handler(async ({ input }) =>
      service.runConfigTest(input),
    ),

    // Secret-reuse dry run: MANAGE on `sourceId` is enforced by the `idParam`
    // instanceAccess mode (see the contract), so this is a thin pass-through -
    // no hand-rolled per-source check.
    testExistingSource: os.testExistingSource.handler(async ({ input }) =>
      service.runConfigTest(input),
    ),
  });
}

export type TelemetryRouter = ReturnType<typeof createTelemetryRouter>;
