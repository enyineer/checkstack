import type { RegisteredAiTool } from "@checkstack/ai-backend";
import { createHealthcheckProposeTool } from "./healthcheck-propose";
import { createHealthcheckUpdateTool } from "./healthcheck-update";
import { createHealthcheckDeleteTool } from "./healthcheck-delete";
import {
  createHealthcheckListCapabilitiesTool,
  createHealthcheckGetCapabilitySchemaTool,
} from "./healthcheck-capabilities";
import {
  createHealthcheckGetScriptContextTool,
  createHealthcheckTestScriptTool,
} from "./healthcheck-script-tools";
import {
  createNotifySystemSubscribersTool,
  createNotifySystemGroupSubscribersTool,
} from "./notify-subscribers";

/**
 * The health-check plugin's AI tools, registered into the AI registry via
 * `aiToolExtensionPoint` from this plugin's own init - NOT centralized in
 * ai-backend. This is the canonical pattern any plugin (first- or third-party)
 * uses to contribute AI tools without ai-backend depending on it.
 *
 * The propose/update/delete tools are propose/apply-gated mutating tools
 * (create/update are `mutate`; delete is `destructive`, so always confirm-gated).
 * They go through the USER-SCOPED client passed at call time, so handler-side
 * authorization is enforced exactly as a direct UI/RPC call; the resolver gate +
 * the propose/apply re-check at propose AND apply time are the additional
 * authorization authority.
 *
 * The two capability tools (`healthcheck.listCapabilities` /
 * `healthcheck.getCapabilitySchema`) are `read` tools gated by the healthcheck
 * config read rule; the resolver gate is their authority.
 *
 * The two script tools (`healthcheck.getScriptContext` /
 * `healthcheck.testScript`) are `read` tools gated by the healthcheck
 * configuration-manage rule. They are the healthcheck half of what used to be
 * cross-plugin script-context tools in ai-backend; being single-context, the
 * resolver gate is their authority (no in-execute context re-check).
 */
export function buildHealthcheckAiTools(): RegisteredAiTool[] {
  return [
    createHealthcheckProposeTool(),
    createHealthcheckUpdateTool(),
    createHealthcheckDeleteTool(),
    createHealthcheckListCapabilitiesTool(),
    createHealthcheckGetCapabilitySchemaTool(),
    createHealthcheckGetScriptContextTool(),
    createHealthcheckTestScriptTool(),
    createNotifySystemSubscribersTool(),
    createNotifySystemGroupSubscribersTool(),
  ];
}
