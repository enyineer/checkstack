import { useState, useEffect } from "react";
import { Bell, Clock, Zap, Send } from "lucide-react";
import {
  PageLayout,
  Card,
  Button,
  useToast,
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
} from "@checkstack/notification-common";
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
    { enabled: isAdmin }
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
        toast.success("Retention settings saved");
      },
      onError: (error) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to save settings"
        );
      },
    });

  const unsubscribeMutation = notificationClient.unsubscribe.useMutation({
    onSuccess: () => {
      toast.success("Unsubscribed successfully");
      void refetchSubscriptions();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to unsubscribe"
      );
    },
  });

  const updateStrategyMutation =
    notificationClient.updateDeliveryStrategy.useMutation({
      onSuccess: () => {
        toast.success("Updated delivery channel");
        void refetchStrategies();
        setStrategySaving(undefined);
      },
      onError: (error) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to update channel"
        );
        setStrategySaving(undefined);
      },
    });

  const setUserPreferenceMutation =
    notificationClient.setUserDeliveryPreference.useMutation({
      onSuccess: () => {
        toast.success("Updated notification channel");
        void refetchChannels();
        setChannelSaving(undefined);
      },
      onError: (error) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to update preference"
        );
        setChannelSaving(undefined);
      },
    });

  const unlinkChannelMutation =
    notificationClient.unlinkDeliveryChannel.useMutation({
      onSuccess: () => {
        toast.success("Disconnected notification channel");
        void refetchChannels();
        setChannelSaving(undefined);
      },
      onError: (error) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to disconnect"
        );
        setChannelSaving(undefined);
      },
    });

  const getOAuthUrlMutation =
    notificationClient.getDeliveryOAuthUrl.useMutation({
      onSuccess: (data) => {
        globalThis.location.href = data.authUrl;
      },
      onError: (error) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to start OAuth flow"
        );
        setChannelConnecting(undefined);
      },
    });

  const sendTestMutation = notificationClient.sendTestNotification.useMutation({
    onSettled: () => {
      setChannelTesting(undefined);
    },
  });

  const handleSaveRetention = () => {
    setRetentionMutation.mutate(
      retentionSettings as { enabled: boolean; retentionDays: number }
    );
  };

  const handleUnsubscribe = (groupId: string) => {
    unsubscribeMutation.mutate({ groupId });
  };

  const handleStrategyUpdate = async (
    strategyId: string,
    enabled: boolean,
    config?: Record<string, unknown>,
    layoutConfig?: Record<string, unknown>
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
    userConfig: Record<string, unknown>
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
    <PageLayout title="Notification Settings" loading={subsLoading}>
      <div className="space-y-8">
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
          <Card className="p-4">
            {(subscriptions as EnrichedSubscription[]).length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                No active subscriptions
              </div>
            ) : (
              <div className="space-y-3">
                {(subscriptions as EnrichedSubscription[]).map((sub) => (
                  <div
                    key={sub.groupId}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div>
                      <div className="font-medium">{sub.groupName}</div>
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
                    >
                      Unsubscribe
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>

        {/* Admin Section Divider */}
        {isAdmin && (
          <div className="relative py-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-4 text-sm text-muted-foreground flex items-center gap-2">
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
