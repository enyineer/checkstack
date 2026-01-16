import React from "react";
import {
  useApi,
  accessApiRef,
  usePluginClient,
} from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import {
  QueueApi,
  QUEUE_LAG_CHANGED,
  queueAccess,
  type LagSeverity,
} from "@checkstack/queue-common";
import { Alert, AlertTitle, AlertDescription } from "@checkstack/ui";
import { AlertTriangle, AlertCircle } from "lucide-react";

interface QueueLagAlertProps {
  /** Only show if user has queue settings access */
  requireAccess?: boolean;
}

/**
 * Displays a warning alert when queue is lagging (high pending jobs).
 * Uses signal for real-time updates + initial fetch via useQuery.
 */
export const QueueLagAlert: React.FC<QueueLagAlertProps> = ({
  requireAccess = true,
}) => {
  const accessApi = useApi(accessApiRef);
  const queueClient = usePluginClient(QueueApi);

  // Check access if required
  const { allowed, loading: accessLoading } = accessApi.useAccess(
    queueAccess.settings.read
  );

  // Fetch lag status via useQuery
  const { data: lagStatus, isLoading } = queueClient.getLagStatus.useQuery(
    undefined,
    {
      enabled: !requireAccess || allowed,
      staleTime: 30_000, // Cache for 30 seconds
    }
  );

  // State for real-time updates via signal
  const [signalData, setSignalData] = React.useState<
    | {
        pending: number;
        severity: LagSeverity;
      }
    | undefined
  >();

  // Listen for real-time lag updates
  useSignal(QUEUE_LAG_CHANGED, (payload) => {
    setSignalData({ pending: payload.pending, severity: payload.severity });
  });

  // Use signal data if available, otherwise use query data
  const pending = signalData?.pending ?? lagStatus?.pending ?? 0;
  const severity = signalData?.severity ?? lagStatus?.severity ?? "none";

  // Don't render if loading, no access, or no lag
  if (isLoading || accessLoading) {
    return;
  }

  if (requireAccess && !allowed) {
    return;
  }

  if (severity === "none") {
    return;
  }

  const variant = severity === "critical" ? "error" : "warning";
  const Icon = severity === "critical" ? AlertCircle : AlertTriangle;
  const title =
    severity === "critical" ? "Queue backlog critical" : "Queue building up";
  const description =
    severity === "critical"
      ? `${pending} jobs pending. Consider scaling or reducing load.`
      : `${pending} jobs pending. Some jobs may be delayed.`;

  return (
    <Alert variant={variant} className="mb-4">
      <Icon className="h-5 w-5" />
      <div>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </div>
    </Alert>
  );
};
