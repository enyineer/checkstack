import React from "react";
import type { NotificationPolicy } from "@checkstack/healthcheck-common";
import { Button, Label, Toggle, Tooltip } from "@checkstack/ui";

interface NotificationsPanelProps {
  policy: NotificationPolicy;
  onChange: (policy: NotificationPolicy) => void;
  onSave: () => void;
  saving: boolean;
  isLocked?: boolean;
}

/**
 * Panel for configuring per-association notification behaviour.
 *
 * Today there is a single toggle (suppress de-escalations); future
 * preferences (e.g. coalescing) should slot in here alongside it.
 */
export const NotificationsPanel: React.FC<NotificationsPanelProps> = ({
  policy,
  onChange,
  onSave,
  saving,
  isLocked,
}) => {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Notifications</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Control which health state transitions notify subscribers for this
          check.
        </p>
      </div>

      <div className="p-4 bg-muted/50 rounded-lg border space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">
                Suppress de-escalation notifications
              </Label>
              <Tooltip content="When on, transitions from a worse state to a better one (but not back to healthy) are skipped. Recoveries and escalations still notify." />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Skips intermediate notifications like{" "}
              <code className="text-[11px]">unhealthy &rarr; degraded</code>.
              You still get notified when the system gets worse or fully
              recovers.
            </p>
          </div>
          <Toggle
            checked={policy.suppressDeEscalations}
            onCheckedChange={(checked: boolean) =>
              onChange({ ...policy, suppressDeEscalations: checked })
            }
            disabled={saving || isLocked}
            aria-label="Suppress de-escalation notifications"
          />
        </div>
      </div>

      <div className="flex justify-end pt-2 border-t">
        <Button size="sm" onClick={onSave} disabled={saving || isLocked}>
          {saving ? "Saving..." : "Save Notifications"}
        </Button>
      </div>
    </div>
  );
};
