import React, { useEffect, useState } from "react";
import { useApi } from "@checkmate/frontend-api";
import {
  catalogApiRef,
  Group,
  System,
} from "@checkmate/catalog-frontend-plugin";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  SectionHeader,
  StatusCard,
  EmptyState,
  LoadingSpinner,
  SystemHealthItem,
  HealthStatus,
} from "@checkmate/ui";
import { LayoutGrid, Info, Server, Activity } from "lucide-react";

// Mock health status generator based on system ID
const getHealthStatus = (systemId: string): HealthStatus => {
  // Simple hash function to get consistent but pseudo-random status
  let hash = 0;
  for (let i = 0; i < systemId.length; i++) {
    hash = (hash << 5) - hash + (systemId.codePointAt(i) ?? 0);
    hash = hash & hash;
  }
  const value = Math.abs(hash) % 10;

  if (value < 7) return "healthy"; // 70% healthy
  if (value < 9) return "degraded"; // 20% degraded
  return "unhealthy"; // 10% unhealthy
};

// Mock metadata generator
const getMockMetadata = (systemId: string) => {
  const hash = [...systemId].reduce(
    (acc, char) => acc + (char.codePointAt(0) ?? 0),
    0
  );
  const latency = 50 + (hash % 200); // Latency between 50-250ms
  const now = new Date();
  const lastCheckMinutes = hash % 10; // Last check 0-9 minutes ago
  now.setMinutes(now.getMinutes() - lastCheckMinutes);

  return {
    latency,
    lastCheck: `${lastCheckMinutes}m ago`,
  };
};

interface GroupWithSystems extends Group {
  systems: System[];
}

export const Dashboard: React.FC = () => {
  const catalogApi = useApi(catalogApiRef);
  const [groupsWithSystems, setGroupsWithSystems] = useState<
    GroupWithSystems[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([catalogApi.getGroups(), catalogApi.getSystems()])
      .then(([groups, systems]) => {
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
  }, [catalogApi]);

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
            className="border-gray-200 shadow-sm hover:shadow-md transition-shadow"
          >
            <CardHeader className="border-b border-gray-100 bg-gray-50/50">
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-5 w-5 text-gray-600" />
                <CardTitle className="text-lg font-semibold text-gray-900">
                  {group.name}
                </CardTitle>
                <span className="ml-auto text-sm text-gray-500">
                  {group.systems.length}{" "}
                  {group.systems.length === 1 ? "system" : "systems"}
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {group.systems.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-gray-500">
                    No systems in this group yet
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.systems.map((system) => (
                    <SystemHealthItem
                      key={system.id}
                      name={system.name}
                      status={getHealthStatus(system.id)}
                      metadata={getMockMetadata(system.id)}
                    />
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
