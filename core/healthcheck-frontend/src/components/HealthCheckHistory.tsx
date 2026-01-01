import React, { useEffect, useState } from "react";
import { useApi, type SlotContext } from "@checkmate/frontend-api";
import { healthCheckApiRef, HealthCheckRun } from "../api";
import { SystemDetailsSlot } from "@checkmate/catalog-common";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  HealthBadge,
  LoadingSpinner,
} from "@checkmate/ui";
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

  const healthCheckApi = useApi(healthCheckApiRef);
  const [history, setHistory] = useState<HealthCheckRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // If it's used in a context that doesn't provide systemId or configurationId,
    // we might want to skip or handle it.
    healthCheckApi
      .getHistory({ systemId, configurationId, limit })
      .then(setHistory)
      .finally(() => setLoading(false));
  }, [healthCheckApi, systemId, configurationId, limit]);

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
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((run) => (
            <TableRow key={run.id || Math.random()}>
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
              <TableCell className="text-sm">
                {run.status === "unhealthy" && run.result?.error ? (
                  <span className="text-destructive font-medium">
                    {String(run.result.error)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {String(run.result?.message || "No additional info")}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
