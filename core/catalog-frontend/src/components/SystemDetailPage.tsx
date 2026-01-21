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
  PageLayout,
  SubscribeButton,
  useToast,
  BackLink,
} from "@checkstack/ui";
import { authApiRef } from "@checkstack/auth-frontend/api";

import {
  Activity,
  Info,
  Users,
  FileJson,
  Calendar,
  Mail,
  User,
} from "lucide-react";

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

  // Fetch contacts for this system
  const { data: contactsData } = catalogClient.getSystemContacts.useQuery(
    { systemId: systemId ?? "" },
    { enabled: !!systemId },
  );

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
        error instanceof Error ? error.message : "Failed to subscribe",
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
        error instanceof Error ? error.message : "Failed to unsubscribe",
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
        group.systemIds?.includes(systemId),
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

  // Actions for the page header
  const headerActions = (
    <div className="flex items-center gap-4 flex-wrap">
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
  );

  if (notFound) {
    return (
      <PageLayout
        title="System Not Found"
        icon={Activity}
        actions={headerActions}
      >
        <Card className="border-destructive/30 bg-destructive/10">
          <CardContent className="p-12 text-center">
            <p className="text-destructive">
              The system you're looking for doesn't exist or has been removed.
            </p>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  // Guard for TypeScript - PageLayout already handles loading state
  if (!system) {
    return;
  }

  return (
    <PageLayout
      title={system.name}
      icon={Activity}
      loading={loading}
      actions={headerActions}
      maxWidth="full"
    >
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

      {/* Contacts Card */}
      <Card className="border-border shadow-sm">
        <CardHeader className="border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-semibold">Contacts</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {!contactsData || contactsData.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No contacts assigned to this system
            </p>
          ) : (
            <div className="space-y-2">
              {contactsData.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center gap-2 text-sm"
                >
                  {contact.type === "user" ? (
                    <User className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Mail className="h-4 w-4 text-muted-foreground" />
                  )}
                  <a
                    href={`mailto:${contact.type === "user" ? contact.userEmail : contact.email}`}
                    className="text-primary hover:underline"
                  >
                    {contact.type === "user"
                      ? (contact.userName ?? contact.userId)
                      : contact.email}
                  </a>
                  {contact.label && (
                    <span className="text-muted-foreground">
                      ({contact.label})
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
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

      <ExtensionSlot slot={SystemDetailsSlot} context={{ system }} />
    </PageLayout>
  );
};
