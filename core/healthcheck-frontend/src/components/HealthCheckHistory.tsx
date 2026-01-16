import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { HealthCheckApi } from "../api";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
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

export const HealthCheckHistory: React.FC<SlotProps> = (props) => {
  const { system, configurationId, limit } = props as Props;
  const systemId = system?.id;

  const healthCheckClient = usePluginClient(HealthCheckApi);

  // Fetch history with useQuery
  const { data, isLoading: loading } = healthCheckClient.getHistory.useQuery(
    { systemId, configurationId, limit },
    { enabled: true }
  );

  const history = data?.runs ?? [];

  if (loading) return <LoadingSpinner />;

  if (history.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No health check history found.
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((run) => (
            <TableRow key={run.id}>
              <TableCell>
                <HealthBadge status={run.status} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {run.timestamp
                  ? formatDistanceToNow(new Date(run.timestamp), {
                      addSuffix: true,
                    })
                  : "Unknown"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
