import React from "react";
import type { NotificationPolicy } from "@checkstack/healthcheck-common";
import { Button, Input, Label, Toggle, Tooltip } from "@checkstack/ui";

interface NotificationsPanelProps {
  policy: NotificationPolicy;
  onChange: (policy: NotificationPolicy) => void;
  onSave: () => void;
  saving: boolean;
  isLocked?: boolean;
}

/**
 * Panel for configuring per-association notification behaviour. All
 * settings are scoped to a single (system, configuration) assignment
 * — different checks on the same system are independent.
 */
export const NotificationsPanel: React.FC<NotificationsPanelProps> = ({
  policy,
  onChange,
  onSave,
  saving,
  isLocked,
}) => {
  const disabled = saving || isLocked;
  return (
    <div className="p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Notifications</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Control which health state transitions notify subscribers for this
          check, and when an incident is auto-opened for the system.
        </p>
      </div>

      {/* Suppress de-escalations */}
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
            disabled={disabled}
            aria-label="Suppress de-escalation notifications"
          />
        </div>
      </div>

      {/* Auto-open incident on critical */}
      <div className="p-4 bg-muted/50 rounded-lg border space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">
                Auto-open incident when this check is critical
              </Label>
              <Tooltip content="When the check transitions to unhealthy and meets the threshold below, an incident is auto-opened on the system. Different checks on the same system are independent — disabling here only affects this check." />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              An incident gives operators one ticket per outage instead of
              one per state change. Especially useful for Jira / Slack
              integrations.
            </p>
          </div>
          <Toggle
            checked={policy.autoOpenIncidentOnUnhealthy}
            onCheckedChange={(checked: boolean) =>
              onChange({ ...policy, autoOpenIncidentOnUnhealthy: checked })
            }
            disabled={disabled}
            aria-label="Auto-open incident when this check is critical"
          />
        </div>

        {/* Sub-options visible only when auto-open is on */}
        {policy.autoOpenIncidentOnUnhealthy && (
          <>
            <div className="flex items-start justify-between gap-4 pl-4 border-l-2 border-border">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Label className="text-sm">
                    Suppress further notifications while open
                  </Label>
                  <Tooltip content="When on, the auto-incident is created with notification suppression enabled. Subsequent state changes for this system stay silent until the incident is resolved (Email, Jira, Slack all silenced)." />
                </div>
              </div>
              <Toggle
                checked={policy.useNotificationSuppression}
                onCheckedChange={(checked: boolean) =>
                  onChange({
                    ...policy,
                    useNotificationSuppression: checked,
                  })
                }
                disabled={disabled}
                aria-label="Suppress further notifications while open"
              />
            </div>

            <div className="pl-4 border-l-2 border-border space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Incident threshold</Label>
                <Tooltip content="How many times the check must flip to unhealthy within the window before an incident is auto-opened. Default `1 in 60 min` opens on the very first transition; raise it to require the check to keep coming back to unhealthy." />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Open after</span>
                <Input
                  type="number"
                  min={1}
                  className="h-8 w-16 text-center"
                  value={policy.incidentThreshold.transitions}
                  onChange={(e) =>
                    onChange({
                      ...policy,
                      incidentThreshold: {
                        ...policy.incidentThreshold,
                        transitions:
                          Number.parseInt(e.target.value, 10) || 1,
                      },
                    })
                  }
                  disabled={disabled}
                />
                <span>transitions to unhealthy within</span>
                <Input
                  type="number"
                  min={1}
                  className="h-8 w-16 text-center"
                  value={policy.incidentThreshold.windowMinutes}
                  onChange={(e) =>
                    onChange({
                      ...policy,
                      incidentThreshold: {
                        ...policy.incidentThreshold,
                        windowMinutes:
                          Number.parseInt(e.target.value, 10) || 1,
                      },
                    })
                  }
                  disabled={disabled}
                />
                <span>minutes</span>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end pt-2 border-t">
        <Button size="sm" onClick={onSave} disabled={disabled}>
          {saving ? "Saving..." : "Save Notifications"}
        </Button>
      </div>
    </div>
  );
};
