import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { HealthCheckApi } from "../api";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import type { HealthCheckRunPublic } from "@checkstack/healthcheck-common";
import {
  Card,
  DataTable,
  type DataTableColumn,
  HealthBadge,
  LoadingSpinner,
} from "@checkstack/ui";
import { formatDistanceToNow } from "date-fns";

// Props inferred from SystemDetailsSlot context, with optional additional props
type SlotProps = SlotContext<typeof SystemDetailsSlot>;
interface Props extends SlotProps {
  configurationId?: string;
  limit?: number;
}

const formatRunTime = (timestamp?: Date | null): string =>
  timestamp
    ? formatDistanceToNow(new Date(timestamp), { addSuffix: true })
    : "Unknown";

export const HealthCheckHistory: React.FC<SlotProps> = (props) => {
  const { system, configurationId, limit } = props as Props;
  const systemId = system?.id;

  const healthCheckClient = usePluginClient(HealthCheckApi);

  // Fetch history with useQuery - newest first for table view
  const { data, isLoading: loading } = healthCheckClient.getHistory.useQuery(
    { systemId, configurationId, limit, sortOrder: "desc" },
    { enabled: true },
  );

  const history = data?.runs ?? [];

  const columns: DataTableColumn<HealthCheckRunPublic>[] = [
    {
      id: "status",
      header: "Status",
      sortValue: (run) => run.status,
      cell: (run) => <HealthBadge status={run.status} />,
    },
    {
      id: "time",
      header: "Time",
      cellClassName: "text-sm text-muted-foreground",
      sortValue: (run) =>
        run.timestamp ? new Date(run.timestamp).getTime() : undefined,
      cell: (run) => formatRunTime(run.timestamp),
    },
  ];

  if (loading) return <LoadingSpinner />;

  if (history.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No health check history found.
      </p>
    );
  }

  return (
    <DataTable
      data={history}
      columns={columns}
      getRowId={(run) => run.id}
      searchable={false}
      defaultSort={{ columnId: "time", direction: "desc" }}
      renderMobileCard={(run) => (
        <Card className="flex flex-row items-center justify-between gap-2 p-3">
          <HealthBadge status={run.status} />
          <span className="text-xs text-muted-foreground">
            {formatRunTime(run.timestamp)}
          </span>
        </Card>
      )}
    />
  );
};
