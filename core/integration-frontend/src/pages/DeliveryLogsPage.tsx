import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
} from "lucide-react";
import {
  PageLayout,
  Card,
  Button,
  Badge,
  SectionHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
  usePagination,
} from "@checkmate-monitor/ui";
import { useApi, rpcApiRef } from "@checkmate-monitor/frontend-api";
import { resolveRoute } from "@checkmate-monitor/common";
import {
  IntegrationApi,
  integrationRoutes,
  type DeliveryLog,
  type DeliveryStatus,
} from "@checkmate-monitor/integration-common";

const statusConfig: Record<
  DeliveryStatus,
  {
    icon: React.ReactNode;
    variant: "success" | "destructive" | "warning" | "secondary";
  }
> = {
  success: {
    icon: <CheckCircle className="h-4 w-4" />,
    variant: "success",
  },
  failed: {
    icon: <XCircle className="h-4 w-4" />,
    variant: "destructive",
  },
  retrying: {
    icon: <Clock className="h-4 w-4" />,
    variant: "warning",
  },
  pending: {
    icon: <AlertCircle className="h-4 w-4" />,
    variant: "secondary",
  },
};

export const DeliveryLogsPage = () => {
  const navigate = useNavigate();
  const rpcApi = useApi(rpcApiRef);
  const client = rpcApi.forPlugin(IntegrationApi);
  const toast = useToast();

  const [retrying, setRetrying] = useState<string>();

  const {
    items: logs,
    loading,
    pagination,
  } = usePagination({
    fetchFn: async ({ limit, offset }) => {
      const page = Math.floor(offset / limit) + 1;
      return client.getDeliveryLogs({ page, pageSize: limit });
    },
    getItems: (response) => response.logs,
    getTotal: (response) => response.total,
    defaultLimit: 20,
  });

  const handleRetry = async (logId: string) => {
    try {
      setRetrying(logId);
      const result = await client.retryDelivery({ logId });
      if (result.success) {
        toast.success("Delivery re-queued");
        pagination.refetch();
      } else {
        toast.error(result.message ?? "Failed to retry delivery");
      }
    } catch (error) {
      console.error("Failed to retry delivery:", error);
      toast.error("Failed to retry delivery");
    } finally {
      setRetrying(undefined);
    }
  };

  return (
    <PageLayout
      title="Delivery Logs"
      subtitle="View and manage webhook delivery attempts"
      loading={loading}
      actions={
        <Button
          variant="outline"
          onClick={() => navigate(resolveRoute(integrationRoutes.routes.list))}
        >
          Back to Subscriptions
        </Button>
      }
    >
      <div className="space-y-6">
        <section>
          <SectionHeader
            title="Recent Deliveries"
            description="All webhook delivery attempts across subscriptions"
            icon={<FileText className="h-5 w-5" />}
          />

          {logs.length === 0 && !loading ? (
            <Card className="p-8">
              <div className="text-center text-muted-foreground">
                No delivery logs found
              </div>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Subscription</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log: DeliveryLog) => {
                    const config = statusConfig[log.status];
                    return (
                      <TableRow key={log.id}>
                        <TableCell>
                          <Badge
                            variant={config.variant}
                            className="flex items-center gap-1 w-fit"
                          >
                            {config.icon}
                            {log.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">
                            {log.subscriptionName ?? "Unknown"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-mono">
                            {log.eventType}
                          </div>
                        </TableCell>
                        <TableCell>{log.attempts}</TableCell>
                        <TableCell>
                          <div className="text-sm text-muted-foreground">
                            {new Date(log.createdAt).toLocaleString()}
                          </div>
                        </TableCell>
                        <TableCell>
                          {log.errorMessage ? (
                            <div
                              className="text-sm text-destructive max-w-[200px] truncate"
                              title={log.errorMessage}
                            >
                              {log.errorMessage}
                            </div>
                          ) : undefined}
                        </TableCell>
                        <TableCell>
                          {log.status === "failed" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleRetry(log.id)}
                              disabled={retrying === log.id}
                            >
                              <RefreshCw
                                className={`h-4 w-4 mr-1 ${
                                  retrying === log.id ? "animate-spin" : ""
                                }`}
                              />
                              Retry
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {pagination.totalPages > 1 && (
                <div className="p-4 border-t flex justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pagination.hasPrev}
                    onClick={pagination.prevPage}
                  >
                    Previous
                  </Button>
                  <span className="flex items-center text-sm text-muted-foreground">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pagination.hasNext}
                    onClick={pagination.nextPage}
                  >
                    Next
                  </Button>
                </div>
              )}
            </Card>
          )}
        </section>
      </div>
    </PageLayout>
  );
};
