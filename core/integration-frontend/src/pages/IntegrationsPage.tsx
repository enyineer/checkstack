import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Webhook,
  ArrowRight,
  Activity,
  ChevronRight,
} from "lucide-react";
import {
  PageLayout,
  Card,
  CardContent,
  Button,
  Badge,
  SectionHeader,
  DynamicIcon,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@checkmate-monitor/ui";
import { useApi, rpcApiRef } from "@checkmate-monitor/frontend-api";
import { resolveRoute } from "@checkmate-monitor/common";
import {
  IntegrationApi,
  integrationRoutes,
  type WebhookSubscription,
  type IntegrationProviderInfo,
} from "@checkmate-monitor/integration-common";
import { CreateSubscriptionDialog } from "../components/CreateSubscriptionDialog";

export const IntegrationsPage = () => {
  const navigate = useNavigate();
  const rpcApi = useApi(rpcApiRef);
  const client = rpcApi.forPlugin(IntegrationApi);
  const toast = useToast();

  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [providers, setProviders] = useState<IntegrationProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Stats state
  const [stats, setStats] = useState<{
    total: number;
    successful: number;
    failed: number;
    retrying: number;
    pending: number;
  }>();

  const fetchData = useCallback(async () => {
    try {
      const [subsResult, providersResult, statsResult] = await Promise.all([
        client.listSubscriptions({ page: 1, pageSize: 100 }),
        client.listProviders(),
        client.getDeliveryStats({ hours: 24 }),
      ]);
      setSubscriptions(subsResult.subscriptions);
      setProviders(providersResult);
      setStats(statsResult);
    } catch (error) {
      console.error("Failed to load integrations data:", error);
      toast.error("Failed to load integrations data");
    } finally {
      setLoading(false);
    }
  }, [client, toast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const getProviderInfo = (
    providerId: string
  ): IntegrationProviderInfo | undefined => {
    return providers.find((p) => p.qualifiedId === providerId);
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await client.toggleSubscription({ id, enabled });
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, enabled } : s))
      );
      toast.success(enabled ? "Subscription enabled" : "Subscription disabled");
    } catch (error) {
      console.error("Failed to toggle subscription:", error);
      toast.error("Failed to toggle subscription");
    }
  };

  const handleCreated = (newSub: WebhookSubscription) => {
    setSubscriptions((prev) => [newSub, ...prev]);
    setCreateDialogOpen(false);
  };

  return (
    <PageLayout
      title="Integrations"
      subtitle="Configure webhooks to send events to external systems"
      loading={loading}
      actions={
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Subscription
        </Button>
      }
    >
      <div className="space-y-8">
        {/* Stats Overview */}
        {stats && (
          <section>
            <SectionHeader
              title="Delivery Activity (24h)"
              icon={<Activity className="h-5 w-5" />}
            />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold">{stats.total}</div>
                  <div className="text-sm text-muted-foreground">
                    Total Deliveries
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-green-600">
                    {stats.successful}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Successful
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-red-600">
                    {stats.failed}
                  </div>
                  <div className="text-sm text-muted-foreground">Failed</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-yellow-600">
                    {stats.retrying + stats.pending}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    In Progress
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        )}

        {/* Subscriptions List */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <SectionHeader
              title="Webhook Subscriptions"
              description="Subscriptions route events to external systems via providers"
              icon={<Webhook className="h-5 w-5" />}
            />
            <Link
              to={resolveRoute(integrationRoutes.routes.logs)}
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              View Delivery Logs
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {subscriptions.length === 0 ? (
            <EmptyState
              icon={<Webhook className="h-12 w-12" />}
              title="No webhook subscriptions"
              description="Create a subscription to start routing events to external systems"
            />
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subscription</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Events</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.map((sub) => {
                    const provider = getProviderInfo(sub.providerId);
                    return (
                      <TableRow
                        key={sub.id}
                        className="cursor-pointer"
                        onClick={() =>
                          navigate(
                            resolveRoute(integrationRoutes.routes.detail, {
                              id: sub.id,
                            })
                          )
                        }
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-muted">
                              <DynamicIcon
                                name={provider?.icon ?? "Webhook"}
                                className="h-5 w-5 text-muted-foreground"
                              />
                            </div>
                            <div>
                              <div className="font-medium">{sub.name}</div>
                              {sub.description && (
                                <div className="text-sm text-muted-foreground">
                                  {sub.description}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {provider?.displayName ?? sub.providerId}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {sub.eventId.split(".").pop()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={sub.enabled ? "success" : "secondary"}
                          >
                            {sub.enabled ? "Active" : "Disabled"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleToggle(sub.id, !sub.enabled);
                              }}
                            >
                              {sub.enabled ? "Disable" : "Enable"}
                            </Button>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}

          {subscriptions.length === 0 && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Subscription
              </Button>
            </div>
          )}
        </section>

        {/* Providers Overview */}
        <section>
          <SectionHeader
            title="Available Providers"
            description="Providers handle the delivery of events to external systems"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {providers.map((provider) => (
              <Card key={provider.qualifiedId}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-muted">
                        <DynamicIcon
                          name={provider.icon ?? "Webhook"}
                          className="h-6 w-6"
                        />
                      </div>
                      <div>
                        <div className="font-medium">
                          {provider.displayName}
                        </div>
                        {provider.description && (
                          <div className="text-sm text-muted-foreground">
                            {provider.description}
                          </div>
                        )}
                      </div>
                    </div>
                    {provider.hasConnectionSchema && (
                      <Link
                        to={resolveRoute(integrationRoutes.routes.connections, {
                          providerId: provider.qualifiedId,
                        })}
                        className="text-sm text-primary hover:underline"
                      >
                        Connections
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {providers.length === 0 && (
              <Card className="col-span-full">
                <CardContent className="p-4">
                  <div className="text-center text-muted-foreground py-4">
                    No providers registered. Install provider plugins to enable
                    webhook delivery.
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      </div>

      <CreateSubscriptionDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        providers={providers}
        onCreated={handleCreated}
      />
    </PageLayout>
  );
};
