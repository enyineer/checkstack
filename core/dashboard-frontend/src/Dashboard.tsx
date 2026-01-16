import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  useApi,
  usePluginClient,
  useQueryClient,
  ExtensionSlot,
} from "@checkstack/frontend-api";
import {
  CatalogApi,
  catalogRoutes,
  SystemStateBadgesSlot,
  System,
  Group,
} from "@checkstack/catalog-common";
import { resolveRoute } from "@checkstack/common";
import {
  NotificationApi,
  type EnrichedSubscription,
} from "@checkstack/notification-common";
import { IncidentApi } from "@checkstack/incident-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import { HEALTH_CHECK_RUN_COMPLETED } from "@checkstack/healthcheck-common";
import { useSignal } from "@checkstack/signal-frontend";
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
} from "@checkstack/ui";
import {
  LayoutGrid,
  Server,
  Activity,
  ChevronRight,
  AlertTriangle,
  Wrench,
  Terminal,
} from "lucide-react";
import { authApiRef } from "@checkstack/auth-frontend/api";
import { QueueLagAlert } from "@checkstack/queue-frontend";
import { SystemBadgeDataProvider } from "./components/SystemBadgeDataProvider";

const CATALOG_PLUGIN_ID = "catalog";
const MAX_TERMINAL_ENTRIES = 8;

interface GroupWithSystems extends Group {
  systems: System[];
}

const getGroupId = (groupId: string) => `${CATALOG_PLUGIN_ID}:${groupId}`;

const statusToVariant = (
  status: string
): "default" | "success" | "warning" | "error" => {
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
    default: {
      return "default";
    }
  }
};

export const Dashboard: React.FC = () => {
  const catalogClient = usePluginClient(CatalogApi);
  const notificationClient = usePluginClient(NotificationApi);
  const incidentClient = usePluginClient(IncidentApi);
  const maintenanceClient = usePluginClient(MaintenanceApi);

  const navigate = useNavigate();
  const toast = useToast();
  const authApi = useApi(authApiRef);
  const queryClient = useQueryClient();
  const { data: session } = authApi.useSession();

  // Terminal feed entries from real healthcheck signals
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);

  // Track per-group loading state for subscribe buttons
  const [subscriptionLoading, setSubscriptionLoading] = useState<
    Record<string, boolean>
  >({});

  // -------------------------------------------------------------------------
  // DATA QUERIES
  // -------------------------------------------------------------------------

  // Fetch entities from catalog (groups and systems in one call)
  const { data: entitiesData, isLoading: entitiesLoading } =
    catalogClient.getEntities.useQuery({}, { staleTime: 30_000 });
  const groups = entitiesData?.groups ?? [];
  const systems = entitiesData?.systems ?? [];

  // Fetch active incidents
  const { data: incidentsData, isLoading: incidentsLoading } =
    incidentClient.listIncidents.useQuery(
      { includeResolved: false },
      { staleTime: 30_000 }
    );
  const incidents = incidentsData?.incidents ?? [];

  // Fetch active maintenances
  const { data: maintenancesData, isLoading: maintenancesLoading } =
    maintenanceClient.listMaintenances.useQuery(
      { status: "in_progress" },
      { staleTime: 30_000 }
    );
  const maintenances = maintenancesData?.maintenances ?? [];

  // Fetch subscriptions (only when logged in)
  const { data: subscriptions = [] } =
    notificationClient.getSubscriptions.useQuery(
      {},
      { enabled: !!session, staleTime: 60_000 }
    );

  // Combined loading state
  const loading = entitiesLoading || incidentsLoading || maintenancesLoading;

  // -------------------------------------------------------------------------
  // MUTATIONS
  // -------------------------------------------------------------------------

  const subscribeMutation = notificationClient.subscribe.useMutation({
    onSuccess: () => {
      toast.success("Subscribed to group notifications");
      // Invalidate subscriptions query to refetch
      queryClient.invalidateQueries({ queryKey: ["notification"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to subscribe");
    },
  });

  const unsubscribeMutation = notificationClient.unsubscribe.useMutation({
    onSuccess: () => {
      toast.success("Unsubscribed from group notifications");
      queryClient.invalidateQueries({ queryKey: ["notification"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to unsubscribe");
    },
  });

  // -------------------------------------------------------------------------
  // COMPUTED DATA
  // -------------------------------------------------------------------------

  // Derived statistics
  const systemsCount = systems.length;
  const activeIncidentsCount = incidents.length;
  const activeMaintenancesCount = maintenances.length;

  // Map groups to include their systems
  const groupsWithSystems = useMemo<GroupWithSystems[]>(() => {
    const systemMap = new Map(systems.map((s) => [s.id, s]));
    return groups.map((group) => {
      const groupSystems = (group.systemIds || [])
        .map((id) => systemMap.get(id))
        .filter((s): s is System => s !== undefined);
      return { ...group, systems: groupSystems };
    });
  }, [groups, systems]);

  // -------------------------------------------------------------------------
  // SIGNAL HANDLERS
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // HANDLERS
  // -------------------------------------------------------------------------

  const handleSystemClick = (systemId: string) => {
    navigate(resolveRoute(catalogRoutes.routes.systemDetail, { systemId }));
  };

  const isSubscribed = (groupId: string) => {
    const fullId = getGroupId(groupId);
    return subscriptions.some(
      (s: EnrichedSubscription) => s.groupId === fullId
    );
  };

  const handleSubscribe = (groupId: string) => {
    const fullId = getGroupId(groupId);
    setSubscriptionLoading((prev) => ({ ...prev, [groupId]: true }));
    subscribeMutation.mutate(
      { groupId: fullId },
      {
        onSettled: () => {
          setSubscriptionLoading((prev) => ({ ...prev, [groupId]: false }));
        },
      }
    );
  };

  const handleUnsubscribe = (groupId: string) => {
    const fullId = getGroupId(groupId);
    setSubscriptionLoading((prev) => ({ ...prev, [groupId]: true }));
    unsubscribeMutation.mutate(
      { groupId: fullId },
      {
        onSettled: () => {
          setSubscriptionLoading((prev) => ({ ...prev, [groupId]: false }));
        },
      }
    );
  };

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------

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

    // Collect all system IDs for bulk data fetching
    const allSystemIds = groupsWithSystems.flatMap((g) =>
      g.systems.map((s) => s.id)
    );

    return (
      <SystemBadgeDataProvider systemIds={allSystemIds}>
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
      </SystemBadgeDataProvider>
    );
  };

  return (
    <>
      <div className="space-y-8 animate-in fade-in duration-500">
        {/* Queue Lag Warning */}
        <QueueLagAlert />

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
              title="checkstack status --watch"
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
