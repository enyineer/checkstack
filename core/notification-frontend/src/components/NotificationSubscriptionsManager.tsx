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
  cn,
} from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  NotificationApi,
  subscriptionGroupId,
  type NotificationTarget,
} from "@checkstack/notification-common";
import { extractErrorMessage } from "@checkstack/common";
import { SubscriptionRow } from "./SubscriptionRow";

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

  const groupIds = React.useMemo(
    () => specs.map((s) => subscriptionGroupId(s, resourceKey)),
    [specs, resourceKey],
  );

  const { data: statusMap = {}, refetch: refetchStatus } =
    notificationClient.getMySubscriptionStatus.useQuery(
      { groupIds },
      { enabled: groupIds.length > 0, staleTime: 30_000 },
    );

  const subscribedCount = groupIds.filter((id) => statusMap[id]).length;
  const totalCount = groupIds.length;
  const allSubscribed = totalCount > 0 && subscribedCount === totalCount;
  const anySubscribed = subscribedCount > 0;

  const subscribeMutation = notificationClient.subscribe.useMutation();
  const unsubscribeMutation = notificationClient.unsubscribe.useMutation();
  const isPending =
    subscribeMutation.isPending || unsubscribeMutation.isPending;

  const handleSubscribeAll = async () => {
    try {
      await Promise.all(
        groupIds
          .filter((id) => !statusMap[id])
          .map((groupId) => subscribeMutation.mutateAsync({ groupId })),
      );
      toast.success(`Subscribed to all notifications for ${resourceLabel}`);
      void refetchStatus();
    } catch (error) {
      toast.error(extractErrorMessage(error, "Failed to subscribe to all"));
    }
  };

  const handleUnsubscribeAll = async () => {
    try {
      await Promise.all(
        groupIds
          .filter((id) => statusMap[id])
          .map((groupId) => unsubscribeMutation.mutateAsync({ groupId })),
      );
      toast.success(
        `Unsubscribed from all notifications for ${resourceLabel}`,
      );
      void refetchStatus();
    } catch (error) {
      toast.error(
        extractErrorMessage(error, "Failed to unsubscribe from all"),
      );
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
              <Bell className="h-4 w-4" />
              Notifications for {resourceLabel}
            </DialogTitle>
            <DialogDescription>
              Choose which notification types you want to receive for
              this {target.resourceKind}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {totalCount === 0 ? (
              <div className="rounded-md border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                No notification types are available for this{" "}
                {target.resourceKind} yet.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 p-3">
                  <div className="text-sm min-w-0">
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
                        <BellOff className="mr-1 h-3 w-3" />
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
                        <BellRing className="mr-1 h-3 w-3" />
                        Subscribe to all
                      </Button>
                    )}
                  </div>
                </div>
                <div className="overflow-hidden rounded-md border border-border">
                  {specs.map((spec) => {
                    const groupId = subscriptionGroupId(spec, resourceKey);
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
