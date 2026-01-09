import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  useApi,
  rpcApiRef,
  ExtensionSlot,
} from "@checkmate-monitor/frontend-api";
import { catalogApiRef } from "@checkmate-monitor/catalog-frontend";
import {
  catalogRoutes,
  SystemStateBadgesSlot,
  System,
  Group,
} from "@checkmate-monitor/catalog-common";
import { resolveRoute } from "@checkmate-monitor/common";
import {
  NotificationApi,
  type EnrichedSubscription,
} from "@checkmate-monitor/notification-common";
import { IncidentApi } from "@checkmate-monitor/incident-common";
import { MaintenanceApi } from "@checkmate-monitor/maintenance-common";
import { HEALTH_CHECK_RUN_COMPLETED } from "@checkmate-monitor/healthcheck-common";
import { useSignal } from "@checkmate-monitor/signal-frontend";
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
  AnimatedCounter,
  TerminalFeed,
  type TerminalEntry,
} from "@checkmate-monitor/ui";
import {
  LayoutGrid,
  Server,
  Activity,
  ChevronRight,
  AlertTriangle,
  Wrench,
  Terminal,
} from "lucide-react";
import { authApiRef } from "@checkmate-monitor/auth-frontend/api";

const CATALOG_PLUGIN_ID = "catalog";
const MAX_TERMINAL_ENTRIES = 8;

const getGroupId = (groupId: string) => `${CATALOG_PLUGIN_ID}.group.${groupId}`;

interface GroupWithSystems extends Group {
  systems: System[];
}

// Map health check status to terminal entry variant
const statusToVariant = (
  status: "healthy" | "degraded" | "unhealthy"
): TerminalEntry["variant"] => {
  switch (status) {
    case "healthy": {
      return "success";
    }
    case "degraded": {
      return "warning";
    }
    case "unhealthy": {
      return "error";
    }
  }
};

export const Dashboard: React.FC = () => {
  const catalogApi = useApi(catalogApiRef);
  const rpcApi = useApi(rpcApiRef);
  const notificationApi = rpcApi.forPlugin(NotificationApi);
  const incidentApi = rpcApi.forPlugin(IncidentApi);
  const maintenanceApi = rpcApi.forPlugin(MaintenanceApi);
  const navigate = useNavigate();
  const toast = useToast();
  const authApi = useApi(authApiRef);
  const { data: session } = authApi.useSession();

  const [groupsWithSystems, setGroupsWithSystems] = useState<
    GroupWithSystems[]
  >([]);
  const [loading, setLoading] = useState(true);

  // Overview statistics state
  const [systemsCount, setSystemsCount] = useState(0);
  const [activeIncidentsCount, setActiveIncidentsCount] = useState(0);
  const [activeMaintenancesCount, setActiveMaintenancesCount] = useState(0);

  // Terminal feed entries from real healthcheck signals
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);

  // Subscription state
  const [subscriptions, setSubscriptions] = useState<EnrichedSubscription[]>(
    []
  );
  const [subscriptionLoading, setSubscriptionLoading] = useState<
    Record<string, boolean>
  >({});

  // Listen for health check runs and add to terminal feed
  useSignal(
    HEALTH_CHECK_RUN_COMPLETED,
    ({ systemName, configurationName, status, latencyMs }) => {
      const newEntry: TerminalEntry = {
        id: `${configurationName}-${Date.now()}`,
        timestamp: new Date(),
        content: `${systemName} (${configurationName}) → ${status}`,
        variant: statusToVariant(status),
        suffix: latencyMs === undefined ? undefined : `${latencyMs}ms`,
      };

      setTerminalEntries((prev) =>
        [newEntry, ...prev].slice(0, MAX_TERMINAL_ENTRIES)
      );
    }
  );

  useEffect(() => {
    if (session) {
      notificationApi.getSubscriptions().then(setSubscriptions);
    }
  }, [session, notificationApi]);

  useEffect(() => {
    Promise.all([
      catalogApi.getGroups(),
      catalogApi.getSystems(),
      incidentApi.listIncidents({ includeResolved: false }),
      maintenanceApi.listMaintenances({ status: "in_progress" }),
    ])
      .then(([groups, systems, incidents, maintenances]) => {
        // Set overview statistics
        setSystemsCount(systems.length);
        setActiveIncidentsCount(incidents.length);
        setActiveMaintenancesCount(maintenances.length);

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
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [catalogApi, incidentApi, maintenanceApi]);

  const handleSystemClick = (systemId: string) => {
    navigate(resolveRoute(catalogRoutes.routes.systemDetail, { systemId }));
  };

  const isSubscribed = (groupId: string) => {
    const fullId = getGroupId(groupId);
    return subscriptions.some((s) => s.groupId === fullId);
  };

  const handleSubscribe = useCallback(
    async (groupId: string) => {
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
    },
    [notificationApi, toast]
  );

  const handleUnsubscribe = useCallback(
    async (groupId: string) => {
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
    },
    [notificationApi, toast]
  );

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
                      : "grid-cols-1 sm:grid-cols-2"
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
    <>
      <div className="space-y-8 animate-in fade-in duration-500">
        {/* Overview Section */}
        <section>
          <SectionHeader
            title="Overview"
            icon={<Activity className="w-5 h-5" />}
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <StatusCard
              title="Total Systems"
              value={loading ? "..." : <AnimatedCounter value={systemsCount} />}
              description="Monitored systems in your catalog"
              icon={<Server className="w-4 h-4" />}
            />

            <StatusCard
              variant={activeIncidentsCount > 0 ? "gradient" : "default"}
              title="Active Incidents"
              value={
                loading ? (
                  "..."
                ) : (
                  <AnimatedCounter value={activeIncidentsCount} />
                )
              }
              description={
                activeIncidentsCount === 0
                  ? "All systems operating normally"
                  : "Unresolved issues requiring attention"
              }
              icon={<AlertTriangle className="w-4 h-4" />}
            />

            <StatusCard
              title="Active Maintenances"
              value={
                loading ? (
                  "..."
                ) : (
                  <AnimatedCounter value={activeMaintenancesCount} />
                )
              }
              description={
                activeMaintenancesCount === 0
                  ? "No scheduled maintenance"
                  : "Ongoing or scheduled maintenance windows"
              }
              icon={<Wrench className="w-4 h-4" />}
            />
          </div>
        </section>

        {/* Terminal Feed and System Groups - Two Column Layout */}
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Terminal Feed */}
          <section className="lg:col-span-1">
            <SectionHeader
              title="Recent Activity"
              icon={<Terminal className="w-5 h-5" />}
            />
            <TerminalFeed
              entries={terminalEntries}
              maxEntries={MAX_TERMINAL_ENTRIES}
              maxHeight="350px"
              title="checkmate status --watch"
            />
          </section>

          {/* System Groups */}
          <section className="lg:col-span-2">
            <SectionHeader
              title="System Groups"
              icon={<LayoutGrid className="w-5 h-5" />}
            />
            {renderGroupsContent()}
          </section>
        </div>
      </div>
    </>
  );
};
