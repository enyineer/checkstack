import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
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
} from "@checkmate-monitor/integration-common";
import { ProviderDocumentation } from "./ProviderDocumentation";
import { getProviderConfigExtension } from "../provider-config-registry";

interface CreateSubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: IntegrationProviderInfo[];
  onCreated: (subscription: WebhookSubscription) => void;
}

export const CreateSubscriptionDialog = ({
  open,
  onOpenChange,
  providers,
  onCreated,
}: CreateSubscriptionDialogProps) => {
  const rpcApi = useApi(rpcApiRef);
  const client = rpcApi.forPlugin(IntegrationApi);
  const toast = useToast();

  const [step, setStep] = useState<"provider" | "config">("provider");
  const [selectedProvider, setSelectedProvider] =
    useState<IntegrationProviderInfo>();
  const [events, setEvents] = useState<IntegrationEventInfo[]>([]);
  const [saving, setSaving] = useState(false);

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
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

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

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setStep("provider");
      setSelectedProvider(undefined);
      setName("");
      setDescription("");
      setProviderConfig({});
      setSelectedEvents([]);
      setConnections([]);
      setSelectedConnectionId("");
    }
  }, [open]);

  const handleProviderSelect = (provider: IntegrationProviderInfo) => {
    setSelectedProvider(provider);
    setStep("config");
    // Fetch connections if provider supports them
    if (provider.hasConnectionSchema) {
      void fetchConnections(provider.qualifiedId);
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
        eventTypes: selectedEvents.length > 0 ? selectedEvents : undefined,
      });
      onCreated(result);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "provider"
              ? "Select Provider"
              : `Configure ${selectedProvider?.displayName ?? "Subscription"}`}
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
                        to={resolveRoute(integrationRoutes.routes.connections, {
                          providerId: selectedProvider.qualifiedId,
                        })}
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

            {/* Event Filter */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Event Filter (optional)
              </label>
              <div className="text-sm text-muted-foreground mb-2">
                Leave empty to subscribe to all events
              </div>
              <div className="border rounded-md p-4 max-h-40 overflow-y-auto">
                <div className="space-y-2">
                  {events.map((event) => (
                    <label
                      key={event.eventId}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(event.eventId)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedEvents((prev) => [
                              ...prev,
                              event.eventId,
                            ]);
                          } else {
                            setSelectedEvents((prev) =>
                              prev.filter((id) => id !== event.eventId)
                            );
                          }
                        }}
                      />
                      <span>{event.displayName}</span>
                    </label>
                  ))}
                  {events.length === 0 && (
                    <div className="text-muted-foreground text-sm">
                      No events registered. Plugins will register events.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "config" && (
            <Button variant="outline" onClick={() => setStep("provider")}>
              Back
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {step === "config" && (
            <Button
              onClick={() => void handleCreate()}
              disabled={!name.trim() || saving}
            >
              {saving ? "Creating..." : "Create Subscription"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
