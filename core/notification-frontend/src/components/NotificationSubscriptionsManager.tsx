import React from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  useToast,
  toastError,
  toastSuccess,
  cn,
} from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  NotificationApi,
  subscriptionGroupId,
  pluginMetadata as notificationPluginMetadata,
  type NotificationTarget,
} from "@checkstack/notification-common";
import { Tip } from "@checkstack/tips-frontend";
import { SubscriptionRow } from "./SubscriptionRow";
import {
  collectStatusGroupIds,
  buildRowInheritance,
} from "./subscriptionInheritance.logic";
import { useBulkSubscriptionStatusOptional } from "./BulkSubscriptionStatusProvider";

export interface NotificationSubscriptionsManagerProps<TResource> {
  /**
   * The notification target — typed handle on a kind of resource.
   * Drives which subscription specs the dialog enumerates.
   */
  target: NotificationTarget<TResource>;
  /**
   * The specific resource (e.g. a system or group object). Forwarded
   * to per-spec sub-control panels via the SubControls registry.
   */
  resource: TResource;
  /** Trigger size; defaults to icon-only Bell button. */
  triggerSize?: "default" | "sm" | "lg" | "icon";
  triggerClassName?: string;
}

/**
 * Single component used on every "manage notifications for this
 * resource" surface. The dialog enumerates registered subscription
 * specs *from the backend's spec registry* (single source of truth) —
 * so a row appears for every spec the platform knows about, not just
 * the ones a frontend plugin remembered to wire up. Sub-controls
 * (e.g. anomaly's per-field mute) attach via the
 * `registerSubscriptionSubControls` registry, keyed by specId.
 */
