import type { RegisteredAiTool } from "@checkstack/ai-backend";
import { createIncidentCreateTool } from "./incident-create";
import { createIncidentUpdateTool } from "./incident-update";
import { createIncidentDeleteTool } from "./incident-delete";
import { createIncidentAddUpdateTool } from "./incident-add-update";
import { createIncidentResolveTool } from "./incident-resolve";
import { createIncidentAddLinkTool } from "./incident-add-link";
import { createIncidentRemoveLinkTool } from "./incident-remove-link";
import { createIncidentDeleteUpdateTool } from "./incident-delete-update";

/**
 * The incident plugin's AI tools, registered into the AI registry via
 * `aiToolExtensionPoint` from this plugin's own init - NOT centralized in
 * ai-backend. This is the canonical pattern any plugin (first- or third-party)
 * uses to contribute AI tools without ai-backend depending on it.
 *
 * create/update/addUpdate/resolve/addLink are `mutate` (auto-applies in AUTO
 * mode, confirm-gated in APPROVE mode); delete/removeLink are `destructive`, so
 * always confirm-gated. They all go through the USER-SCOPED client passed at
 * call time, so handler-side authorization is enforced exactly as a direct
 * UI/RPC call; the resolver gate + the propose/apply re-check at propose AND
 * apply time are the additional authorization authority.
 */
export function buildIncidentAiTools(): RegisteredAiTool[] {
  return [
    createIncidentCreateTool(),
    createIncidentUpdateTool(),
    createIncidentDeleteTool(),
    createIncidentAddUpdateTool(),
    createIncidentResolveTool(),
    createIncidentAddLinkTool(),
    createIncidentRemoveLinkTool(),
    createIncidentDeleteUpdateTool(),
  ];
}
