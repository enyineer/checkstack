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
  toastError,
} from "@checkstack/ui";
import {
  AlertTriangle,
  Save,
  Info,
  HardDrive,
  Database,
  Zap,
  Boxes,
  Gauge,
  Timer,
  Hourglass,
} from "lucide-react";

interface DefinitionRowProps {
  icon: React.ComponentType<{ className?: string }>;
  term: string;
  description: string;
}

/**
 * A single reference row in the Cache Usage card: a leading icon chip, the term
 * as the emphasized line, and its description demoted beneath. Rendered inside a
 * `<dl>` with low-contrast dividers so the card reads as scannable reference.
 */
const DefinitionRow = ({ icon: Icon, term, description }: DefinitionRowProps) => (
  <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-inset"
      aria-hidden
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
    </span>
    <div className="min-w-0">
      <dt className="text-sm font-medium text-foreground">{term}</dt>
      <dd className="text-xs text-muted-foreground">{description}</dd>
    </div>
  </div>
);

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
      toastError(toast, "Failed to save cache configuration", error);
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
                <AlertTitle>
                  In-memory cache: single instance only
                </AlertTitle>
                <AlertDescription>
                  The in-memory cache is per-pod: each instance keeps its own
                  copy, so it is only safe for development and single-instance
                  deployments. If you run more than one instance, platform
                  caches that sit on the hot path - system health status and the
                  authenticated read path (user roles, role access rules,
                  anonymous access) - can go stale on other pods until their
                  short TTL expires, because a change on one pod cannot evict
                  another pod&apos;s copy. For any horizontally-scaled
                  deployment, select a distributed backend such as Redis so
                  every instance shares one coherent cache.
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
      <Card className="bg-surface border-border/70 rounded-[var(--d-card-r)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Cache Usage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <h4 className="flex items-center gap-2 font-medium">
                <HardDrive className="h-4 w-4" />
                How Cache is Used
              </h4>
              <dl className="divide-y divide-border/60">
                <DefinitionRow
                  icon={Database}
                  term="Anomaly Detection"
                  description="Stores computed baselines for metric comparison"
                />
                <DefinitionRow
                  icon={Zap}
                  term="Performance"
                  description="Reduces repeated computations across health check runs"
                />
                <DefinitionRow
                  icon={Boxes}
                  term="Plugin Data"
                  description="Scoped key-value storage for plugin-specific state"
                />
              </dl>
            </div>

            <div className="space-y-3">
              <h4 className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                Configuration Notes
              </h4>
              <dl className="divide-y divide-border/60">
                <DefinitionRow
                  icon={Gauge}
                  term="Max Entries"
                  description="Limits memory usage; oldest entries are evicted first"
                />
                <DefinitionRow
                  icon={Timer}
                  term="Sweep Interval"
                  description="How often expired entries are cleaned up"
                />
                <DefinitionRow
                  icon={Hourglass}
                  term="TTL"
                  description="Entries expire automatically when set with a time-to-live"
                />
              </dl>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
