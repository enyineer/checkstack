import React from "react";
import type { NotificationPolicy } from "@checkstack/healthcheck-common";
import { Button, Label, Toggle, Tooltip } from "@checkstack/ui";

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
 *
 * Auto-incident opening/closing is no longer configured here: it ships
 * as ordinary user automations. Flapping thresholds likewise moved onto
 * the automation engine's windowed-count gate (the
 * `healthcheck.system_health_changed` trigger's `window` block). What
 * remains is the de-escalation notification preference.
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
          check.
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
                - this check ignores the platform defaults.
              </>
            ) : (
              <>
                <span className="font-medium">Using platform defaults</span>{" "}
                - fields below are read-only. Click Override to customise
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
      <div className="p-4 bg-surface-inset rounded-lg border space-y-3">
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
