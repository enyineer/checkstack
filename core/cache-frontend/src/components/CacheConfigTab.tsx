import { useEffect, useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  type CachePluginDto,
  CacheApi,
} from "@checkstack/cache-common";
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
} from "@checkstack/ui";
import { AlertTriangle, Save, Info, HardDrive } from "lucide-react";
import { extractErrorMessage } from "@checkstack/common";

/**
 * Cache configuration tab component.
 *
 * Renders inside the Infrastructure Config page as a registered tab.
 * Provides plugin selection and configuration form for the cache backend.
 */
export const CacheConfigTab = ({ canUpdate }: { canUpdate: boolean }) => {
  const cacheClient = usePluginClient(CacheApi);
  const toast = useToast();

  // Fetch plugins and configuration
  const { data: pluginsList } = cacheClient.getPlugins.useQuery();
  const { data: configuration, refetch: refetchConfig } =
    cacheClient.getConfiguration.useQuery();
  const updateConfigMutation = cacheClient.updateConfiguration.useMutation();

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
      toast.success("Cache configuration saved successfully!");
      refetchConfig();
    } catch (error) {
      const message = extractErrorMessage(error);
      toast.error(`Failed to save cache configuration: ${message}`);
    }
  };

  const isMemoryCache = selectedPluginId === "memory";
  const plugins: CachePluginDto[] = pluginsList ?? [];
  const isSaving = updateConfigMutation.isPending;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Cache Configuration</CardTitle>
          <p className="text-sm text-muted-foreground">
            Select and configure the cache backend
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {isMemoryCache && (
            <Alert variant="warning">
              <AlertTriangle className="h-5 w-5" />
              <div>
                <AlertTitle>In-Memory Cache Warning</AlertTitle>
                <AlertDescription>
                  The in-memory cache is suitable for development and
                  single-instance deployments only. Data will not be shared
                  across multiple instances and will be lost on restart. For
                  production environments with multiple instances, consider
                  using a persistent cache implementation like Redis.
                </AlertDescription>
              </div>
            </Alert>
          )}

          <PluginConfigForm
            label="Cache Plugin"
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

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Cache Usage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <h4 className="flex items-center gap-2 font-medium">
                <HardDrive className="h-4 w-4" />
                How Cache is Used
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>
                  <strong>Anomaly Detection</strong>: Stores computed baselines
                  for metric comparison
                </li>
                <li>
                  <strong>Performance</strong>: Reduces repeated computations
                  across health check runs
                </li>
                <li>
                  <strong>Plugin Data</strong>: Scoped key-value storage for
                  plugin-specific state
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <h4 className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                Configuration Notes
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>
                  <strong>Max Entries</strong>: Limits memory usage; oldest
                  entries are evicted first
                </li>
                <li>
                  <strong>Sweep Interval</strong>: How often expired entries are
                  cleaned up
                </li>
                <li>
                  <strong>TTL</strong>: Entries expire automatically when set
                  with a time-to-live
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
