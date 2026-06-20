import { useState } from "react";
import { Send } from "lucide-react";
import {
  PageLayout,
  Button,
  Card,
  cn,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Alert,
  LoadingSpinner,
  EmptyState,
  ResponsiveTable,
  MobileCardList,
} from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { NotificationApi } from "@checkstack/notification-common";
import type { DeliveryAttempt } from "@checkstack/notification-common";
import { extractErrorMessage } from "@checkstack/common";
import { summarizeDeliveryAttempts } from "../components/notificationDisplay.logic";

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
  const isSuccess = status === "success";
  // Colorblind-safe status triad, multi-encoded with a dot + text label.
  const tone = isSuccess
    ? "bg-status-ok/10 text-status-ok"
    : "bg-status-down/10 text-status-down";
  const dot = isSuccess ? "bg-status-ok" : "bg-status-down";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      {isSuccess ? "Success" : "Failure"}
    </span>
  );
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
  const { successes, failures } = summarizeDeliveryAttempts({ attempts });

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
          <>
            {/* Number-led summary: this page exists to surface failures, so
                lead with the failure/success counts on the current page. */}
            <div className="grid grid-cols-2 gap-3 rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] sm:max-w-md">
              <div>
                <p
                  className={cn(
                    "text-3xl font-bold leading-none tabular-nums",
                    failures > 0 ? "text-status-down" : "text-foreground",
                  )}
                >
                  {failures}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">failures</p>
              </div>
              <div>
                <p className="text-3xl font-bold leading-none tabular-nums text-foreground">
                  {successes}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">successes</p>
              </div>
            </div>

            <ResponsiveTable className="rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] overflow-hidden">
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
                  {attempts.map((attempt) => {
                    const isFailure = attempt.status !== "success";
                    return (
                      <TableRow
                        key={attempt.id}
                        className={cn(
                          "transition-colors hover:bg-surface-inset",
                          isFailure && "bg-status-down/5",
                        )}
                      >
                        <TableCell
                          className={cn(
                            "whitespace-nowrap",
                            isFailure && "border-l-2 border-l-status-down",
                          )}
                        >
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
                    );
                  })}
                </TableBody>
              </Table>
            </ResponsiveTable>

            <MobileCardList>
              {attempts.map((attempt) => {
                const isFailure = attempt.status !== "success";
                return (
                  <Card
                    key={attempt.id}
                    className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-3 shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]"
                  >
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 w-1",
                        isFailure ? "bg-status-down" : "bg-status-ok",
                      )}
                      aria-hidden
                    />
                    <div className="pl-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-xs break-all">
                          {attempt.strategyQualifiedId}
                        </span>
                        <StatusBadge status={attempt.status} />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatAttemptedAt(attempt.attemptedAt)} -{" "}
                        {attempt.durationMs}ms
                      </div>
                      {attempt.errorMessage && (
                        <div
                          className="mt-1 text-xs text-muted-foreground"
                          title={attempt.errorMessage}
                        >
                          {truncate(attempt.errorMessage, ERROR_MESSAGE_MAX)}
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </MobileCardList>
          </>
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
