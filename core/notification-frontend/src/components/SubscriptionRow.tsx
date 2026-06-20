import React from "react";
import { Bell, BellOff, ChevronDown, ChevronRight } from "lucide-react";
import {
  Button,
  DynamicIcon,
  type LucideIconName,
  useToast,
  toastError,
} from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { NotificationApi } from "@checkstack/notification-common";
import {
  getSubscriptionSubControls,
  type SubscriptionSubControlsComponent,
} from "./SubscriptionSubControlsRegistry";

/**
 * Inheritance source enriched with display data. The row reveals these
 * as a small "Inherited from: …" hint when the user is reachable via a
 * parent group rather than a direct subscription.
 */
export interface ResolvedInheritance {
  groupId: string;
  label: string;
  /** True if the user is subscribed to this parent group. */
  subscribed: boolean;
}

export interface SubscriptionRowProps {
  /** specId — also the lookup key into the SubControls registry. */
  specId: string;
  /** Display fields lifted off the registered spec record. */
  title: string;
  description: string;
  iconName?: string;
  /**
   * The fully-resolved groupId for this (spec × resource). Computed by
   * the manager so the row doesn't need the spec object.
   */
  groupId: string;
  /**
   * The resource handed to the optional SubControls component (anomaly
   * mute list, etc.). Untyped here because the registry stores
   * components keyed by specId — the registering plugin owns the type
   * contract.
   */
  resource: unknown;
  /** Whether the current user is directly subscribed to `groupId`. */
  isDirectlySubscribed: boolean;
  /**
   * Pre-resolved inheritance sources. Optional, cosmetic — the backend
   * dispatcher already walks parent edges at notification time.
   */
  inheritance?: ResolvedInheritance[];
  /** Map of inherited groupId → subscribed?. Optional. */
  inheritanceStatus?: Record<string, boolean>;
  /** Re-fetch the surrounding status query after a successful toggle. */
  onToggled?: () => void;
}

/**
 * Generic row that powers every notification-subscription dialog row.
 * Owns the subscribe toggle, the inheritance hint, and the optional
 * sub-controls panel. Driven entirely by display fields from the
 * backend's spec registry — no ties to a slot extension.
 */
export function SubscriptionRow({
  specId,
  title,
  description,
  iconName,
  groupId,
  resource,
  isDirectlySubscribed,
  inheritance,
  inheritanceStatus,
  onToggled,
}: SubscriptionRowProps) {
  const notificationClient = usePluginClient(NotificationApi);
  const toast = useToast();
  const [expanded, setExpanded] = React.useState(false);

  const SubControls = getSubscriptionSubControls(specId) as
    | SubscriptionSubControlsComponent<unknown>
    | undefined;

  const inheritedActive = (inheritance ?? []).filter(
    (i) => inheritanceStatus?.[i.groupId],
  );
  const isReachable = isDirectlySubscribed || inheritedActive.length > 0;

  const subscribeMutation = notificationClient.subscribe.useMutation({
    onSuccess: () => onToggled?.(),
    onError: (error) =>
      toastError(toast, "Failed to subscribe to notifications", error),
  });
  const unsubscribeMutation = notificationClient.unsubscribe.useMutation({
    onSuccess: () => onToggled?.(),
    onError: (error) =>
      toastError(toast, "Failed to unsubscribe from notifications", error),
  });

  const isPending =
    subscribeMutation.isPending || unsubscribeMutation.isPending;

  const handleToggle = () => {
    if (isDirectlySubscribed) {
      unsubscribeMutation.mutate({ groupId });
    } else {
      subscribeMutation.mutate({ groupId });
    }
  };

  const ToggleIcon = isDirectlySubscribed ? BellOff : Bell;

  return (
    <div className="flex flex-col border-b last:border-b-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="shrink-0 rounded-md bg-muted/40 p-2 text-muted-foreground">
          {iconName ? (
            <DynamicIcon
              name={iconName as LucideIconName}
              className="h-4 w-4"
              fallback={Bell}
            />
          ) : (
            <Bell className="h-4 w-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
          {!isDirectlySubscribed && inheritedActive.length > 0 && (
            <div className="text-[11px] text-muted-foreground mt-1">
              Inherited from:{" "}
              {inheritedActive.map((i, idx) => (
                <React.Fragment key={i.groupId}>
                  {idx > 0 ? ", " : undefined}
                  <span className="font-medium">{i.label}</span>
                </React.Fragment>
              ))}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="ml-1 h-auto p-0 text-[11px]"
                disabled={isPending}
                onClick={handleToggle}
              >
                Override here
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {SubControls && isReachable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] gap-1"
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Details
            </Button>
          )}
          <Button
            type="button"
            variant={isDirectlySubscribed ? "outline" : "primary"}
            size="sm"
            className="h-7 px-2 text-[11px] gap-1"
            disabled={isPending}
            onClick={handleToggle}
          >
            <ToggleIcon className="h-3 w-3" />
            {isDirectlySubscribed ? "Unsubscribe" : "Subscribe"}
          </Button>
        </div>
      </div>
      {SubControls && isReachable && expanded && (
        <div className="px-4 pb-4 pt-1 border-t bg-muted/20">
          <SubControls resource={resource} groupId={groupId} />
        </div>
      )}
    </div>
  );
}
