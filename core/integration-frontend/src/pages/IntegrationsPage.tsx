import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Webhook, ArrowRight, Activity } from "lucide-react";
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
  type LucideIconName,
} from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  IntegrationApi,
  integrationRoutes,
  type WebhookSubscription,
  type IntegrationProviderInfo,
} from "@checkstack/integration-common";
import { SubscriptionDialog } from "../components/CreateSubscriptionDialog";

export const IntegrationsPage = () => {
  const client = usePluginClient(IntegrationApi);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSubscription, setSelectedSubscription] =
    useState<WebhookSubscription>();

  // Queries using hooks
  const {
    data: subscriptionsData,
    isLoading: subsLoading,
    refetch: refetchSubs,
  } = client.listSubscriptions.useQuery({ page: 1, pageSize: 100 });

  const { data: providers = [], isLoading: providersLoading } =
    client.listProviders.useQuery({});

  const { data: stats, isLoading: statsLoading } =
    client.getDeliveryStats.useQuery({ hours: 24 });

  // Mutation for toggling
  const toggleMutation = client.toggleSubscription.useMutation({
    onSuccess: (_result, variables) => {
      toast.success(
        variables.enabled ? "Subscription enabled" : "Subscription disabled"
      );
      void refetchSubs();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to toggle subscription"
      );
    },
  });

  const subscriptions = subscriptionsData?.subscriptions ?? [];
  const loading = subsLoading || providersLoading || statsLoading;

  // Handle ?action=create URL parameter (from command palette)
  useEffect(() => {
    if (searchParams.get("action") === "create") {
      setSelectedSubscription(undefined);
      setDialogOpen(true);
      // Clear the URL param after opening
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const getProviderInfo = (
    providerId: string
  ): IntegrationProviderInfo | undefined => {
    return (providers as IntegrationProviderInfo[]).find(
      (p) => p.qualifiedId === providerId
    );
  };

  const handleToggle = (id: string, enabled: boolean) => {
    toggleMutation.mutate({ id, enabled });
  };

  const handleCreated = () => {
    void refetchSubs();
    setDialogOpen(false);
    setSelectedSubscription(undefined);
  };

  const handleUpdated = () => {
    void refetchSubs();
    setDialogOpen(false);
    setSelectedSubscription(undefined);
  };

  const handleDeleted = () => {
    void refetchSubs();
    setDialogOpen(false);
    setSelectedSubscription(undefined);
  };

  const openEditDialog = (sub: WebhookSubscription) => {
    setSelectedSubscription(sub);
    setDialogOpen(true);
  };

  const openCreateDialog = () => {
    setSelectedSubscription(undefined);
    setDialogOpen(true);
  };

  return (
    <PageLayout
      title="Integrations"
      subtitle="Configure webhooks to send events to external systems"
      loading={loading}
      actions={
        <Button onClick={openCreateDialog}>
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
                        onClick={() => openEditDialog(sub)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-muted">
                              <DynamicIcon
                                name={
                                  (provider?.icon ??
                                    "Webhook") as LucideIconName
                                }
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
                          <Badge variant="outline">{sub.eventId}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={sub.enabled ? "success" : "secondary"}
                          >
                            {sub.enabled ? "Active" : "Disabled"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggle(sub.id, !sub.enabled);
                            }}
                          >
                            {sub.enabled ? "Disable" : "Enable"}
                          </Button>
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
              <Button onClick={openCreateDialog}>
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
            {(providers as IntegrationProviderInfo[]).map((provider) => (
              <Card key={provider.qualifiedId}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-muted">
                        <DynamicIcon
                          name={(provider.icon ?? "Webhook") as LucideIconName}
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
            {(providers as IntegrationProviderInfo[]).length === 0 && (
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

      <SubscriptionDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setSelectedSubscription(undefined);
        }}
        providers={providers as IntegrationProviderInfo[]}
        subscription={selectedSubscription}
        onCreated={handleCreated}
        onUpdated={handleUpdated}
        onDeleted={handleDeleted}
      />
    </PageLayout>
  );
};
