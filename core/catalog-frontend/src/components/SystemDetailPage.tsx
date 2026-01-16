import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  usePluginClient,
  ExtensionSlot,
  useApi,
} from "@checkstack/frontend-api";
import { Group, CatalogApi } from "../api";
import {
  SystemDetailsSlot,
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
} from "@checkstack/catalog-common";
import { NotificationApi } from "@checkstack/notification-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  LoadingSpinner,
  SubscribeButton,
  useToast,
  BackLink,
} from "@checkstack/ui";
import { authApiRef } from "@checkstack/auth-frontend/api";

import { Activity, Info, Users, FileJson, Calendar } from "lucide-react";

const CATALOG_PLUGIN_ID = "catalog";

export const SystemDetailPage: React.FC = () => {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const catalogClient = usePluginClient(CatalogApi);
  const notificationClient = usePluginClient(NotificationApi);
  const toast = useToast();
  const authApi = useApi(authApiRef);
  const { data: session } = authApi.useSession();

  const [groups, setGroups] = useState<Group[]>([]);
  const [notFound, setNotFound] = useState(false);

  // Subscription state
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);

  // Construct the full group ID for this system
  const getSystemGroupId = useCallback(() => {
    return `${CATALOG_PLUGIN_ID}.system.${systemId}`;
  }, [systemId]);

  // Fetch system data with useQuery
  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});

  // Fetch groups data with useQuery
  const { data: groupsData, isLoading: groupsLoading } =
    catalogClient.getGroups.useQuery({});

  // Find the system from the fetched data
  const system = systemsData?.systems.find((s) => s.id === systemId);
  const loading = systemsLoading || groupsLoading;

  // Fetch subscriptions with useQuery
  const { data: subscriptions, refetch: refetchSubscriptions } =
    notificationClient.getSubscriptions.useQuery({});

  // Subscribe/unsubscribe mutations
  const subscribeMutation = notificationClient.subscribe.useMutation({
    onSuccess: () => {
      setIsSubscribed(true);
      toast.success("Subscribed to system notifications");
      void refetchSubscriptions();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to subscribe"
      );
    },
  });

  const unsubscribeMutation = notificationClient.unsubscribe.useMutation({
    onSuccess: () => {
      setIsSubscribed(false);
      toast.success("Unsubscribed from system notifications");
      void refetchSubscriptions();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to unsubscribe"
      );
    },
  });

  // Update not found state
  useEffect(() => {
    if (!systemsLoading && !system && systemId) {
      setNotFound(true);
    }
  }, [system, systemsLoading, systemId]);

  // Update groups that contain this system
  useEffect(() => {
    if (groupsData && systemId) {
      const systemGroups = groupsData.filter((group) =>
        group.systemIds?.includes(systemId)
      );
      setGroups(systemGroups);
    }
  }, [groupsData, systemId]);

  // Update subscription status from query
  useEffect(() => {
    if (subscriptions && systemId) {
      const groupId = getSystemGroupId();
      const hasSubscription = subscriptions.some((s) => s.groupId === groupId);
      setIsSubscribed(hasSubscription);
      setSubscriptionLoading(false);
    }
  }, [subscriptions, systemId, getSystemGroupId]);

  const handleSubscribe = () => {
    setSubscriptionLoading(true);
    subscribeMutation.mutate({ groupId: getSystemGroupId() });
  };

  const handleUnsubscribe = () => {
    setSubscriptionLoading(true);
    unsubscribeMutation.mutate({ groupId: getSystemGroupId() });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner />
      </div>
    );
  }

  if (notFound || !system) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold text-foreground">
              System Not Found
            </h1>
          </div>
          <BackLink onClick={() => navigate("/")}>Back to Dashboard</BackLink>
        </div>
        <Card className="border-destructive/30 bg-destructive/10">
          <CardContent className="p-12 text-center">
            <p className="text-destructive">
              The system you're looking for doesn't exist or has been removed.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* System Name with Subscribe Button and Back Link */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold text-foreground">{system.name}</h1>
        </div>
        <div className="flex items-center gap-4">
          {session && (
            <SubscribeButton
              isSubscribed={isSubscribed}
              onSubscribe={handleSubscribe}
              onUnsubscribe={handleUnsubscribe}
              loading={
                subscriptionLoading ||
                subscribeMutation.isPending ||
                unsubscribeMutation.isPending
              }
            />
          )}
          <BackLink onClick={() => navigate("/")}>Back to Dashboard</BackLink>
        </div>
      </div>

      {/* Top Extension Slot for urgent items like maintenance alerts */}
      <ExtensionSlot slot={SystemDetailsTopSlot} context={{ system }} />

      {/* System Status Card - displays plugin-provided state badges */}
      <Card className="border-border shadow-sm">
        <CardHeader className="border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-semibold">
              System Status
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center gap-2">
            <ExtensionSlot slot={SystemStateBadgesSlot} context={{ system }} />
          </div>
        </CardContent>
      </Card>

      {/* System Information Card */}
      <Card className="border-border shadow-sm">
        <CardHeader className="border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-semibold">
              System Information
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Description
            </label>
            <p className="mt-1 text-foreground">
              {system.description || "No description provided"}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Owner
            </label>
            <p className="mt-1 text-foreground">
              {system.owner || "Not assigned"}
            </p>
          </div>
          <div className="flex gap-6 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                Created:{" "}
                {new Date(system.createdAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                Updated:{" "}
                {new Date(system.updatedAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Groups Card */}
      <Card className="border-border shadow-sm">
        <CardHeader className="border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-semibold">
              Member of Groups
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              This system is not part of any groups
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {groups.map((group) => (
                <span
                  key={group.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                >
                  {group.name}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metadata Card */}
      {system.metadata &&
        typeof system.metadata === "object" &&
        Object.keys(system.metadata).length > 0 && (
          <Card className="border-border shadow-sm">
            <CardHeader className="border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <FileJson className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg font-semibold">
                  Metadata
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <pre className="text-sm text-foreground bg-muted/30 p-4 rounded border border-border overflow-x-auto">
                {JSON.stringify(system.metadata, undefined, 2)}
              </pre>
            </CardContent>
          </Card>
        )}

      {/* Extension Slot for System Details */}
      <ExtensionSlot slot={SystemDetailsSlot} context={{ system }} />
    </div>
  );
};
