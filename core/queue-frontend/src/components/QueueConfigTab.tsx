import { useEffect, useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  QueuePluginDto,
  QueueApi,
} from "@checkstack/queue-common";
import {
  Button,
  Alert,
  AlertTitle,
  AlertDescription,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  PluginConfigForm,
  useToast,
  toastError,
} from "@checkstack/ui";
import { AlertTriangle, Save, Info, Gauge, Activity } from "lucide-react";
import { QueueLagAlert } from "./QueueLagAlert";

/**
 * Queue configuration tab component.
 *
 * Renders inside the Infrastructure Config page as a registered tab.
 * Extracted from the former QueueConfigPage.
 *
 * Receives `canUpdate` from the infrastructure shell instead of
 * querying access internally (the shell handles per-tab access).
 */
export const QueueConfigTab = ({ canUpdate }: { canUpdate: boolean }) => {
  const queueClient = usePluginClient(QueueApi);
  const toast = useToast();

  // Fetch plugins and configuration
  const { data: pluginsList } = queueClient.getPlugins.useQuery();
  const { data: configuration, refetch: refetchConfig } =
    queueClient.getConfiguration.useQuery();
  const updateConfigMutation = queueClient.updateConfiguration.useMutation();

  const [selectedPluginId, setSelectedPluginId] = useState<string>("");
  const [config, setConfig] = useState<Record<string, unknown>>({});

  // Sync state with fetched data
  useEffect(() => {
    if (configuration) {
      setSelectedPluginId(configuration.pluginId);
      setConfig(configuration.config);
    }
  }, [configuration]);

  const handleSave = async () => {
    if (!selectedPluginId) return;
    try {
      await updateConfigMutation.mutateAsync({
        pluginId: selectedPluginId,
        config,
      });
      toast.success("Configuration saved successfully!");
      refetchConfig();
    } catch (error) {
      toastError(toast, "Failed to save queue configuration", error);
    }
  };

  const isMemoryQueue = selectedPluginId === "memory";
  const plugins: QueuePluginDto[] = pluginsList ?? [];
  const isSaving = updateConfigMutation.isPending;

  return (
    <div className="space-y-6">
      <QueueLagAlert requireAccess={false} />
      <Card>
        <CardHeader>
          <CardTitle>Queue Configuration</CardTitle>
          <p className="text-sm text-muted-foreground">
            Select and configure the queue plugin
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {isMemoryQueue && (
            <Alert variant="warning">
              <AlertTriangle className="h-5 w-5" />
              <div>
                <AlertTitle>In-Memory Queue Warning</AlertTitle>
                <AlertDescription>
                  The in-memory queue is suitable for development and
                  single-instance deployments only. It will not scale across
                  multiple instances and jobs will be lost on restart. For
                  production environments with multiple instances, consider
                  using a persistent queue implementation.
                </AlertDescription>
              </div>
            </Alert>
          )}

          <PluginConfigForm
            label="Queue Plugin"
            plugins={plugins}
            selectedPluginId={selectedPluginId}
            onPluginChange={(value) => {
              setSelectedPluginId(value);
              setConfig({});
            }}
            config={config}
            onConfigChange={setConfig}
            disabled={!canUpdate}
          />
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button onClick={handleSave} disabled={!canUpdate || isSaving}>
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? "Saving..." : "Save Configuration"}
          </Button>
        </CardFooter>
      </Card>

      {/* Performance Guidance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Performance Tuning
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <h4 className="flex items-center gap-2 font-medium">
                <Gauge className="h-4 w-4" />
                Concurrency Settings
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>
                  <strong>Default (10)</strong>: Conservative, safe for most
                  workloads
                </li>
                <li>
                  <strong>Moderate (25-50)</strong>: Good for I/O-bound health
                  checks
                </li>
                <li>
                  <strong>Aggressive (100)</strong>: Maximum, monitor resource
                  usage
                </li>
              </ul>
              <p className="text-xs text-muted-foreground mt-2">
                Formula: throughput ≈ concurrency / avg_job_duration
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="flex items-center gap-2 font-medium">
                <Activity className="h-4 w-4" />
                Bottleneck Indicators
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>
                  <strong>Jobs queueing</strong>: Increase concurrency or
                  scale horizontally
                </li>
                <li>
                  <strong>High CPU (&gt;70%)</strong>: Scale horizontally,
                  don&apos;t increase concurrency
                </li>
                <li>
                  <strong>DB connection errors</strong>: Reduce concurrency or
                  increase pool
                </li>
                <li>
                  <strong>Rate limit errors</strong>: Reduce concurrency for
                  external checks
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
