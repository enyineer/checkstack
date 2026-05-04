import type { InfrastructureTabContext } from "@checkstack/infrastructure-common";
import { QueueConfigTab } from "./QueueConfigTab";
import { QueueRuntimePanel } from "./QueueRuntimePanel";

/**
 * Queue tab body for the Infrastructure Settings page.
 *
 * Stacks two sub-sections inside the same tab:
 *  - Runtime: live job counts (read-only, always shown).
 *  - Configuration: provider selection + tuning (gated by `canUpdate`).
 */
export const QueueInfrastructureTab = ({
  canUpdate,
}: InfrastructureTabContext) => {
  return (
    <div className="space-y-6">
      <QueueRuntimePanel />
      <QueueConfigTab canUpdate={canUpdate} />
    </div>
  );
};
