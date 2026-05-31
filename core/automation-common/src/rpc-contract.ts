import { z } from "zod";
import {
  createClientDefinition,
  PaginatedResult,
  PaginationInput,
  proc,
} from "@checkstack/common";
import { automationAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  ReplayScopeInputSchema,
  ReplayScopeResultSchema,
  ScriptTestInputSchema,
  ScriptTestResultSchema,
} from "./script-test-schemas";
import {
  ActionInfoSchema,
  ArtifactTypeInfoSchema,
  AutomationArtifactSchema,
  AutomationRunSchema,
  AutomationRunStepSchema,
  AutomationSchema,
  AutomationStatusSchema,
  CreateAutomationInputSchema,
  ListRunsInputSchema,
  ManualRunInputSchema,
  TriggerInfoSchema,
  UpdateAutomationInputSchema,
  ValidateDefinitionInputSchema,
  ValidateDefinitionResultSchema,
} from "./schemas";

/**
 * Automation RPC contract. Mirrors the integration-common pattern: each
 * procedure is built via `proc()` with `userType`, `operationType`, and
 * `access` metadata so `autoAuthMiddleware` enforces auth + access checks
 * automatically.
 *
 * Read operations require `automationAccess.read`. Anything that mutates
 * state, runs an automation, or returns potentially sensitive registry
 * metadata that gates editor UIs requires `automationAccess.manage`.
 */
export const automationContract = {
  // ─── Automations CRUD ──────────────────────────────────────────────────

  listAutomations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
  })
    .input(
      PaginationInput.extend({
        status: AutomationStatusSchema.optional(),
      }),
    )
    .output(PaginatedResult(AutomationSchema)),

  getAutomation: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
  })
    .input(z.object({ id: z.string() }))
    .output(AutomationSchema),

  createAutomation: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
  })
    .input(CreateAutomationInputSchema)
    .output(AutomationSchema),

  updateAutomation: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
  })
    .route({ method: "PATCH" })
    .input(UpdateAutomationInputSchema)
    .output(AutomationSchema),

  deleteAutomation: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  toggleAutomation: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
  })
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .output(AutomationSchema),

  // ─── Definition validation ─────────────────────────────────────────────

  validateDefinition: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.read],
  })
    .input(ValidateDefinitionInputSchema)
    .output(ValidateDefinitionResultSchema),

  // ─── Manual run ────────────────────────────────────────────────────────

  manualRun: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
  })
    .input(ManualRunInputSchema)
    .output(z.object({ runId: z.string() })),

  // ─── Runs / history ────────────────────────────────────────────────────

  listRuns: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
  })
    .input(ListRunsInputSchema)
    .output(PaginatedResult(AutomationRunSchema)),

  getRun: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
  })
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        run: AutomationRunSchema,
        steps: z.array(AutomationRunStepSchema),
        artifacts: z.array(AutomationArtifactSchema),
      }),
    ),

  cancelRun: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
  })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  // ─── Registry introspection ────────────────────────────────────────────

  listTriggers: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
  }).output(z.object({ items: z.array(TriggerInfoSchema) })),

  listActions: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
  }).output(z.object({ items: z.array(ActionInfoSchema) })),

  listArtifactTypes: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
  }).output(z.object({ items: z.array(ArtifactTypeInfoSchema) })),

  // ─── Subscription-migration failures ──────────────────────────────────
  //
  // Surfaces every legacy `webhook_subscriptions` row the one-time
  // migration couldn't translate into an automation. Admins see the
  // list on boot, fix each one by hand (recreating it as an
  // automation), then acknowledge it to clear the entry.

  listMigrationFailures: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.manage],
  }).output(
    z.object({
      items: z.array(
        z.object({
          id: z.string(),
          subscriptionId: z.string(),
          subscriptionName: z.string(),
          providerId: z.string(),
          eventId: z.string(),
          reason: z.string(),
          detail: z.string().optional(),
          providerConfig: z.record(z.string(), z.unknown()),
          createdAt: z.coerce.date(),
        }),
      ),
    }),
  ),

  acknowledgeMigrationFailure: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
  })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  // ─── Inline script testing ─────────────────────────────────────────────

  /**
   * Run a `run_script` (TypeScript) or `run_shell` (shell) script against
   * an editable sample context, using the same sandboxed runner the real
   * action uses. Lets operators test a script directly in the editor
   * without dispatching a whole automation.
   *
   * Gated by `manage` because authoring + running a script already
   * executes code on the central backend — this is the same privilege.
   * The run is time-bounded and always central (real satellite runs may
   * differ; the UI notes this).
   */
  testScript: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
  })
    .input(ScriptTestInputSchema)
    .output(ScriptTestResultSchema),

  /**
   * Reconstruct an editable test context from a real automation run, so an
   * operator can replay a script against the data that run saw. Reads run
   * data only (trigger + persisted artifacts, plus the durable scope
   * snapshot when the run is still in-flight), so it's gated by `read`.
   */
  getRunScopeForReplay: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
  })
    .input(ReplayScopeInputSchema)
    .output(ReplayScopeResultSchema),

  // ─── Template playground ───────────────────────────────────────────────

  /**
   * Render a template (or evaluate a condition) against a sample context.
   * Used by the playground page and the inline preview in the editor.
   */
  renderTemplate: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.read],
  })
    .input(
      z.object({
        template: z.string(),
        context: z.record(z.string(), z.unknown()).default({}),
        mode: z.enum(["template", "condition"]).default("template"),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        output: z.string().optional(),
        booleanResult: z.boolean().optional(),
        error: z
          .object({
            message: z.string(),
            line: z.number(),
            column: z.number(),
          })
          .optional(),
      }),
    ),
};

export type AutomationContract = typeof automationContract;

/**
 * Client definition for typed `rpcApi.forPlugin(AutomationApi)` calls
 * from the frontend.
 */
export const AutomationApi = createClientDefinition(
  automationContract,
  pluginMetadata,
);
