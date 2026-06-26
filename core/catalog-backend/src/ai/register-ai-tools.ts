import type { RegisteredAiTool } from "@checkstack/ai-backend";
import { createCatalogCreateSystemTool } from "./catalog-create-system";
import { createCatalogUpdateSystemTool } from "./catalog-update-system";
import { createCatalogDeleteSystemTool } from "./catalog-delete-system";
import { createCatalogCreateGroupTool } from "./catalog-create-group";
import { createCatalogUpdateGroupTool } from "./catalog-update-group";
import { createCatalogDeleteGroupTool } from "./catalog-delete-group";
import { createCatalogAddSystemToGroupTool } from "./catalog-add-system-to-group";
import { createCatalogRemoveSystemFromGroupTool } from "./catalog-remove-system-from-group";
import { createCatalogCreateEnvironmentTool } from "./catalog-create-environment";
import { createCatalogSetSystemEnvironmentsTool } from "./catalog-set-system-environments";

/**
 * The catalog plugin's AI tools, registered into the AI registry via
 * `aiToolExtensionPoint` from this plugin's own init - NOT centralized in
 * ai-backend. This is the canonical pattern any plugin uses to contribute AI
 * tools without ai-backend depending on it.
 *
 * Create/update + membership tools are `mutate` (auto-applies in AUTO mode,
 * confirm-gated in APPROVE mode); the two delete tools are `destructive` (always
 * confirm-gated). All go through the USER-SCOPED client passed at call time, so
 * handler-side authorization is enforced exactly as a direct UI/RPC call; the
 * resolver gate + the propose/apply re-check at propose AND apply time are the
 * additional authorization authority.
 */
export function buildCatalogAiTools(): RegisteredAiTool[] {
  return [
    createCatalogCreateSystemTool(),
    createCatalogUpdateSystemTool(),
    createCatalogDeleteSystemTool(),
    createCatalogCreateGroupTool(),
    createCatalogUpdateGroupTool(),
    createCatalogDeleteGroupTool(),
    createCatalogAddSystemToGroupTool(),
    createCatalogRemoveSystemFromGroupTool(),
    createCatalogCreateEnvironmentTool(),
    createCatalogSetSystemEnvironmentsTool(),
  ];
}
