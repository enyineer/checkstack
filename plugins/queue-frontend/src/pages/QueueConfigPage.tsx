import { useEffect, useState } from "react";
import {
  useApi,
  wrapInSuspense,
  permissionApiRef,
} from "@checkmate/frontend-api";
import { queueApiRef } from "../api";
import { QueuePluginDto } from "@checkmate/queue-common";
import {
  Button,
  Alert,
  AlertTitle,
  AlertDescription,
  PageLayout,
  PluginConfigForm,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  useToast,
} from "@checkmate/ui";
import { AlertTriangle, Save } from "lucide-react";

const QueueConfigPageContent = () => {
  const api = useApi(queueApiRef);
  const permissionApi = useApi(permissionApiRef);
  const toast = useToast();
  const { allowed: canRead, loading: permissionLoading } =
    permissionApi.useResourcePermission("queue", "read");
  const { allowed: canUpdate } = permissionApi.useManagePermission("queue");

  const [plugins, setPlugins] = useState<QueuePluginDto[]>([]);
  const [selectedPluginId, setSelectedPluginId] = useState<string>("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      const [pluginsList, configuration] = await Promise.all([
        api.getPlugins(),
        api.getConfiguration(),
      ]);
      setPlugins(pluginsList);
      setSelectedPluginId(configuration.pluginId);
      setConfig(configuration.config);
    };
    fetchData();
  }, [api]);

  const handleSave = async () => {
    if (!selectedPluginId) return;
    setIsSaving(true);
    try {
      await api.updateConfiguration({
        pluginId: selectedPluginId,
        config,
      });
      toast.success("Configuration saved successfully!");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to save configuration: ${message}`);

    } finally {
      setIsSaving(false);
    }
  };

  const isMemoryQueue = selectedPluginId === "memory";

  return (
    <PageLayout
      title="Queue Settings"
      subtitle="Configure the queue system for background jobs"
      loading={permissionLoading}
      allowed={canRead}
      maxWidth="3xl"
    >
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
    </PageLayout>
  );
};

export const QueueConfigPage = wrapInSuspense(QueueConfigPageContent);
