import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi, rpcApiRef, ExtensionSlot } from "@checkmate/frontend-api";
import { catalogApiRef } from "@checkmate/catalog-frontend-plugin";
import {
  catalogRoutes,
  SystemStateBadgesSlot,
  System,
  Group,
} from "@checkmate/catalog-common";
import { resolveRoute } from "@checkmate/common";
import type {
  NotificationClient,
  EnrichedSubscription,
} from "@checkmate/notification-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  SectionHeader,
  StatusCard,
  EmptyState,
  LoadingSpinner,
  SubscribeButton,
  useToast,
} from "@checkmate/ui";
import { LayoutGrid, Info, Server, Activity, ChevronRight } from "lucide-react";
import { authApiRef } from "@checkmate/auth-frontend/api";

const CATALOG_PLUGIN_ID = "catalog";

const getGroupId = (groupId: string) => `${CATALOG_PLUGIN_ID}.group.${groupId}`;

interface GroupWithSystems extends Group {
  systems: System[];
}

export const Dashboard: React.FC = () => {
  const catalogApi = useApi(catalogApiRef);
  const rpcApi = useApi(rpcApiRef);
  const notificationApi = rpcApi.forPlugin<NotificationClient>("notification");
  const navigate = useNavigate();
  const toast = useToast();
  const authApi = useApi(authApiRef);
  const { data: session } = authApi.useSession();

  const [groupsWithSystems, setGroupsWithSystems] = useState<
    GroupWithSystems[]
  >([]);
  const [loading, setLoading] = useState(true);

  // Subscription state
  const [subscriptions, setSubscriptions] = useState<EnrichedSubscription[]>(
    []
  );
  const [subscriptionLoading, setSubscriptionLoading] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    Promise.all([
      catalogApi.getGroups(),
      catalogApi.getSystems(),
      notificationApi
        .getSubscriptions()
        .catch(() => [] as EnrichedSubscription[]),
    ])
      .then(([groups, systems, subs]) => {
        // Create a map of system IDs to systems
        const systemMap = new Map(systems.map((s) => [s.id, s]));

        // Map groups to include their systems
        const groupsData: GroupWithSystems[] = groups.map((group) => {
          const groupSystems = (group.systemIds || [])
            .map((id) => systemMap.get(id))
            .filter((s): s is System => s !== undefined);

          return {
            ...group,
            systems: groupSystems,
          };
        });

        setGroupsWithSystems(groupsData);
        setSubscriptions(subs);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [catalogApi, notificationApi]);

  const handleSystemClick = (systemId: string) => {
    navigate(resolveRoute(catalogRoutes.routes.systemDetail, { systemId }));
  };

  const isSubscribed = (groupId: string) => {
    const fullId = getGroupId(groupId);
    return subscriptions.some((s) => s.groupId === fullId);
  };

  const handleSubscribe = async (groupId: string) => {
    const fullId = getGroupId(groupId);
    setSubscriptionLoading((prev) => ({ ...prev, [groupId]: true }));
    try {
      await notificationApi.subscribe({ groupId: fullId });
      setSubscriptions((prev) => [
        ...prev,
        {
          groupId: fullId,
          groupName: "",
          groupDescription: "",
          ownerPlugin: CATALOG_PLUGIN_ID,
          subscribedAt: new Date(),
        },
      ]);
      toast.success("Subscribed to group notifications");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to subscribe";
      toast.error(message);
    } finally {
      setSubscriptionLoading((prev) => ({ ...prev, [groupId]: false }));
    }
  };

  const handleUnsubscribe = async (groupId: string) => {
    const fullId = getGroupId(groupId);
    setSubscriptionLoading((prev) => ({ ...prev, [groupId]: true }));
    try {
      await notificationApi.unsubscribe({ groupId: fullId });
      setSubscriptions((prev) => prev.filter((s) => s.groupId !== fullId));
      toast.success("Unsubscribed from group notifications");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to unsubscribe";
      toast.error(message);
    } finally {
      setSubscriptionLoading((prev) => ({ ...prev, [groupId]: false }));
    }
  };

  const renderGroupsContent = () => {
    if (loading) {
      return <LoadingSpinner />;
    }

    if (groupsWithSystems.length === 0) {
      return (
        <EmptyState
          title="No system groups found"
          description="Visit the Catalog to create your first group."
          icon={<Server className="w-12 h-12" />}
        />
      );
    }

    return (
      <div className="space-y-4">
        {groupsWithSystems.map((group) => (
          <Card
            key={group.id}
            className="border-border shadow-sm hover:shadow-md transition-shadow"
          >
            <CardHeader className="border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg font-semibold text-foreground">
                  {group.name}
                </CardTitle>
                <span className="ml-auto text-sm text-muted-foreground mr-2">
                  {group.systems.length}{" "}
                  {group.systems.length === 1 ? "system" : "systems"}
                </span>
                {session && (
                  <SubscribeButton
                    isSubscribed={isSubscribed(group.id)}
                    onSubscribe={() => handleSubscribe(group.id)}
                    onUnsubscribe={() => handleUnsubscribe(group.id)}
                    loading={subscriptionLoading[group.id] || false}
                  />
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {group.systems.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No systems in this group yet
                  </p>
                </div>
              ) : (
                <div
                  className={`grid gap-3 ${
                    group.systems.length === 1
                      ? "grid-cols-1"
                      : group.systems.length === 2
                      ? "grid-cols-1 sm:grid-cols-2"
                      : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                  }`}
                >
                  {group.systems.map((system) => (
                    <button
                      key={system.id}
                      onClick={() => handleSystemClick(system.id)}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-all cursor-pointer hover:border-border/80 hover:shadow-sm text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Activity className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <p className="text-sm font-medium text-foreground truncate">
                          {system.name}
                        </p>
                      </div>
                      <ExtensionSlot
                        slot={SystemStateBadgesSlot}
                        context={{ system }}
                      />
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <section>
        <SectionHeader
          title="Site Information"
          icon={<Info className="w-5 h-5" />}
        />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <StatusCard
            variant="gradient"
            title="Instance Status"
            value="Operational"
            description="Checkmate Core v0.0.1"
            icon={<Activity className="w-4 h-4 animate-pulse" />}
          />

          <StatusCard
            title="Region"
            value="eu-central-1"
            description="Frankfurt, Germany"
          />

          <StatusCard
            title="Environment"
            value="Production"
            description="Managed by Checkmate"
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="System Groups"
          icon={<LayoutGrid className="w-5 h-5" />}
        />
        {renderGroupsContent()}
      </section>
    </div>
  );
};
