import type { RegisteredAiTool } from "@checkstack/ai-backend";
import { createMaintenanceCreateTool } from "./maintenance-create";
import { createMaintenanceUpdateTool } from "./maintenance-update";
import { createMaintenanceDeleteTool } from "./maintenance-delete";
import { createMaintenanceAddUpdateTool } from "./maintenance-add-update";
import { createMaintenanceCloseTool } from "./maintenance-close";
import { createMaintenanceAddLinkTool } from "./maintenance-add-link";
import { createMaintenanceRemoveLinkTool } from "./maintenance-remove-link";
import { createMaintenanceDeleteUpdateTool } from "./maintenance-delete-update";

/**
 * The maintenance plugin's AI tools, registered into the AI registry via
 * `aiToolExtensionPoint` from this plugin's own init - NOT centralized in
 * ai-backend. This is the canonical pattern any plugin (first- or third-party)
 * uses to contribute AI tools without ai-backend depending on it.
 *
 * create/update/addUpdate/close/addLink are `mutate` (auto-applies in AUTO mode,
 * confirm-gated in APPROVE mode); delete/removeLink are `destructive` (always
 * confirm-gated). They all go through the USER-SCOPED client passed at call time,
 * so handler-side authorization (access rules AND per-resource/team scoping) is
 * enforced exactly as a direct UI/RPC call; the resolver gate + the
 * propose/apply re-check are the additional authorization authority.
 */
export function buildMaintenanceAiTools(): RegisteredAiTool[] {
  return [
    createMaintenanceCreateTool(),
    createMaintenanceUpdateTool(),
    createMaintenanceDeleteTool(),
    createMaintenanceAddUpdateTool(),
    createMaintenanceCloseTool(),
    createMaintenanceAddLinkTool(),
    createMaintenanceRemoveLinkTool(),
    createMaintenanceDeleteUpdateTool(),
  ];
}
