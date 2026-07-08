import { Bell } from "lucide-react";
import {
  PageLayout,
  Card,
  Button,
  useToast,
  toastError,
  toastSuccess,
  SectionHeader,
} from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import type { EnrichedSubscription } from "@checkstack/notification-common";
import {
  NotificationApi,
  pluginMetadata as notificationPluginMetadata,
} from "@checkstack/notification-common";
import { TipBanner } from "@checkstack/tips-frontend";

/**
 * Your Subscriptions - a subscription is WHAT you want to be reached about
 * (a system group, a specific incident severity). Extracted onto its own route
 * + nav entry, off the (admin-heavy) notification settings page.
 */
export const NotificationSubscriptionsPage = () => {
  const notificationClient = usePluginClient(NotificationApi);
  const toast = useToast();

  // Query: Subscriptions
  const { data: subscriptions = [], isLoading: subsLoading } =
    notificationClient.getSubscriptions.useQuery({});

  // Mutation: unsubscribe. The oRPC mutation already invalidates the owning
  // plugin's queries on success, so no manual refetch is needed here.
  const unsubscribeMutation = notificationClient.unsubscribe.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "Unsubscribed successfully");
    },
    onError: (error) => {
      toastError(toast, "Failed to unsubscribe", error);
    },
  });

  const handleUnsubscribe = (groupId: string) => {
    unsubscribeMutation.mutate({ groupId });
  };

  return (
    <PageLayout
      title="Your Subscriptions"
      icon={Bell}
      loading={subsLoading}
    >
      <div className="space-y-8">
        <TipBanner
          plugin={notificationPluginMetadata}
          id="subscriptions.intro"
          title="Subscriptions decide what reaches you"
          description="A subscription is what you want to be reached about (a system group, a specific incident severity). Subscriptions are created from the dashboard or the system detail pages, then managed here. Configure how you are reached under Notification Settings."
        />

        <section>
          <SectionHeader
            title="Your Subscriptions"
            description="Manage your notification subscriptions. Subscriptions are created by plugins and services."
            icon={<Bell className="h-5 w-5" />}
          />
          {(subscriptions as EnrichedSubscription[]).length === 0 ? (
            <Card className="p-4">
              <div className="text-center py-4 text-muted-foreground">
                No active subscriptions
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              {(subscriptions as EnrichedSubscription[]).map((sub) => (
                <div
                  key={sub.groupId}
                  className="group relative flex items-center justify-between gap-4 overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      {sub.groupName}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {sub.groupDescription}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      From: {sub.ownerPlugin}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUnsubscribe(sub.groupId)}
                    disabled={unsubscribeMutation.isPending}
                    className="shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                  >
                    Unsubscribe
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </PageLayout>
  );
};
