import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { Trash2, ScrollText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Textarea,
  DynamicForm,
  DynamicIcon,
  useToast,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
  ConfirmationModal,
} from "@checkmate-monitor/ui";
import { useApi, rpcApiRef } from "@checkmate-monitor/frontend-api";
import { resolveRoute } from "@checkmate-monitor/common";
import {
  IntegrationApi,
  integrationRoutes,
  type WebhookSubscription,
  type IntegrationProviderInfo,
  type IntegrationEventInfo,
  type ProviderConnectionRedacted,
  type PayloadProperty,
} from "@checkmate-monitor/integration-common";
import { ProviderDocumentation } from "./ProviderDocumentation";
import { getProviderConfigExtension } from "../provider-config-registry";

interface SubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: IntegrationProviderInfo[];
  /** Existing subscription for edit mode */
  subscription?: WebhookSubscription;
  /** Called when a new subscription is created */
  onCreated?: (subscription: WebhookSubscription) => void;
  /** Called when an existing subscription is updated */
  onUpdated?: (subscription: WebhookSubscription) => void;
  /** Called when an existing subscription is deleted */
  onDeleted?: (id: string) => void;
}

export const SubscriptionDialog = ({
  open,
  onOpenChange,
  providers,
  subscription,
  onCreated,
  onUpdated,
  onDeleted,
}: SubscriptionDialogProps) => {
  const rpcApi = useApi(rpcApiRef);
  const client = rpcApi.forPlugin(IntegrationApi);
  const toast = useToast();

  // Edit mode detection
  const isEditMode = !!subscription;

  const [step, setStep] = useState<"provider" | "config">("provider");
  const [selectedProvider, setSelectedProvider] =
    useState<IntegrationProviderInfo>();
  const [events, setEvents] = useState<IntegrationEventInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Connection state for providers with connectionSchema
  const [connections, setConnections] = useState<ProviderConnectionRedacted[]>(
    []
  );
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [loadingConnections, setLoadingConnections] = useState(false);

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

  // Fetch events when dialog opens
  const fetchEvents = useCallback(async () => {
    try {
      const result = await client.listEventTypes();
      setEvents(result);
    } catch (error) {
      console.error("Failed to fetch events:", error);
    }
  }, [client]);

  // Fetch connections for providers with connectionSchema
  const fetchConnections = useCallback(
    async (providerId: string) => {
      setLoadingConnections(true);
      try {
        const result = await client.listConnections({ providerId });
        setConnections(result);
        // Auto-select if only one connection
        if (result.length === 1) {
          setSelectedConnectionId(result[0].id);
        }
      } catch (error) {
        console.error("Failed to fetch connections:", error);
      } finally {
        setLoadingConnections(false);
      }
    },
    [client]
  );

  useEffect(() => {
    if (open) {
      void fetchEvents();
    }
  }, [open, fetchEvents]);

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

  // Pre-populate form in edit mode
  useEffect(() => {
    if (open && subscription) {
      // Find the provider for this subscription
      const provider = providers.find(
        (p) => p.qualifiedId === subscription.providerId
      );
      if (provider) {
        setSelectedProvider(provider);
        setStep("config"); // Skip provider selection
        if (provider.hasConnectionSchema) {
          void fetchConnections(provider.qualifiedId);
        }
      }
      // Populate form fields
      setName(subscription.name);
      setDescription(subscription.description ?? "");
      setProviderConfig(subscription.providerConfig);
      setSelectedEventId(subscription.eventId);
      // Set connection ID from config
      const connId = subscription.providerConfig.connectionId;
      if (typeof connId === "string") {
        setSelectedConnectionId(connId);
      }
    }
  }, [open, subscription, providers, fetchConnections]);

  // Reset when dialog closes (only in create mode)
  useEffect(() => {
    if (!open && !subscription) {
      setStep("provider");
      setSelectedProvider(undefined);
      setName("");
      setDescription("");
      setProviderConfig({});
      setSelectedEventId("");
      setPayloadProperties([]);
      setConnections([]);
      setSelectedConnectionId("");
      setDeleteDialogOpen(false);
    }
  }, [open, subscription]);

  const handleProviderSelect = (provider: IntegrationProviderInfo) => {
    setSelectedProvider(provider);
    setStep("config");
    // Fetch connections if provider supports them
    if (provider.hasConnectionSchema) {
      void fetchConnections(provider.qualifiedId);
    }
  };

  // Handle update (edit mode)
  const handleSave = async () => {
    if (!subscription || !selectedProvider) return;

    try {
      setSaving(true);
      // Include connectionId in providerConfig for providers with connections
      const configWithConnection = selectedProvider.hasConnectionSchema
        ? { ...providerConfig, connectionId: selectedConnectionId }
        : providerConfig;

      await client.updateSubscription({
        id: subscription.id,
        updates: {
          name,
          description: description || undefined,
          providerConfig: configWithConnection,
          eventId:
            selectedEventId === subscription.eventId
              ? undefined
              : selectedEventId,
        },
      });
      toast.success("Subscription updated");
      onUpdated?.(subscription);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to update subscription:", error);
      toast.error("Failed to update subscription");
    } finally {
      setSaving(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!subscription) return;

    try {
      await client.deleteSubscription({ id: subscription.id });
      toast.success("Subscription deleted");
      onDeleted?.(subscription.id);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to delete subscription:", error);
      toast.error("Failed to delete subscription");
    }
  };

  const handleCreate = async () => {
    if (!selectedProvider) return;

    // For providers with connections, require a connection to be selected
    if (selectedProvider.hasConnectionSchema && !selectedConnectionId) {
      toast.error("Please select a connection");
      return;
    }

    try {
      setSaving(true);
      // Include connectionId in providerConfig for providers with connections
      const configWithConnection = selectedProvider.hasConnectionSchema
        ? { ...providerConfig, connectionId: selectedConnectionId }
        : providerConfig;

      const result = await client.createSubscription({
        name,
        description: description || undefined,
        providerId: selectedProvider.qualifiedId,
        providerConfig: configWithConnection,
        eventId: selectedEventId,
      });
      onCreated?.(result);
      toast.success("Subscription created");
    } catch (error) {
      console.error("Failed to create subscription:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to create subscription"
      );
    } finally {
      setSaving(false);
    }
  };

  // Create optionsResolvers for dynamic dropdown fields (x-options-resolver)
  // Uses a Proxy to handle any resolver name dynamically
  const optionsResolvers = useMemo(() => {
    if (!selectedProvider || !selectedConnectionId) {
      return;
    }

    // Create a Proxy that handles any resolver name
    return new Proxy(
      {},
      {
        get: (_target, resolverName: string) => {
          // Return a resolver function for this resolver name
          return async (formValues: Record<string, unknown>) => {
            try {
              const result = await client.getConnectionOptions({
                providerId: selectedProvider.qualifiedId,
                connectionId: selectedConnectionId,
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
        has: () => true, // All resolver names are valid
      }
    ) as Record<
      string,
      (
        formValues: Record<string, unknown>
      ) => Promise<{ value: string; label: string }[]>
    >;
  }, [client, selectedProvider, selectedConnectionId]);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          // Don't close the dialog if the delete confirmation is open
          if (!isOpen && deleteDialogOpen) return;
          onOpenChange(isOpen);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isEditMode
                ? `Edit ${selectedProvider?.displayName ?? "Subscription"}`
                : step === "provider"
                ? "Select Provider"
                : `Configure ${
                    selectedProvider?.displayName ?? "Subscription"
                  }`}
            </DialogTitle>
          </DialogHeader>

          {step === "provider" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
              {providers.length === 0 ? (
                <div className="col-span-full text-center text-muted-foreground py-8">
                  No providers available. Install provider plugins to enable
                  webhook delivery.
                </div>
              ) : (
                providers.map((provider) => (
                  <button
                    key={provider.qualifiedId}
                    onClick={() => handleProviderSelect(provider)}
                    className="flex items-center gap-4 p-4 border rounded-lg hover:bg-muted transition-colors text-left"
                  >
                    <div className="p-3 rounded-lg bg-muted">
                      <DynamicIcon
                        name={provider.icon ?? "Webhook"}
                        className="h-6 w-6"
                      />
                    </div>
                    <div>
                      <div className="font-medium">{provider.displayName}</div>
                      {provider.description && (
                        <div className="text-sm text-muted-foreground">
                          {provider.description}
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-6 py-4">
              {/* Basic Info */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My Webhook"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Description
                  </label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description"
                    rows={2}
                  />
                </div>
              </div>

              {/* Event Selection (required) */}
              <div>
                <Label className="mb-2">
                  Event <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={selectedEventId}
                  onValueChange={setSelectedEventId}
                >
                  <SelectTrigger>
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
                  <div className="text-muted-foreground text-sm mt-2">
                    No events registered. Plugins will register events.
                  </div>
                )}
              </div>

              {/* Connection Selection (for providers with connectionSchema) */}
              {selectedProvider?.hasConnectionSchema && (
                <div>
                  <Label className="mb-2">
                    Connection <span className="text-destructive">*</span>
                  </Label>
                  {loadingConnections ? (
                    <div className="text-sm text-muted-foreground py-2">
                      Loading connections...
                    </div>
                  ) : connections.length === 0 ? (
                    <div className="border rounded-md p-4 bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-2">
                        No connections configured for this provider.
                      </p>
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          to={resolveRoute(
                            integrationRoutes.routes.connections,
                            {
                              providerId: selectedProvider.qualifiedId,
                            }
                          )}
                        >
                          Configure Connections
                        </Link>
                      </Button>
                    </div>
                  ) : (
                    <Select
                      value={selectedConnectionId}
                      onValueChange={setSelectedConnectionId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a connection" />
                      </SelectTrigger>
                      <SelectContent>
                        {connections.map((conn) => (
                          <SelectItem key={conn.id} value={conn.id}>
                            {conn.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Provider Config */}
              {selectedProvider &&
                (() => {
                  // Check if provider has a custom config component
                  const extension = getProviderConfigExtension(
                    selectedProvider.qualifiedId
                  );

                  if (extension) {
                    // Render custom component
                    const CustomConfig = extension.ConfigComponent;
                    return (
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          Provider Configuration
                        </label>
                        <div className="border rounded-md p-4">
                          <CustomConfig
                            value={providerConfig}
                            onChange={setProviderConfig}
                            isSubmitting={saving}
                          />
                        </div>
                      </div>
                    );
                  }

                  // Fall back to DynamicForm for providers without custom component
                  if (selectedProvider.configSchema) {
                    return (
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          Provider Configuration
                        </label>
                        <div className="border rounded-md p-4">
                          <DynamicForm
                            schema={selectedProvider.configSchema}
                            value={providerConfig}
                            onChange={setProviderConfig}
                            optionsResolvers={optionsResolvers}
                            templateProperties={payloadProperties}
                          />
                        </div>
                      </div>
                    );
                  }

                  return <></>;
                })()}

              {/* Provider Documentation */}
              {selectedProvider && (
                <ProviderDocumentation provider={selectedProvider} />
              )}
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {/* Left side: Delete and View Logs in edit mode */}
            {isEditMode && (
              <div className="flex gap-2 mr-auto">
                <Button
                  variant="destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
                <Link
                  to={resolveRoute(integrationRoutes.routes.deliveryLogs, {
                    subscriptionId: subscription.id,
                  })}
                >
                  <Button variant="outline">
                    <ScrollText className="h-4 w-4 mr-2" />
                    View Logs
                  </Button>
                </Link>
              </div>
            )}

            {/* Right side: Cancel, Back, Create/Save */}
            {step === "config" && !isEditMode && (
              <Button variant="outline" onClick={() => setStep("provider")}>
                Back
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {step === "config" && (
              <Button
                onClick={() =>
                  void (isEditMode ? handleSave() : handleCreate())
                }
                disabled={!name.trim() || !selectedEventId || saving}
              >
                {saving
                  ? isEditMode
                    ? "Saving..."
                    : "Creating..."
                  : isEditMode
                  ? "Save Changes"
                  : "Create Subscription"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal - rendered outside Dialog to fix z-index */}
      <ConfirmationModal
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title="Delete Subscription"
        message={`Are you sure you want to delete "${subscription?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        onConfirm={() => void handleDelete()}
      />
    </>
  );
};

// Export with original name for backwards compatibility
export const CreateSubscriptionDialog = SubscriptionDialog;
