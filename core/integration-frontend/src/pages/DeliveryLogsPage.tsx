import { useState } from "react";
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
  usePaginationSync,
  BackLink,
} from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  IntegrationApi,
  integrationRoutes,
  type DeliveryLog,
  type DeliveryStatus,
} from "@checkstack/integration-common";

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
  const integrationClient = usePluginClient(IntegrationApi);
  const toast = useToast();

  const [retrying, setRetrying] = useState<string>();

  // Pagination state
  const pagination = usePagination({ defaultLimit: 20 });

  // Fetch data with useQuery
  const page = Math.floor(pagination.offset / pagination.limit) + 1;
  const { data, isLoading, refetch } =
    integrationClient.getDeliveryLogs.useQuery({
      page,
      pageSize: pagination.limit,
    });

  // Sync total from response
  usePaginationSync(pagination, data?.total);

  const logs = data?.logs ?? [];

  // Retry mutation
  const retryMutation = integrationClient.retryDelivery.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success("Delivery re-queued");
        void refetch();
      } else {
        toast.error(result.message ?? "Failed to retry delivery");
      }
    },
    onError: (error) => {
      console.error("Failed to retry delivery:", error);
      toast.error("Failed to retry delivery");
    },
    onSettled: () => {
      setRetrying(undefined);
    },
  });

  const handleRetry = (logId: string) => {
    setRetrying(logId);
    retryMutation.mutate({ logId });
  };

  return (
    <PageLayout
      title="Delivery Logs"
      subtitle="View and manage webhook delivery attempts"
      loading={isLoading}
      actions={
        <BackLink to={resolveRoute(integrationRoutes.routes.list)}>
          Back to Subscriptions
        </BackLink>
      }
    >
      <div className="space-y-6">
        <section>
          <SectionHeader
            title="Recent Deliveries"
            description="All webhook delivery attempts across subscriptions"
            icon={<FileText className="h-5 w-5" />}
          />

          {logs.length === 0 && !isLoading ? (
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
                              onClick={() => handleRetry(log.id)}
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
