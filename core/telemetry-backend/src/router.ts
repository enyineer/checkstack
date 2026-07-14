import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
} from "@checkstack/backend-api";
import {
  telemetryContract,
  telemetryResourceTypes,
} from "@checkstack/telemetry-common";
import type { TelemetryService } from "./service";

/**
 * The telemetry oRPC router. Thin: every handler passes through to
 * {@link TelemetryService}. Auth + RLAC (typeScoped / create / idParam /
 * listKey) are enforced by `autoAuthMiddleware` from the contract's
 * `instanceAccess`, so handlers never re-check the source grant
 * (see `.claude/rules/rlac.md`).
 *
 * The ONE check instanceAccess cannot express is `testSourceConfig` with a
 * `sourceId`: it is a `typeScoped` endpoint (no id to scope on for the fresh
 * -editor case), so when the caller reuses an EXISTING source's stored secrets
 * the handler must additionally verify MANAGE on that source before merging
 * them - mirroring the idParam middleware by hand.
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

    testSourceConfig: os.testSourceConfig.handler(async ({ input, context }) => {
      if (input.sourceId) {
        await assertCanManageSource({ context, sourceId: input.sourceId });
      }
      return service.runConfigTest(input);
    }),
  });
}

export type TelemetryRouter = ReturnType<typeof createTelemetryRouter>;

/** Manage-rule qualified id (`telemetry.source.manage`). */
const MANAGE_RULE_ID = `${telemetryResourceTypes.source}.manage`;

/**
 * Verify the caller may MANAGE a specific source instance, mirroring the
 * idParam instanceAccess middleware: a global manage rule OR a team grant on
 * the instance. Services are trusted. Used by `testSourceConfig` when it reuses
 * an existing source's stored secrets.
 */
async function assertCanManageSource({
  context,
  sourceId,
}: {
  context: RpcContext;
  sourceId: string;
}): Promise<void> {
  const user = context.user;
  if (!user) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
  }
  if (user.type === "service") return;

  const accessRules = user.accessRules ?? [];
  const hasGlobalAccess =
    accessRules.includes("*") || accessRules.includes(MANAGE_RULE_ID);
  const { hasAccess } = await context.auth.check({
    userId: user.id,
    userType: user.type,
    objectType: telemetryResourceTypes.source,
    objectId: sourceId,
    action: "manage",
    hasGlobalAccess,
  });
  if (!hasAccess) {
    throw new ORPCError("FORBIDDEN", {
      message: `Access denied to source ${sourceId}`,
    });
  }
}
