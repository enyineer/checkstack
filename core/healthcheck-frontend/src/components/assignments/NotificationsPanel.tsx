import React from "react";
import type { NotificationPolicy } from "@checkstack/healthcheck-common";
import { Button, Input, Label, Toggle, Tooltip } from "@checkstack/ui";

interface NotificationsPanelProps {
  policy: NotificationPolicy;
  onChange: (policy: NotificationPolicy) => void;
  onSave: () => void;
  saving: boolean;
  isLocked?: boolean;
  /**
   * Inheritance state — only meaningful when the panel is rendered
   * for an assignment (not the platform-defaults editor). When
   * `false`, the panel shows a banner explaining that values are
   * inherited and offers an "Override" action.
   */
  isOverridden?: boolean;
  /** Switch to "use platform defaults" mode for this assignment. */
  onUseDefaults?: () => void;
  /** Start overriding (clones the current inherited values). */
  onOverride?: () => void;
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
  isOverridden,
  onUseDefaults,
  onOverride,
}) => {
  // Inheritance UI only applies when the panel is hosted by an
  // assignment — the platform-defaults editor passes neither
  // `isOverridden` nor the callbacks.
  const inheritanceMode =
    typeof isOverridden === "boolean" && (onUseDefaults || onOverride);
  // The Override / Use-defaults buttons in the banner must stay
  // clickable even while the form is locked; only saving / GitOps
  // lock should disable them.
  const actionsDisabled = saving || isLocked;
  // While the assignment inherits, the form values themselves are
  // visible but read-only — operators must click Override to edit
  // them.
  const disabled =
    actionsDisabled || (inheritanceMode ? !isOverridden : false);
  return (
    <div className="p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Notifications</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Control which health state transitions notify subscribers for this
          check, and when an incident is auto-opened for the system.
        </p>
      </div>

      {inheritanceMode && (
        <div
          className={`p-3 rounded-lg border flex items-center justify-between gap-3 ${
            isOverridden
              ? "bg-warning/5 border-warning/30"
              : "bg-muted/40 border-border"
          }`}
        >
          <div className="text-xs">
            {isOverridden ? (
              <>
                <span className="font-medium text-warning">
                  Custom override
                </span>{" "}
                — this check ignores the platform defaults.
              </>
            ) : (
              <>
                <span className="font-medium">Using platform defaults</span>{" "}
                — fields below are read-only. Click Override to customise
                them for this check only.
              </>
            )}
          </div>
          {isOverridden && onUseDefaults && (
            <Button
              size="sm"
              variant="outline"
              onClick={onUseDefaults}
              disabled={actionsDisabled}
            >
              Use platform defaults
            </Button>
          )}
          {!isOverridden && onOverride && (
            <Button
              size="sm"
              variant="outline"
              onClick={onOverride}
              disabled={actionsDisabled}
            >
              Override
            </Button>
          )}
        </div>
      )}

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

      {/* Auto-open incident */}
      <div className="p-4 bg-muted/50 rounded-lg border space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">
                Auto-open incident when this check is critical
              </Label>
              <Tooltip content="When either trigger below fires, an incident is auto-opened on the system. Different checks on the same system are independent — disabling here only affects this check." />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              One incident per outage instead of one ping per state change.
              Especially useful for Jira / Slack / email — the incident's
              suppression silences downstream channels for the lifetime of
              the incident.
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

        {policy.autoOpenIncidentOnUnhealthy && (
          <div className="pl-4 border-l-2 border-border space-y-4">
            {/* Suppress further notifications */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <Label className="text-sm">
                  Suppress further notifications while open
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Email, Jira, Slack all silenced for this system until the
                  incident is resolved.
                </p>
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

            {/* Skip during maintenance */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <Label className="text-sm">
                  Skip during active maintenance
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  No auto-incident is opened while the system has an active
                  maintenance window with suppression.
                </p>
              </div>
              <Toggle
                checked={policy.skipDuringMaintenance}
                onCheckedChange={(checked: boolean) =>
                  onChange({ ...policy, skipDuringMaintenance: checked })
                }
                disabled={disabled}
                aria-label="Skip auto-incident during active maintenance"
              />
            </div>

            {/* Sustained-duration trigger */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Label className="text-sm">
                    Open when unhealthy continuously
                  </Label>
                  <Tooltip content="Catches real outages: the check has stayed unhealthy for at least this long without recovering." />
                </div>
                <Toggle
                  checked={policy.sustainedUnhealthyTrigger.enabled}
                  onCheckedChange={(checked: boolean) =>
                    onChange({
                      ...policy,
                      sustainedUnhealthyTrigger: {
                        ...policy.sustainedUnhealthyTrigger,
                        enabled: checked,
                      },
                    })
                  }
                  disabled={disabled}
                  aria-label="Enable sustained-unhealthy trigger"
                />
              </div>
              {policy.sustainedUnhealthyTrigger.enabled && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Open after</span>
                  <Input
                    type="number"
                    min={1}
                    className="h-8 w-16 text-center"
                    value={policy.sustainedUnhealthyTrigger.durationMinutes}
                    onChange={(e) =>
                      onChange({
                        ...policy,
                        sustainedUnhealthyTrigger: {
                          ...policy.sustainedUnhealthyTrigger,
                          durationMinutes:
                            Number.parseInt(e.target.value, 10) || 1,
                        },
                      })
                    }
                    disabled={disabled}
                  />
                  <span>minutes of continuous unhealthy state</span>
                </div>
              )}
            </div>

            {/* Flapping trigger */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Open on flapping</Label>
                  <Tooltip content="Catches checks that flip in and out of unhealthy too quickly for the sustained trigger to fire." />
                </div>
                <Toggle
                  checked={policy.flappingTrigger.enabled}
                  onCheckedChange={(checked: boolean) =>
                    onChange({
                      ...policy,
                      flappingTrigger: {
                        ...policy.flappingTrigger,
                        enabled: checked,
                      },
                    })
                  }
                  disabled={disabled}
                  aria-label="Enable flapping trigger"
                />
              </div>
              {policy.flappingTrigger.enabled && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Open after</span>
                  <Input
                    type="number"
                    min={1}
                    className="h-8 w-16 text-center"
                    value={policy.flappingTrigger.transitions}
                    onChange={(e) =>
                      onChange({
                        ...policy,
                        flappingTrigger: {
                          ...policy.flappingTrigger,
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
                    value={policy.flappingTrigger.windowMinutes}
                    onChange={(e) =>
                      onChange({
                        ...policy,
                        flappingTrigger: {
                          ...policy.flappingTrigger,
                          windowMinutes:
                            Number.parseInt(e.target.value, 10) || 1,
                        },
                      })
                    }
                    disabled={disabled}
                  />
                  <span>minutes</span>
                </div>
              )}
            </div>

            {/* Auto-close cooldown */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Auto-close cooldown</Label>
                <Tooltip content="Resolve the auto-incident once the system has stayed healthy for this long. Snapshotted per-incident at open time — later policy edits don't change in-flight incidents." />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policy.autoCloseAfterMinutes === null}
                    onChange={(e) =>
                      onChange({
                        ...policy,
                        autoCloseAfterMinutes: e.target.checked ? null : 30,
                      })
                    }
                    disabled={disabled}
                  />
                  <span>Never auto-close (manual resolve only)</span>
                </label>
                {policy.autoCloseAfterMinutes !== null && (
                  <div className="flex items-center gap-2">
                    <span>After</span>
                    <Input
                      type="number"
                      min={1}
                      className="h-8 w-16 text-center"
                      value={policy.autoCloseAfterMinutes}
                      onChange={(e) =>
                        onChange({
                          ...policy,
                          autoCloseAfterMinutes:
                            Number.parseInt(e.target.value, 10) || 1,
                        })
                      }
                      disabled={disabled}
                    />
                    <span>minutes of sustained healthy</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Save button hides when the assignment is inheriting — there
          is nothing to save. The Override button drives the transition
          into edit mode. */}
      {(!inheritanceMode || isOverridden) && (
        <div className="flex justify-end pt-2 border-t">
          <Button size="sm" onClick={onSave} disabled={disabled}>
            {saving ? "Saving..." : "Save Notifications"}
          </Button>
        </div>
      )}
    </div>
  );
};
