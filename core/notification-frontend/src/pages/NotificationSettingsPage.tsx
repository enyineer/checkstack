import { useState, useEffect, useCallback } from "react";
import { Bell, Clock, Zap, Send } from "lucide-react";
import {
  PageLayout,
  Card,
  Button,
  useToast,
  SectionHeader,
  DynamicForm,
} from "@checkstack/ui";
import { useApi, rpcApiRef, accessApiRef } from "@checkstack/frontend-api";
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
  const rpcApi = useApi(rpcApiRef);
  const accessApi = useApi(accessApiRef);
  const notificationClient = rpcApi.forPlugin(NotificationApi);
  const toast = useToast();

  // Check if user has admin access
  const { allowed: isAdmin } = accessApi.useAccess(
    notificationAccess.admin
  );

  // Retention settings state
  const [retentionSchema, setRetentionSchema] = useState<
    Record<string, unknown> | undefined
  >();
  const [retentionSettings, setRetentionSettings] = useState<
    Record<string, unknown>
  >({
    retentionDays: 30,
    enabled: false,
  });
  const [retentionLoading, setRetentionLoading] = useState(true);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionValid, setRetentionValid] = useState(true);

  // Subscription state - now uses enriched subscriptions only
  const [subscriptions, setSubscriptions] = useState<EnrichedSubscription[]>(
    []
  );
  const [subsLoading, setSubsLoading] = useState(true);

  // Delivery strategies state (admin only)
  const [strategies, setStrategies] = useState<DeliveryStrategy[]>([]);
  const [strategiesLoading, setStrategiesLoading] = useState(true);
  const [strategySaving, setStrategySaving] = useState<string | undefined>();

  // User channels state
  const [userChannels, setUserChannels] = useState<UserDeliveryChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelSaving, setChannelSaving] = useState<string | undefined>();
  const [channelConnecting, setChannelConnecting] = useState<
    string | undefined
  >();
  const [channelTesting, setChannelTesting] = useState<string | undefined>();

  // Fetch retention settings and schema (admin only)
  const fetchRetentionData = useCallback(async () => {
    if (!isAdmin) {
      setRetentionLoading(false);
      return;
    }
    try {
      const [schema, settings] = await Promise.all([
        notificationClient.getRetentionSchema(),
        notificationClient.getRetentionSettings(),
      ]);
      setRetentionSchema(schema as Record<string, unknown>);
      setRetentionSettings(settings);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load retention settings";
      toast.error(message);
    } finally {
      setRetentionLoading(false);
    }
  }, [notificationClient, isAdmin, toast]);

  // Fetch subscriptions only (no groups needed)
  const fetchSubscriptionData = useCallback(async () => {
    try {
      const subsData = await notificationClient.getSubscriptions();
      setSubscriptions(subsData);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch subscriptions";
      toast.error(message);
    } finally {
      setSubsLoading(false);
    }
  }, [notificationClient, toast]);

  // Fetch delivery strategies (admin only)
  const fetchStrategies = useCallback(async () => {
    if (!isAdmin) {
      setStrategiesLoading(false);
      return;
    }
    try {
      const data = await notificationClient.getDeliveryStrategies();
      setStrategies(data as DeliveryStrategy[]);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load delivery channels";
      toast.error(message);
    } finally {
      setStrategiesLoading(false);
    }
  }, [notificationClient, isAdmin, toast]);

  // Fetch user delivery channels
  const fetchUserChannels = useCallback(async () => {
    try {
      const data = await notificationClient.getUserDeliveryChannels();
      setUserChannels(data as UserDeliveryChannel[]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load your channels";
      toast.error(message);
    } finally {
      setChannelsLoading(false);
    }
  }, [notificationClient, toast]);

  useEffect(() => {
    void fetchRetentionData();
    void fetchSubscriptionData();
    void fetchStrategies();
    void fetchUserChannels();
  }, [
    fetchRetentionData,
    fetchSubscriptionData,
    fetchStrategies,
    fetchUserChannels,
  ]);

  const handleSaveRetention = async () => {
    try {
      setRetentionSaving(true);
      await notificationClient.setRetentionSettings(
        retentionSettings as { enabled: boolean; retentionDays: number }
      );
      toast.success("Retention settings saved");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save settings";
      toast.error(message);
    } finally {
      setRetentionSaving(false);
    }
  };

  const handleUnsubscribe = async (groupId: string) => {
    try {
      await notificationClient.unsubscribe({ groupId });
      setSubscriptions((prev) => prev.filter((s) => s.groupId !== groupId));
      toast.success("Unsubscribed successfully");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to unsubscribe";
      toast.error(message);
    }
  };

  // Handle strategy update (enabled state and config)
  const handleStrategyUpdate = async (
    strategyId: string,
    enabled: boolean,
    config?: Record<string, unknown>,
    layoutConfig?: Record<string, unknown>
  ) => {
    try {
      setStrategySaving(strategyId);
      await notificationClient.updateDeliveryStrategy({
        strategyId,
        enabled,
        config,
        layoutConfig,
      });
      // Update local state
      setStrategies((prev) =>
        prev.map((s) =>
          s.qualifiedId === strategyId
            ? { ...s, enabled, config, layoutConfig }
            : s
        )
      );
      toast.success(`${enabled ? "Enabled" : "Disabled"} delivery channel`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update channel";
      toast.error(message);
    } finally {
      setStrategySaving(undefined);
    }
  };

  // Handle user channel toggle
  const handleChannelToggle = async (strategyId: string, enabled: boolean) => {
    try {
      setChannelSaving(strategyId);
      await notificationClient.setUserDeliveryPreference({
        strategyId,
        enabled,
      });
      setUserChannels((prev) =>
        prev.map((c) => (c.strategyId === strategyId ? { ...c, enabled } : c))
      );
      toast.success(`${enabled ? "Enabled" : "Disabled"} notification channel`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update preference";
      toast.error(message);
    } finally {
      setChannelSaving(undefined);
    }
  };

  // Handle OAuth connect
  const handleChannelConnect = async (strategyId: string) => {
    try {
      setChannelConnecting(strategyId);
      const { authUrl } = await notificationClient.getDeliveryOAuthUrl({
        strategyId,
        returnUrl: globalThis.location.pathname,
      });
      // Redirect to OAuth provider
      globalThis.location.href = authUrl;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start OAuth flow";
      toast.error(message);
      setChannelConnecting(undefined);
    }
  };

  // Handle OAuth disconnect
  const handleChannelDisconnect = async (strategyId: string) => {
    try {
      setChannelSaving(strategyId);
      await notificationClient.unlinkDeliveryChannel({ strategyId });
      setUserChannels((prev) =>
        prev.map((c) =>
          c.strategyId === strategyId
            ? { ...c, linkedAt: undefined, enabled: false, isConfigured: false }
            : c
        )
      );
      toast.success("Disconnected notification channel");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to disconnect";
      toast.error(message);
    } finally {
      setChannelSaving(undefined);
    }
  };

  // Handle user config save
  const handleChannelConfigSave = async (
    strategyId: string,
    userConfig: Record<string, unknown>
  ) => {
    try {
      setChannelSaving(strategyId);
      await notificationClient.setUserDeliveryPreference({
        strategyId,
        enabled:
          userChannels.find((c) => c.strategyId === strategyId)?.enabled ??
          false,
        userConfig,
      });
      setUserChannels((prev) =>
        prev.map((c) =>
          c.strategyId === strategyId
            ? { ...c, userConfig, isConfigured: true }
            : c
        )
      );
      toast.success("Saved channel settings");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save settings";
      toast.error(message);
    } finally {
      setChannelSaving(undefined);
    }
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
          ) : userChannels.length === 0 ? (
            <Card className="p-4">
              <div className="text-center py-4 text-muted-foreground">
                No notification channels available. Contact your administrator
                to enable delivery channels.
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              {userChannels.map((channel) => (
                <UserChannelCard
                  key={channel.strategyId}
                  channel={channel}
                  onToggle={handleChannelToggle}
                  onConnect={handleChannelConnect}
                  onDisconnect={handleChannelDisconnect}
                  onSaveConfig={handleChannelConfigSave}
                  onTest={async (strategyId) => {
                    setChannelTesting(strategyId);
                    try {
                      const result =
                        await notificationClient.sendTestNotification({
                          strategyId,
                        });
                      if (!result.success) {
                        alert(`Test failed: ${result.error}`);
                      }
                      return result;
                    } finally {
                      setChannelTesting(undefined);
                    }
                  }}
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
            {subscriptions.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                No active subscriptions
              </div>
            ) : (
              <div className="space-y-3">
                {subscriptions.map((sub) => (
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
                      onClick={() => void handleUnsubscribe(sub.groupId)}
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
            ) : strategies.length === 0 ? (
              <Card className="p-4">
                <div className="text-center py-4 text-muted-foreground">
                  No delivery channels registered. Plugins can register delivery
                  strategies to enable additional notification methods.
                </div>
              </Card>
            ) : (
              <div className="space-y-3">
                {strategies.map((strategy) => (
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
                    schema={retentionSchema}
                    value={retentionSettings}
                    onChange={setRetentionSettings}
                    onValidChange={setRetentionValid}
                  />
                  <Button
                    onClick={() => {
                      void handleSaveRetention();
                    }}
                    disabled={retentionSaving || !retentionValid}
                  >
                    {retentionSaving ? "Saving..." : "Save Settings"}
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
