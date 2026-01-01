import { useState, useEffect, useCallback } from "react";
import { Bell, Clock } from "lucide-react";
import {
  PageLayout,
  Card,
  Button,
  useToast,
  SectionHeader,
  DynamicForm,
} from "@checkmate/ui";
import { useApi, rpcApiRef, permissionApiRef } from "@checkmate/frontend-api";
import type {
  EnrichedSubscription,
  NotificationClient,
} from "@checkmate/notification-common";
import { permissions } from "@checkmate/notification-common";

export const NotificationSettingsPage = () => {
  const rpcApi = useApi(rpcApiRef);
  const permissionApi = useApi(permissionApiRef);
  const notificationClient =
    rpcApi.forPlugin<NotificationClient>("notification");
  const toast = useToast();

  // Check if user has admin permission
  const { allowed: isAdmin } = permissionApi.usePermission(
    permissions.notificationAdmin.id
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

  // Subscription state - now uses enriched subscriptions only
  const [subscriptions, setSubscriptions] = useState<EnrichedSubscription[]>(
    []
  );
  const [subsLoading, setSubsLoading] = useState(true);

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

  useEffect(() => {
    void fetchRetentionData();
    void fetchSubscriptionData();
  }, [fetchRetentionData, fetchSubscriptionData]);

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

  return (
    <PageLayout title="Notification Settings" loading={subsLoading}>
      <div className="space-y-8">
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
                  />
                  <Button
                    onClick={() => {
                      void handleSaveRetention();
                    }}
                    disabled={retentionSaving}
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
