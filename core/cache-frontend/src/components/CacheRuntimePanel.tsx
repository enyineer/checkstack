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
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabPanel,
} from "@checkstack/ui";
import {
  Activity,
  CheckCircle2,
  Database,
  HardDrive,
  ListOrdered,
  XCircle,
} from "lucide-react";

const REFRESH_INTERVAL_MS = 5000;
const PAGE_SIZE = 25;

type SortBy = "biggest" | "newest";

const formatNumber = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString(undefined, { maximumFractionDigits: 0 });

const formatBytes = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
};

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

const truncateMiddle = (s: string, head = 18, tail = 10) => {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
};

const formatTtl = (expiresAt: Date | null | undefined) => {
  if (!expiresAt) return "—";
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return "expired";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
};

interface StatTileProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}

const StatTile = ({ label, value, icon: Icon }: StatTileProps) => (
  <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
    <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  </div>
);

const EntriesTable = ({ sortBy }: { sortBy: SortBy }) => {
  const cacheClient = usePluginClient(CacheApi);
  const [page, setPage] = useState(1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data, isLoading, error } = cacheClient.listEntries.useQuery(
    { offset, limit: PAGE_SIZE, sortBy },
    { refetchInterval: REFRESH_INTERVAL_MS },
  );

  if (error) {
    return (
      <p className="text-sm text-destructive">Failed to load cache entries.</p>
    );
  }
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (data && !data.supported) {
    return (
      <p className="text-sm text-muted-foreground">
        Listing not supported by this cache backend.
      </p>
    );
  }
  if (!data || data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No cache entries.</p>;
  }

  const totalPages =
    data.total === null
      ? data.hasMore
        ? page + 1
        : page
      : Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead className="text-right">TTL</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((entry) => (
            <TableRow key={entry.key}>
              <TableCell
                className="font-mono text-xs whitespace-nowrap"
                title={entry.key}
              >
                {truncateMiddle(entry.key)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatBytes(entry.byteSize)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatTtl(entry.expiresAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        total={data.total ?? undefined}
        showTotal={data.total !== null}
      />
    </div>
  );
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
 * Cache Runtime panel. Counts on top, then a paginated table of keys
 * sorted by size or recency. Values never returned (PII risk).
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
              <StatTile
                label="Keys"
                value={isLoading ? "…" : formatNumber(data?.keyCount)}
                icon={Database}
              />
              <StatTile
                label="Memory"
                value={isLoading ? "…" : formatBytes(data?.sizeBytes)}
                icon={HardDrive}
              />
              <StatTile
                label="Hits"
                value={isLoading ? "…" : formatNumber(data?.hits)}
                icon={CheckCircle2}
              />
              <StatTile
                label="Hit rate"
                value={
                  isLoading ? "…" : formatHitRate(data?.hits, data?.misses)
                }
                icon={XCircle}
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
              <EntriesTable sortBy="biggest" />
            </TabPanel>
            <TabPanel id="newest" activeTab={sortBy}>
              <EntriesTable sortBy="newest" />
            </TabPanel>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
