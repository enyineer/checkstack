import type { RegisteredAiTool } from "@checkstack/ai-backend";
import { createAutomationProposeTool } from "./automation-propose";
import { createAutomationUpdateTool } from "./automation-update";
import { createAutomationDeleteTool } from "./automation-delete";
import {
  createAutomationListCapabilitiesTool,
  createAutomationGetCapabilitySchemaTool,
} from "./automation-capabilities";
import {
  createAutomationGetScriptContextTool,
  createAutomationTestScriptTool,
} from "./automation-script-tools";

/**
 * The automation plugin's AI tools, registered into the AI registry via
 * `aiToolExtensionPoint` from this plugin's own init - NOT centralized in
 * ai-backend. This is the canonical pattern any plugin (first- or third-party)
 * uses to contribute AI tools without ai-backend depending on it.
 *
 * The propose/update/delete tools are propose/apply-gated mutating tools
 * (create/update are `mutate`; delete is `destructive`, so always confirm-gated).
 * They use the USER-SCOPED client passed at call time, so handler-side
 * authorization (access rules AND per-resource/team scope) applies; the resolver
 * gate + the propose/apply re-check at propose AND apply time add further
 * authority. The capability tools are `read`-effect introspection of the
 * automation registries, gated by the automation read rule.
 *
 * The script-context tools (`automation.getScriptContext`,
 * `automation.testScript`) are `read`-effect: the former is a pure extraction
 * from the generated SDK editor bundle; the latter fans the draft out to the
 * automation test RPC's fail-closed sandbox without persisting anything. Both
 * are gated by the automation manage rule (the same rule that gates the
 * automation editor + the underlying script test RPC).
 */
export function buildAutomationAiTools(): RegisteredAiTool[] {
  return [
    createAutomationProposeTool(),
    createAutomationUpdateTool(),
    createAutomationDeleteTool(),
    createAutomationListCapabilitiesTool(),
    createAutomationGetCapabilitySchemaTool(),
    createAutomationGetScriptContextTool(),
    createAutomationTestScriptTool(),
  ];
}
