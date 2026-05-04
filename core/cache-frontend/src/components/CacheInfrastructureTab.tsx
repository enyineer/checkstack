import type { InfrastructureTabContext } from "@checkstack/infrastructure-common";
import { CacheConfigTab } from "./CacheConfigTab";
import { CacheRuntimePanel } from "./CacheRuntimePanel";

/**
 * Cache tab body for the Infrastructure Settings page.
 *
 * Stacks two sub-sections inside the same tab:
 *  - Runtime: live cache stats (read-only, always shown).
 *  - Configuration: provider selection (gated by `canUpdate`).
 */
export const CacheInfrastructureTab = ({
  canUpdate,
}: InfrastructureTabContext) => {
  return (
    <div className="space-y-6">
      <CacheRuntimePanel />
      <CacheConfigTab canUpdate={canUpdate} />
    </div>
  );
};
