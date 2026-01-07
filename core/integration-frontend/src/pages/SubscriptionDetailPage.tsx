import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Settings, Trash2, Save } from "lucide-react";
import {
  PageLayout,
  Card,
  CardContent,
  Button,
  DynamicForm,
  SectionHeader,
  useToast,
  ConfirmationModal,
  Input,
  Textarea,
} from "@checkmate-monitor/ui";
import { useApi, rpcApiRef } from "@checkmate-monitor/frontend-api";
import { resolveRoute } from "@checkmate-monitor/common";
import {
  IntegrationApi,
  integrationRoutes,
  type WebhookSubscription,
  type IntegrationProviderInfo,
  type IntegrationEventInfo,
  type PayloadProperty,
} from "@checkmate-monitor/integration-common";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
} from "@checkmate-monitor/ui";

export const SubscriptionDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const rpcApi = useApi(rpcApiRef);
  const client = rpcApi.forPlugin(IntegrationApi);
  const toast = useToast();

  const [subscription, setSubscription] = useState<WebhookSubscription>();
  const [providers, setProviders] = useState<IntegrationProviderInfo[]>([]);
  const [events, setEvents] = useState<IntegrationEventInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [providerConfig, setProviderConfig] = useState<Record<string, unknown>>(
    {}
  );
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [payloadProperties, setPayloadProperties] = useState<PayloadProperty[]>(
    []
  );

  const fetchData = useCallback(async () => {
    if (!id) return;

    try {
      const [sub, providersResult, eventsResult] = await Promise.all([
        client.getSubscription({ id }),
        client.listProviders(),
        client.listEventTypes(),
      ]);

      setSubscription(sub);
      setProviders(providersResult);
      setEvents(eventsResult);

      // Populate form
      setName(sub.name);
      setDescription(sub.description ?? "");
      setProviderConfig(sub.providerConfig);
      setSelectedEventId(sub.eventId);
    } catch (error) {
      console.error("Failed to load subscription:", error);
      toast.error("Failed to load subscription");
      navigate(resolveRoute(integrationRoutes.routes.list));
    } finally {
      setLoading(false);
    }
  }, [id, client, navigate, toast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Fetch payload schema when event changes
  useEffect(() => {
    if (!selectedEventId) {
      setPayloadProperties([]);
      return;
    }

    const fetchPayloadSchema = async () => {
      try {
        const result = await client.getEventPayloadSchema({
          eventId: selectedEventId,
        });
        setPayloadProperties(result.availableProperties);
      } catch (error) {
        console.error("Failed to fetch payload schema:", error);
        setPayloadProperties([]);
      }
    };

    void fetchPayloadSchema();
  }, [selectedEventId, client]);

  const provider = providers.find(
    (p) => p.qualifiedId === subscription?.providerId
  );

  const handleSave = async () => {
    if (!id || !subscription) return;

    try {
      setSaving(true);
      await client.updateSubscription({
        id,
        updates: {
          name,
          description: description || undefined,
          providerConfig,
          eventId:
            selectedEventId === subscription.eventId
              ? undefined
              : selectedEventId,
        },
      });
      toast.success("Subscription updated");
    } catch (error) {
      console.error("Failed to update subscription:", error);
      toast.error("Failed to update subscription");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;

    try {
      await client.deleteSubscription({ id });
      toast.success("Subscription deleted");
      navigate(resolveRoute(integrationRoutes.routes.list));
    } catch (error) {
      console.error("Failed to delete subscription:", error);
      toast.error("Failed to delete subscription");
    }
  };

  const handleTestConnection = async () => {
    if (!subscription) return;

    try {
      const result = await client.testProviderConnection({
        providerId: subscription.providerId,
        config: providerConfig,
      });
      if (result.success) {
        toast.success(result.message ?? "Connection successful");
      } else {
        toast.error(result.message ?? "Connection failed");
      }
    } catch (error) {
      console.error("Failed to test connection:", error);
      toast.error("Connection test failed");
    }
  };

  // Extract connectionId from providerConfig for providers with connections
  const connectionId =
    (providerConfig.connectionId as string | undefined) ?? "";

  // Create optionsResolvers for dynamic dropdown fields (x-options-resolver)
  const optionsResolvers = useMemo(() => {
    if (!provider || !connectionId) {
      return;
    }

    return new Proxy(
      {},
      {
        get: (_target, resolverName: string) => {
          return async (formValues: Record<string, unknown>) => {
            try {
              const result = await client.getConnectionOptions({
                providerId: provider.qualifiedId,
                connectionId,
                resolverName,
                context: formValues,
              });
              return result.map((opt) => ({
                value: opt.value,
                label: opt.label,
              }));
            } catch (error) {
              console.error(
                `Failed to fetch options for ${resolverName}:`,
                error
              );
              return [];
            }
          };
        },
        has: () => true,
      }
    ) as Record<
      string,
      (
        formValues: Record<string, unknown>
      ) => Promise<{ value: string; label: string }[]>
    >;
  }, [client, provider, connectionId]);

  return (
    <PageLayout
      title={subscription?.name ?? "Loading..."}
      subtitle="Edit webhook subscription settings"
      loading={loading}
      actions={
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              navigate(resolveRoute(integrationRoutes.routes.list))
            }
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      }
    >
      {subscription && (
        <div className="space-y-8">
          {/* Basic Settings */}
          <section>
            <SectionHeader
              title="Basic Settings"
              icon={<Settings className="h-5 w-5" />}
            />
            <Card>
              <CardContent className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Name</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Description
                  </label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Provider
                  </label>
                  <div className="text-muted-foreground">
                    {provider?.displayName ?? subscription.providerId}
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Provider Configuration */}
          {provider?.configSchema && (
            <section>
              <SectionHeader title="Provider Configuration" />
              <Card>
                <CardContent className="p-6">
                  <DynamicForm
                    schema={provider.configSchema}
                    value={providerConfig}
                    onChange={setProviderConfig}
                    optionsResolvers={optionsResolvers}
                    templateProperties={payloadProperties}
                  />
                  <div className="mt-4">
                    <Button
                      variant="outline"
                      onClick={() => void handleTestConnection()}
                    >
                      Test Connection
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          {/* Event Selection */}
          <section>
            <SectionHeader
              title="Event Selection"
              description="Select which event triggers this webhook"
            />
            <Card>
              <CardContent className="p-6">
                <Label className="mb-2">Event</Label>
                <Select
                  value={selectedEventId}
                  onValueChange={setSelectedEventId}
                >
                  <SelectTrigger className="w-full max-w-md">
                    <SelectValue placeholder="Select an event" />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map((event) => (
                      <SelectItem key={event.eventId} value={event.eventId}>
                        <div>
                          <div>{event.displayName}</div>
                          {event.description && (
                            <div className="text-xs text-muted-foreground">
                              {event.description}
                            </div>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {events.length === 0 && (
                  <div className="text-muted-foreground mt-2">
                    No events registered. Plugins can register integration
                    events.
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      )}

      <ConfirmationModal
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title="Delete Subscription"
        message="Are you sure you want to delete this webhook subscription? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        onConfirm={() => void handleDelete()}
      />
    </PageLayout>
  );
};
