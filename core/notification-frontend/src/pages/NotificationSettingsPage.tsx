import { useState } from "react";
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
  useInitOnceForKey,
} from "@checkstack/ui";
import {
  usePluginClient,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
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

  // Query: Retention settings (admin only). gcTime: 0 so stale-while-revalidate
  // can't race the one-shot seed below and show pre-mutation values on reopen.
  const { data: fetchedRetentionSettings, isLoading: retentionLoading } =
    notificationClient.getRetentionSettings.useQuery(
      {},
      { enabled: isAdmin, gcTime: 0 },
    );

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

  // Seed the editable form once per load - a background refetch of the same
  // settings must not clobber in-progress edits.
  useInitOnceForKey(
    fetchedRetentionSettings,
    fetchedRetentionSettings ? "notification-retention-loaded" : null,
    (settings) => {
      setRetentionSettings(settings);
    },
  );

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
    <PageLayout title="Notification Settings" icon={Bell}>
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
