import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Bell, Clock, Zap, Send, Activity } from "lucide-react";
import {
  PageLayout,
  Card,
  Button,
  useToast,
  toastError,
  toastSuccess,
  SectionHeader,
  DynamicForm,
} from "@checkstack/ui";
import {
  usePluginClient,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import type { EnrichedSubscription } from "@checkstack/notification-common";
import {
  NotificationApi,
  notificationAccess,
  notificationRoutes,
  pluginMetadata as notificationPluginMetadata,
} from "@checkstack/notification-common";
import { resolveRoute } from "@checkstack/common";
import { TipBanner } from "@checkstack/tips-frontend";
import {
  StrategyCard,
  type DeliveryStrategy,
} from "../components/StrategyCard";
import {
  UserChannelCard,
  type UserDeliveryChannel,
} from "../components/UserChannelCard";

export const NotificationSettingsPage = () => {
  const notificationClient = usePluginClient(NotificationApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  // Check if user has admin access
  const { allowed: isAdmin } = accessApi.useAccess(notificationAccess.admin);

  // Local state for editing
  const [retentionSettings, setRetentionSettings] = useState<
    Record<string, unknown>
  >({
    retentionDays: 30,
    enabled: false,
  });
  const [retentionValid, setRetentionValid] = useState(true);
  const [channelSaving, setChannelSaving] = useState<string | undefined>();
  const [channelConnecting, setChannelConnecting] = useState<
    string | undefined
  >();
  const [channelTesting, setChannelTesting] = useState<string | undefined>();
  const [strategySaving, setStrategySaving] = useState<string | undefined>();

  // Query: Retention schema (admin only)
  const { data: retentionSchema } =
    notificationClient.getRetentionSchema.useQuery({}, { enabled: isAdmin });

  // Query: Retention settings (admin only)
  const { data: fetchedRetentionSettings, isLoading: retentionLoading } =
    notificationClient.getRetentionSettings.useQuery({}, { enabled: isAdmin });

  // Query: Subscriptions
  const {
    data: subscriptions = [],
    isLoading: subsLoading,
    refetch: refetchSubscriptions,
  } = notificationClient.getSubscriptions.useQuery({});

  // Query: Delivery strategies (admin only)
  const {
    data: strategies = [],
    isLoading: strategiesLoading,
    refetch: refetchStrategies,
  } = notificationClient.getDeliveryStrategies.useQuery(
    {},
    { enabled: isAdmin },
  );

  // Query: User delivery channels
  const {
    data: userChannels = [],
    isLoading: channelsLoading,
    refetch: refetchChannels,
  } = notificationClient.getUserDeliveryChannels.useQuery({});

  // Sync fetched retention settings to local state
  useEffect(() => {
    if (fetchedRetentionSettings) {
      setRetentionSettings(fetchedRetentionSettings);
    }
  }, [fetchedRetentionSettings]);

  // Mutations
  const setRetentionMutation =
    notificationClient.setRetentionSettings.useMutation({
      onSuccess: () => {
        toastSuccess(toast, "Retention settings saved");
      },
      onError: (error) => {
        toastError(toast, "Failed to save settings", error);
      },
    });

  const unsubscribeMutation = notificationClient.unsubscribe.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "Unsubscribed successfully");
      void refetchSubscriptions();
    },
    onError: (error) => {
      toastError(toast, "Failed to unsubscribe", error);
    },
  });

  const updateStrategyMutation =
    notificationClient.updateDeliveryStrategy.useMutation({
      onSuccess: () => {
        toastSuccess(toast, "Updated delivery channel");
        void refetchStrategies();
        setStrategySaving(undefined);
      },
      onError: (error) => {
        toastError(toast, "Failed to update channel", error);
        setStrategySaving(undefined);
      },
    });

  const setUserPreferenceMutation =
    notificationClient.setUserDeliveryPreference.useMutation({
      onSuccess: () => {
        toastSuccess(toast, "Updated notification channel");
        void refetchChannels();
        setChannelSaving(undefined);
      },
      onError: (error) => {
        toastError(toast, "Failed to update preference", error);
        setChannelSaving(undefined);
      },
    });

  const unlinkChannelMutation =
    notificationClient.unlinkDeliveryChannel.useMutation({
      onSuccess: () => {
        toastSuccess(toast, "Disconnected notification channel");
        void refetchChannels();
        setChannelSaving(undefined);
      },
      onError: (error) => {
        toastError(toast, "Failed to disconnect", error);
        setChannelSaving(undefined);
      },
    });

  const getOAuthUrlMutation =
    notificationClient.getDeliveryOAuthUrl.useMutation({
      onSuccess: (data) => {
        globalThis.location.href = data.authUrl;
      },
      onError: (error) => {
        toastError(toast, "Failed to start OAuth flow", error);
        setChannelConnecting(undefined);
      },
    });

  const sendTestMutation = notificationClient.sendTestNotification.useMutation({
    onSuccess: (data) => {
      // The procedure resolves for both outcomes (a failed test returns
      // `{ success: false, error }` rather than throwing), so only toast on a
      // genuine pass - the card surfaces the copyable error for a failure.
      if (data.success) {
        toastSuccess(toast, "Test notification sent");
      }
    },
    onSettled: () => {
      setChannelTesting(undefined);
    },
  });

  const handleSaveRetention = () => {
    setRetentionMutation.mutate(
      retentionSettings as { enabled: boolean; retentionDays: number },
    );
  };

  const handleUnsubscribe = (groupId: string) => {
    unsubscribeMutation.mutate({ groupId });
  };

  const handleStrategyUpdate = async (
    strategyId: string,
    enabled: boolean,
    config?: Record<string, unknown>,
    layoutConfig?: Record<string, unknown>,
  ) => {
    setStrategySaving(strategyId);
    await updateStrategyMutation.mutateAsync({
      strategyId,
      enabled,
      config,
      layoutConfig,
    });
  };

  const handleChannelToggle = async (strategyId: string, enabled: boolean) => {
    setChannelSaving(strategyId);
    await setUserPreferenceMutation.mutateAsync({
      strategyId,
      enabled,
    });
  };

  const handleChannelConnect = async (strategyId: string) => {
    setChannelConnecting(strategyId);
    await getOAuthUrlMutation.mutateAsync({
      strategyId,
      returnUrl: globalThis.location.pathname,
    });
  };

  const handleChannelDisconnect = async (strategyId: string) => {
    setChannelSaving(strategyId);
    await unlinkChannelMutation.mutateAsync({ strategyId });
  };

  const handleChannelConfigSave = async (
    strategyId: string,
    userConfig: Record<string, unknown>,
  ) => {
    setChannelSaving(strategyId);
    const channel = userChannels.find((c) => c.strategyId === strategyId);
    await setUserPreferenceMutation.mutateAsync({
      strategyId,
      enabled: channel?.enabled ?? false,
      userConfig,
    });
  };

  const handleTest = async (strategyId: string) => {
    setChannelTesting(strategyId);
    return sendTestMutation.mutateAsync({ strategyId });
  };

  return (
    <PageLayout title="Notification Settings" icon={Bell} loading={subsLoading}>
      <div className="space-y-8">
        <TipBanner
          plugin={notificationPluginMetadata}
          id="settings.intro"
          title="Two pieces fit together: channels and subscriptions"
          description="A channel is how you'd like to be reached (Slack DM, email, Telegram, etc.). A subscription is what you want to be reached about (a system group, a specific incident severity). Connect at least one channel here, then subscribe from the dashboard or the system detail pages."
        />

        {/* Your Notification Channels - All users */}
        <section>
          <SectionHeader
            title="Your Notification Channels"
            description="Manage how you receive notifications. Connect accounts and enable/disable channels."
            icon={<Send className="h-5 w-5" />}
          />
          {channelsLoading ? (
            <Card className="p-4">
              <div className="text-center py-4 text-muted-foreground">
                Loading your channels...
              </div>
            </Card>
          ) : (userChannels as UserDeliveryChannel[]).length === 0 ? (
            <Card className="p-4">
              <div className="text-center py-4 text-muted-foreground">
                No notification channels available. Contact your administrator
                to enable delivery channels.
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              {(userChannels as UserDeliveryChannel[]).map((channel) => (
                <UserChannelCard
                  key={channel.strategyId}
                  channel={channel}
                  onToggle={handleChannelToggle}
                  onConnect={handleChannelConnect}
                  onDisconnect={handleChannelDisconnect}
                  onSaveConfig={handleChannelConfigSave}
                  onTest={handleTest}
                  saving={channelSaving === channel.strategyId}
                  connecting={channelConnecting === channel.strategyId}
                  testing={channelTesting === channel.strategyId}
                />
              ))}
            </div>
          )}
        </section>

        {/* Subscription Management - Shows current subscriptions */}
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

        {/* Admin Section Divider */}
        {isAdmin && (
          <div className="relative py-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-surface px-4 text-sm text-muted-foreground flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Admin Settings
              </span>
            </div>
          </div>
        )}

        {/* Delivery Channels - Admin only */}
        {isAdmin && (
          <section>
            <SectionHeader
              title="Delivery Channels"
              description="Configure how notifications are delivered to users (admin only)"
              icon={<Zap className="h-5 w-5" />}
            />
            {strategiesLoading ? (
              <Card className="p-4">
                <div className="text-center py-4 text-muted-foreground">
                  Loading delivery channels...
                </div>
              </Card>
            ) : (strategies as DeliveryStrategy[]).length === 0 ? (
              <Card className="p-4">
                <div className="text-center py-4 text-muted-foreground">
                  No delivery channels registered. Plugins can register delivery
                  strategies to enable additional notification methods.
                </div>
              </Card>
            ) : (
              <div className="space-y-3">
                {(strategies as DeliveryStrategy[]).map((strategy) => (
                  <StrategyCard
                    key={strategy.qualifiedId}
                    strategy={strategy}
                    onUpdate={handleStrategyUpdate}
                    saving={strategySaving === strategy.qualifiedId}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Delivery Attempts inspector link - Admin only */}
        {isAdmin && (
          <section>
            <SectionHeader
              title="Delivery Attempts"
              description="Inspect per-channel delivery outcomes for recent notifications (admin only)."
              icon={<Activity className="h-5 w-5" />}
            />
            <Card className="p-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  See every external `strategy.send(...)` outcome - useful
                  for debugging silent failures on misconfigured channels.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link
                    to={resolveRoute(
                      notificationRoutes.routes.deliveryAttempts,
                    )}
                  >
                    Open inspector
                  </Link>
                </Button>
              </div>
            </Card>
          </section>
        )}

        {/* Retention Policy - Admin only */}
        {isAdmin && retentionSchema && (
          <section>
            <SectionHeader
              title="Retention Policy"
              description="Configure how long notifications are kept (admin only)"
              icon={<Clock className="h-5 w-5" />}
            />
            <Card className="p-4">
              {retentionLoading ? (
                <div className="text-center py-4 text-muted-foreground">
                  Loading...
                </div>
              ) : (
                <div className="space-y-4">
                  <DynamicForm
                    schema={retentionSchema as Record<string, unknown>}
                    value={retentionSettings}
                    onChange={setRetentionSettings}
                    onValidChange={setRetentionValid}
                  />
                  <Button
                    onClick={handleSaveRetention}
                    disabled={setRetentionMutation.isPending || !retentionValid}
                  >
                    {setRetentionMutation.isPending
                      ? "Saving..."
                      : "Save Settings"}
                  </Button>
                </div>
              )}
            </Card>
          </section>
        )}
      </div>
    </PageLayout>
  );
};
