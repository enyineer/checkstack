import { useState } from "react";
import { Send } from "lucide-react";
import {
  PageLayout,
  Badge,
  Button,
  Card,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Alert,
  LoadingSpinner,
  EmptyState,
} from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { NotificationApi } from "@checkstack/notification-common";
import type { DeliveryAttempt } from "@checkstack/notification-common";
import { extractErrorMessage } from "@checkstack/common";

const PAGE_SIZE = 25;
const ERROR_MESSAGE_MAX = 120;

/**
 * Truncate a sanitised error message to keep the table column tidy.
 * The full message is still available on hover via `title`.
 */
const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/**
 * Format an attempt timestamp as local-time with a relative hint.
 * Mirrors `NotificationsPage`'s `formatDate` voice without depending
 * on it (a tiny helper, not worth a shared util yet).
 */
const formatAttemptedAt = (raw: Date | string): string => {
  const d = new Date(raw);
  return d.toLocaleString();
};

const StatusBadge = ({ status }: { status: DeliveryAttempt["status"] }) => {
  if (status === "success") {
    return <Badge variant="success">Success</Badge>;
  }
  return <Badge variant="destructive">Failure</Badge>;
};

/**
 * Admin-only visibility surface for per-channel notification delivery
 * attempts. Shows the most recent attempts (newest first); failures
 * expose the silent-failure mode the dispatch loop swallowed pre-v1.
 *
 * Scope is intentionally minimal — no filter chips, charts, or
 * exports. Retries are deferred to v1.1; this is visibility only.
 */
export const DeliveryAttemptsPage = () => {
  const notificationClient = usePluginClient(NotificationApi);
  const [page, setPage] = useState(0);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = notificationClient.getDeliveryAttempts.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const attempts = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // No client-side `isAdmin` gate: the `getDeliveryAttempts` procedure
  // is locked behind `notificationAccess.admin` at the contract layer
  // (see `core/notification-common/src/rpc-contract.ts`). A caller
  // without the `notification:manage` access rule receives FORBIDDEN
  // from the server, which we render below via the standard
  // error-state branch. The nav entry is hidden cosmetically by the
  // existing access check on `NotificationSettingsPage` — security is
  // enforced by the contract, not the UI.
  return (
    <PageLayout title="Delivery Attempts" icon={Send}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Per-channel outcomes from the external notification dispatch
          loop. Failures are surfaced here so silent delivery breakage
          (misconfigured webhooks, dead channels) becomes actionable.
          Retries are not implemented yet - this is visibility only.
        </p>

        {isLoading ? (
          <Card className="p-8">
            <div className="flex justify-center">
              <LoadingSpinner size="md" />
            </div>
          </Card>
        ) : isError ? (
          <Alert variant="error">
            <div className="flex items-center justify-between gap-4">
              <span>
                Failed to load delivery attempts:{" "}
                {extractErrorMessage(error, "Unknown error")}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void refetch();
                }}
              >
                Retry
              </Button>
            </div>
          </Alert>
        ) : attempts.length === 0 ? (
          <EmptyState
            icon={<Send className="h-12 w-12" />}
            title="No delivery attempts yet"
            description="Once notifications are dispatched via an external channel, each attempt will appear here."
          />
        ) : (
          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attempted at</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attempts.map((attempt) => (
                  <TableRow key={attempt.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatAttemptedAt(attempt.attemptedAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {attempt.strategyQualifiedId}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={attempt.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {attempt.durationMs}ms
                    </TableCell>
                    <TableCell
                      className="max-w-md text-xs text-muted-foreground"
                      title={attempt.errorMessage ?? undefined}
                    >
                      {attempt.errorMessage
                        ? truncate(attempt.errorMessage, ERROR_MESSAGE_MAX)
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => {
                setPage((p) => Math.max(0, p - 1));
              }}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => {
                setPage((p) => p + 1);
              }}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </PageLayout>
  );
};