export function NotificationSubscriptionsManager<TResource>({
  target,
  resource,
  triggerSize = "icon",
  triggerClassName,
}: NotificationSubscriptionsManagerProps<TResource>) {
  const [open, setOpen] = React.useState(false);
  const notificationClient = usePluginClient(NotificationApi);
  const bulkStatus = useBulkSubscriptionStatusOptional();
  const toast = useToast();

  const resourceKey = target.keyOf(resource);
  const resourceLabel = target.labelOf(resource);

  const { data: allSpecs = [] } =
    notificationClient.listSubscriptionSpecs.useQuery(
      {},
      { staleTime: 60_000 },
    );

  const specs = React.useMemo(
    () => allSpecs.filter((s) => s.targetTypeId === target.targetTypeId),
    [allSpecs, target.targetTypeId],
  );

  const primaryGroupIds = React.useMemo(
    () => specs.map((s) => subscriptionGroupId(s, resourceKey)),
    [specs, resourceKey],
  );

  // Structural parent-group inheritance for this resource (e.g. a system's
  // parent catalog groups). Same answer for every user; the per-user
  // subscribed flags come from the status batch below.
  //
  // Only fetched while the dialog is open: it is consumed solely inside the
  // dialog (to fold parent-group ids into the status batch and render the
  // inheritance hint rows). The collapsed bell trigger's fill/variant derives
  // exclusively from primaryGroupIds - with empty inheritance,
  // collectStatusGroupIds returns exactly primaryGroupIds - so gating this
  // avoids an N+M multi-round-trip query storm now that a bell mounts on every
  // system row and group header of the catalog browse page.
  const { data: inheritance = [] } =
    notificationClient.resolveSubscriptionInheritance.useQuery(
      { targetTypeId: target.targetTypeId, resourceKey },
      { enabled: open, staleTime: 60_000 },
    );

  // Fetch subscription status for BOTH the primary groups and every
  // inherited parent group in one batch, so each row can show whether the
  // user is reachable directly or via a parent group.
  const groupIds = React.useMemo(
    () => collectStatusGroupIds({ primaryGroupIds, inheritance }),
    [primaryGroupIds, inheritance],
  );

  // When a bulk provider (catalog browse view) covers every primary group id
  // and the dialog is CLOSED, the collapsed trigger derives its state entirely
  // from the shared bulk query - so this bell fires NO request of its own,
  // eliminating the browse view's per-bell N+1. Otherwise (no provider, or the
  // dialog is OPEN and needs the inheritance-augmented statusMap) the bell keeps
  // its own per-bell query unchanged. `activeBulk` narrows to a non-null context
  // only in the collapsed-and-fully-covered case, so no non-null assertion is
  // needed downstream.
  const activeBulk =
    !open &&
    bulkStatus !== null &&
    primaryGroupIds.length > 0 &&
    primaryGroupIds.every((id) => bulkStatus.covers(id))
      ? bulkStatus
      : null;

  const { data: statusMap = {}, refetch: refetchStatus } =
    notificationClient.getMySubscriptionStatus.useQuery(
      { groupIds },
      { enabled: groupIds.length > 0 && activeBulk === null, staleTime: 30_000 },
    );

  // Subscribed flag for a primary group id: from the shared bulk query when the
  // collapsed trigger is covered by a provider, otherwise from this bell's own
  // status batch. The rendered collapsed state is identical either way - only
  // the data SOURCE changes.
  const isSubscribed = (id: string): boolean =>
    activeBulk ? (activeBulk.getStatus(id) ?? false) : (statusMap[id] ?? false);

  // The header summary and "subscribe/unsubscribe to all" act on the
  // PRIMARY (resource-level) groups only - inherited parent subscriptions
  // are managed at the parent resource's own bell.
  const subscribedCount = primaryGroupIds.filter((id) =>
    isSubscribed(id),
  ).length;
  const totalCount = primaryGroupIds.length;
  const allSubscribed = totalCount > 0 && subscribedCount === totalCount;
  const anySubscribed = subscribedCount > 0;

  const subscribeMutation = notificationClient.subscribe.useMutation();
  const unsubscribeMutation = notificationClient.unsubscribe.useMutation();
  const isPending =
    subscribeMutation.isPending || unsubscribeMutation.isPending;

  const handleSubscribeAll = async () => {
    try {
      await Promise.all(
        primaryGroupIds
          .filter((id) => !statusMap[id])
          .map((groupId) => subscribeMutation.mutateAsync({ groupId })),
      );
      toastSuccess(toast, `Subscribed to all notifications for ${resourceLabel}`);
      void refetchStatus();
    } catch (error) {
      toastError(toast, "Failed to subscribe to all", error);
    }
  };

  const handleUnsubscribeAll = async () => {
    try {
      await Promise.all(
        primaryGroupIds
          .filter((id) => statusMap[id])
          .map((groupId) => unsubscribeMutation.mutateAsync({ groupId })),
      );
      toastSuccess(toast, `Unsubscribed from all notifications for ${resourceLabel}`);
      void refetchStatus();
    } catch (error) {
      toastError(toast, "Failed to unsubscribe from all", error);
    }
  };

  const TriggerIcon = anySubscribed ? BellRing : Bell;

  return (
    <>
      <Button
        type="button"
        variant={anySubscribed ? "primary" : "ghost"}
        size={triggerSize}
        onClick={() => setOpen(true)}
        className={cn(
          "transition-all duration-200",
          !anySubscribed && "text-muted-foreground hover:text-foreground",
          triggerClassName,
        )}
        title={`Manage notifications for ${resourceLabel}`}
        aria-label={`Manage notifications for ${resourceLabel}`}
      >
        <TriggerIcon
          className={cn("h-4 w-4", anySubscribed && "fill-current")}
          aria-hidden="true"
        />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="w-4 h-4" />
              Notifications for {resourceLabel}
              <Tip
                plugin={notificationPluginMetadata}
                id="subscriptions.intro"
                title="How notification subscriptions work"
                description={
                  <div className="space-y-2">
                    <p>
                      <strong>System vs. group.</strong> Subscribing to a system
                      means you'll only hear about that one thing. Subscribing
                      to a group means you'll hear about every system inside
                      that group - useful if a teammate adds new systems later,
                      since the group covers them automatically.
                    </p>
                    <p>
                      <strong>All vs. specific types.</strong> Each row below is
                      a different kind of event (incidents, anomalies, …). Use
                      “Subscribe to all” at the top to opt in to everything, or
                      toggle rows individually if you only care about, say,
                      critical incidents.
                    </p>
                    <p>
                      Where things actually reach you (Slack, email, Telegram,
                      …) is configured once in <em>Notification Settings</em>{" "}
                      and applies to every subscription.
                    </p>
                  </div>
                }
                side="bottom"
                align="start"
                contentClassName="w-96"
              >
                <span className="sr-only">Subscription help</span>
              </Tip>
            </DialogTitle>
            <DialogDescription>
              Choose which notification types you want to receive for this{" "}
              {target.resourceKind}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {totalCount === 0 ? (
              <div className="p-4 text-sm border rounded-md border-border bg-muted/20 text-muted-foreground">
                No notification types are available for this{" "}
                {target.resourceKind} yet.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 p-3 border rounded-md border-border bg-muted/20">
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">
                      {subscribedCount} of {totalCount} subscribed
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Toggle every notification type at once.
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {allSubscribed ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        onClick={handleUnsubscribeAll}
                      >
                        <BellOff className="w-3 h-3 mr-1" />
                        Unsubscribe from all
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={isPending}
                        onClick={handleSubscribeAll}
                      >
                        <BellRing className="w-3 h-3 mr-1" />
                        Subscribe to all
                      </Button>
                    )}
                  </div>
                </div>
                <div className="overflow-hidden border rounded-md border-border">
                  {specs.map((spec) => {
                    const groupId = subscriptionGroupId(spec, resourceKey);
                    const rowInheritance = buildRowInheritance({
                      specId: spec.specId,
                      inheritance,
                      statusMap,
                    });
                    return (
                      <SubscriptionRow
                        key={spec.specId}
                        specId={spec.specId}
                        title={spec.display.title}
                        description={spec.display.description}
                        iconName={spec.display.iconName}
                        groupId={groupId}
                        resource={resource}
                        isDirectlySubscribed={statusMap[groupId] ?? false}
                        inheritance={rowInheritance.inheritance}
                        inheritanceStatus={rowInheritance.inheritanceStatus}
                        onToggled={() => void refetchStatus()}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
