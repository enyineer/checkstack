import { createClientDefinition, proc } from "@checkstack/common";
import { z } from "zod";
import { telemetryAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  TelemetrySourceSchema,
  CreateTelemetrySourceSchema,
  UpdateTelemetrySourceSchema,
  SourceTypeDescriptorSchema,
  WebhookInfoSchema,
  PushInfoSchema,
  TestSourceConfigInlineSchema,
  TestExistingSourceSchema,
  TestSourceConfigResultSchema,
  BindableStreamSchema,
} from "./schemas";
import { TelemetrySignalSchema } from "./signal-model";

/**
 * Telemetry platform RPC contract (oRPC contract-first). Source INSTANCES are
 * the only team-scopable resource; the source-type catalog is a no-instance
 * editor helper. Every write proc declares exactly one `instanceAccess` mode
 * (see `.claude/rules/rlac.md`); the mode choices mirror the reviewed
 * logstream/metricstream contracts.
 *
 * Stream-binding authorization is NOT expressed here: it is enforced in the
 * handlers through the owning sink's `assertBindable`, because the platform
 * cannot depend on any stream plugin's access rules.
 */
export const telemetryContract = {
  // ==========================================================================
  // SOURCE TYPE CATALOG
  // ==========================================================================

  /**
   * List the contributed source types (the "Add source" catalog), optionally
   * filtered to types that can emit a signal. `typeScoped` so a team-scoped
   * source manager (a grant on ANY source, or create-capability) can open the
   * catalog without the global rule - the rlac.md fix over `global: true` for
   * an editor helper reached by team-scoped managers.
   */
  listSourceTypes: proc({
    operationType: "query",
    userType: "authenticated",
    access: [telemetryAccess.read],
    instanceAccess: { typeScoped: {} },
  })
    .input(z.object({ signal: TelemetrySignalSchema.optional() }).optional())
    .output(z.object({ sourceTypes: z.array(SourceTypeDescriptorSchema) })),

  // ==========================================================================
  // SOURCE INSTANCE CRUD
  // ==========================================================================

  /**
   * Create a source instance. A team member with a create-capability grant may
   * pass a requested owning `teamId`; the middleware writes the owning-team
   * grant for the created `id`. The handler ADDITIONALLY authorizes every
   * binding via the owning sink's `assertBindable`. For webhook-mode types the
   * result carries the endpoint info with the secret shown ONCE.
   */
  createSource: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [telemetryAccess.manage],
    instanceAccess: { create: { teamIdParam: "teamId", idField: "id" } },
  })
    .input(CreateTelemetrySourceSchema.extend({ teamId: z.string().optional() }))
    .output(
      TelemetrySourceSchema.extend({
        webhook: WebhookInfoSchema.optional(),
        /** For push-mode types: the minted bearer token, shown ONCE. */
        push: PushInfoSchema.optional(),
      }),
    ),

  updateSource: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [telemetryAccess.manage],
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "PATCH" })
    .input(z.object({ id: z.string(), body: UpdateTelemetrySourceSchema }))
    .output(TelemetrySourceSchema),

  deleteSource: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [telemetryAccess.manage],
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.void()),

  /** Read a single source, authorized against the caller's grant on its id. */
  getSource: proc({
    operationType: "query",
    userType: "authenticated",
    access: [telemetryAccess.read],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(TelemetrySourceSchema),

  /**
   * List sources the caller may read (post-filtered by grant), optionally
   * narrowed to instances bound to a stream / emitting a signal - the query
   * behind a stream detail page's "Sources" tab.
   */
  listSources: proc({
    operationType: "query",
    userType: "authenticated",
    access: [telemetryAccess.read],
    instanceAccess: { listKey: "sources" },
  })
    .input(
      z
        .object({
          streamId: z.string().optional(),
          signal: TelemetrySignalSchema.optional(),
          sourceTypeId: z.string().optional(),
        })
        .optional(),
    )
    .output(z.object({ sources: z.array(TelemetrySourceSchema) })),

  /**
   * List the streams the caller may BIND for a signal (the binding editor's
   * per-signal picker). The owning sink resolves and FILTERS the list to
   * streams the caller may manage - the platform never learns what a stream
   * is. `typeScoped` at manage level: an editor helper reached by team-scoped
   * source managers before an instance exists.
   */
  listBindableStreams: proc({
    operationType: "query",
    userType: "authenticated",
    access: [telemetryAccess.manage],
    instanceAccess: { typeScoped: {} },
  })
    .input(z.object({ signal: TelemetrySignalSchema }))
    .output(z.object({ streams: z.array(BindableStreamSchema) })),

  // ==========================================================================
  // WEBHOOK SECRET
  // ==========================================================================

  /**
   * Rotate a webhook-mode instance's endpoint secret. The previous secret
   * stops verifying immediately; the new one is shown ONCE.
   */
  rotateWebhookSecret: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [telemetryAccess.manage],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(WebhookInfoSchema),

  /**
   * Rotate a push-mode instance's bearer token. The previous token stops
   * verifying immediately (cross-pod caches are invalidated); the new one is
   * shown ONCE.
   */
  rotatePushToken: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [telemetryAccess.manage],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(PushInfoSchema),

  // ==========================================================================
  // CONFIG TEST
  // ==========================================================================

  /**
   * Dry-run a fresh (inline) config without persisting anything (the editor's
   * "Test connection", no stored secrets to reuse). `typeScoped` at manage
   * level: reached from the editor BEFORE an instance exists, so there is no id
   * to scope on, but the caller must be a source manager (global rule, any
   * grant, or create-capability). Reusing an existing source's stored secrets is
   * the separate `testExistingSource` (a real id → `idParam` mode).
   */
  testSourceConfig: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [telemetryAccess.manage],
    instanceAccess: { typeScoped: {} },
  })
    .input(TestSourceConfigInlineSchema)
    .output(TestSourceConfigResultSchema),

  /**
   * Dry-run an EXISTING source's config, filling omitted secret keys from its
   * stored values. `sourceId` is required and authorized by the `idParam`
   * instanceAccess mode (MANAGE on that source) - the middleware enforces it, so
   * the handler is a thin pass-through (no hand-rolled per-source check). This
   * split replaced the old "typeScoped + in-handler manage on sourceId" shape so
   * the authorization is contract-declared and self-documenting.
   */
  testExistingSource: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [telemetryAccess.manage],
    instanceAccess: { idParam: "sourceId" },
  })
    .input(TestExistingSourceSchema)
    .output(TestSourceConfigResultSchema),
};

// Export contract type
export type TelemetryContract = typeof telemetryContract;

// Client definition for type-safe usePluginClient / rpcClient.forPlugin usage.
export const TelemetryApi = createClientDefinition(
  telemetryContract,
  pluginMetadata,
);
