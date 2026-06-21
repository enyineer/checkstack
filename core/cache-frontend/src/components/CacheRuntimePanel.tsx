import { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { CacheApi } from "@checkstack/cache-common";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  InstanceScopeBanner,
  Tabs,
  TabPanel,
  formatBytes,
  formatNumber,
} from "@checkstack/ui";
import {
  Activity,
  CheckCircle2,
  Database,
  HardDrive,
  ListOrdered,
  Target,
} from "lucide-react";
import { HitRateHero, SupportingTile } from "./CacheRuntimeStats";
import { CacheEntriesTable } from "./CacheEntriesTable";

const REFRESH_INTERVAL_MS = 5000;

type SortBy = "biggest" | "newest";

const formatCount = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : formatNumber(n);

const formatSize = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : formatBytes(n);

const formatHitRate = (
  hits: number | null | undefined,
  misses: number | null | undefined,
) => {
  if (hits === null || hits === undefined) return "—";
  if (misses === null || misses === undefined) return "—";
  const total = hits + misses;
  if (total === 0) return "—";
  return `${((hits / total) * 100).toFixed(1)}%`;
};

const SUB_TABS = [
  {
    id: "biggest",
    label: "Biggest",
    icon: <ListOrdered className="h-4 w-4" />,
  },
  {
    id: "newest",
    label: "Newest",
    icon: <ListOrdered className="h-4 w-4" />,
  },
] as const;

/**
 * Cache Runtime panel. A number-led hit-rate hero plus supporting counts on
 * top, then a paginated table of keys sorted by size or recency. Values are
 * never returned (PII risk).
 */
export const CacheRuntimePanel = () => {
  const cacheClient = usePluginClient(CacheApi);
  const { data, isLoading, error } = cacheClient.getRuntimeStats.useQuery(
    undefined,
    { refetchInterval: REFRESH_INTERVAL_MS },
  );
  const [sortBy, setSortBy] = useState<SortBy>("biggest");

  return (
    <div className="space-y-4">
      <InstanceScopeBanner
        scope={data?.scope ?? "instance"}
        subject="Cache"
        recommendation="Switch to a clustered cache (e.g. Redis) for cluster-wide visibility."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Cache Runtime
          </CardTitle>
          <CardDescription>
            {data?.pluginId ? (
              <>
                Active provider:{" "}
                <code className="text-xs">{data.pluginId}</code>. Refreshes
                every {REFRESH_INTERVAL_MS / 1000}s. Backends that can&apos;t
                report a metric cheaply show &quot;—&quot;.
              </>
            ) : (
              <>Refreshes every {REFRESH_INTERVAL_MS / 1000}s.</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error ? (
            <div className="text-sm text-destructive">
              Failed to load cache stats.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <HitRateHero
                value={
                  isLoading ? "…" : formatHitRate(data?.hits, data?.misses)
                }
                icon={Target}
              />
              <SupportingTile
                label="Keys"
                value={isLoading ? "…" : formatCount(data?.keyCount)}
                icon={Database}
              />
              <SupportingTile
                label="Memory"
                value={isLoading ? "…" : formatSize(data?.sizeBytes)}
                icon={HardDrive}
              />
              <SupportingTile
                label="Hits"
                value={isLoading ? "…" : formatCount(data?.hits)}
                icon={CheckCircle2}
              />
            </div>
          )}

          <div className="space-y-3">
            <Tabs
              items={SUB_TABS.map((t) => ({
                id: t.id,
                label: t.label,
                icon: t.icon,
              }))}
              activeTab={sortBy}
              onTabChange={(id) => setSortBy(id as SortBy)}
            />
            <TabPanel id="biggest" activeTab={sortBy}>
              <CacheEntriesTable sortBy="biggest" />
            </TabPanel>
            <TabPanel id="newest" activeTab={sortBy}>
              <CacheEntriesTable sortBy="newest" />
            </TabPanel>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
