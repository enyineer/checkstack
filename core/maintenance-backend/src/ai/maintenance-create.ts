import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  MaintenanceApi,
  maintenanceAccess,
  pluginMetadata,
  type MaintenanceWithSystems,
} from "@checkstack/maintenance-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/**
 * Tool-local create schema. The exported `CreateMaintenanceInputSchema` is a
 * `ZodEffects` (it carries a `.refine`) whose `startAt` / `endAt` are `z.date()`;
 * the model only ever sends ISO strings, so this mirror coerces those two fields
 * to `Date` (via `z.coerce.date()`) while reproducing the same field set and the
 * same `endAt > startAt` invariant. The exported schema is NOT mutated. The
 * coerced values are real `Date` instances, exactly what the RPC client expects.
 */
export const MaintenanceCreateInputSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    suppressNotifications: z.boolean().optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    systemIds: z.array(z.string()).min(1),
    /** Optional owning-team id forwarded to the RPC; consumed by
     * autoAuthMiddleware (create-mode team ownership) and ignored by the
     * backend handler. AI tools generally omit this and let the operator
     * context resolve ownership. */
    teamId: z.string().optional(),
  })
  .refine((v) => v.endAt > v.startAt, {
    message: "endAt must be after startAt",
    path: ["endAt"],
  });
export type MaintenanceCreateInput = z.infer<typeof MaintenanceCreateInputSchema>;

/** Output returned once a human applies the proposal (the created maintenance). */
export interface MaintenanceCreateApplyResult {
  maintenance: MaintenanceWithSystems;
}

/**
 * `maintenance.create` - schedule a new maintenance window.
 *
 * `effect: "mutate"` - creating a maintenance is a non-destructive create, so it
 * auto-applies in AUTO mode and is confirm-gated in APPROVE mode via the
 * propose/apply machinery. `dryRun` summarizes the window without creating it;
 * `execute` (reached only via `apply`) performs the create through the
 * USER-SCOPED client, so handler-side authorization (access rules AND
 * per-resource/team scoping) is enforced exactly as a direct UI/RPC call.
 */
export function createMaintenanceCreateTool(): RegisteredAiTool<
  MaintenanceCreateInput,
  MaintenanceCreateApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: MaintenanceCreateInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<MaintenanceCreateInput>> => {
    return {
      summary: `Create maintenance "${input.title}" from ${input.startAt.toISOString()} to ${input.endAt.toISOString()} affecting ${input.systemIds.length} system(s)${input.suppressNotifications ? " (notifications suppressed)" : ""}.`,
      payload: input,
    };
  };

  return {
    name: "maintenance.create",
    description:
      "Schedule a new maintenance window over one or more systems with a start and end time. Provide startAt/endAt as ISO 8601 timestamps; endAt must be after startAt. Never creates directly; a person must approve unless the conversation is in auto mode. Find system ids with the catalog read tools first.",
    effect: "mutate",
    input: MaintenanceCreateInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, maintenanceAccess.maintenance.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);
      const maintenance = await maintenanceClient.createMaintenance(input);
      return { maintenance };
    },
  };
}
