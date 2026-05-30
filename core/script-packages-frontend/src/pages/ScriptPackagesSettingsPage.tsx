import React from "react";
import { Package, Trash2, Download, RefreshCw } from "lucide-react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import {
  ScriptPackagesApi,
  scriptPackagesAccess,
} from "@checkstack/script-packages-common";
import {
  PageLayout,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Label,
  Badge,
  Toggle,
  Alert,
  AlertTitle,
  AlertDescription,
  AccessDenied,
  LoadingSpinner,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  ConfirmationModal,
  usePerformance,
  cn,
} from "@checkstack/ui";
import { extractErrorMessage } from "@checkstack/common";

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SettingsContent: React.FC = () => {
  const client = usePluginClient(ScriptPackagesApi);
  const accessApi = useApi(accessApiRef);
  const { allowed, loading: accessLoading } = accessApi.useAccess(
    scriptPackagesAccess.manage,
  );

  const packagesQuery = client.listPackages.useQuery();
  const installStateQuery = client.getInstallState.useQuery();
  const registryQuery = client.getRegistryConfig.useQuery();
  const sizeCapQuery = client.getSizeCapConfig.useQuery();
  const storageQuery = client.getStorageConfig.useQuery(undefined, {
    // Poll while a migration is running so progress + completion show live.
    refetchInterval: (query) =>
      query.state.data?.migrationStatus === "migrating" ? 1500 : false,
  });
  const backendsQuery = client.listStorageBackends.useQuery();
  const satellitesQuery = client.listSatelliteSyncState.useQuery();

  const addMutation = client.addPackage.useMutation();
  const removeMutation = client.removePackage.useMutation();
  const setEnabledMutation = client.setPackageEnabled.useMutation();
  const installMutation = client.installNow.useMutation();
  const migrateMutation = client.migrateStorage.useMutation();

  const { isLowPower } = usePerformance();
  const [name, setName] = React.useState("");
  const [version, setVersion] = React.useState("");
  const [migrateTarget, setMigrateTarget] = React.useState<string>("");
  const [confirmMigrate, setConfirmMigrate] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (accessLoading) return <LoadingSpinner />;
  if (!allowed) {
    return (
      <PageLayout title="Script packages" icon={Package}>
        <AccessDenied />
      </PageLayout>
    );
  }

  const packages = packagesQuery.data?.items ?? [];
  const installState = installStateQuery.data;
  const sizeCap = sizeCapQuery.data;
  const storage = storageQuery.data;
  const satellites = satellitesQuery.data?.items ?? [];

  const handleAdd = async () => {
    setError(null);
    try {
      await addMutation.mutateAsync({ name: name.trim(), version: version.trim() });
      setName("");
      setVersion("");
    } catch (error_) {
      setError(extractErrorMessage(error_));
    }
  };

  const handleInstall = async () => {
    setError(null);
    try {
      const res = await installMutation.mutateAsync({});
      if (!res.started && res.reason) setError(res.reason);
    } catch (error_) {
      setError(extractErrorMessage(error_));
    }
  };

  const handleMigrate = async () => {
    setError(null);
    setConfirmMigrate(false);
    if (!migrateTarget) return;
    try {
      const res = await migrateMutation.mutateAsync({ target: migrateTarget });
      if (!res.started && res.reason) setError(res.reason);
    } catch (error_) {
      setError(extractErrorMessage(error_));
    }
  };

  const overWarn =
    installState && sizeCap
      ? installState.totalSizeBytes > sizeCap.warnBytes
      : false;

  const availableBackends = backendsQuery.data?.backends ?? [];
  const migrating = storage?.migrationStatus === "migrating";
  const migrationTargets = availableBackends.filter(
    (b) => b !== storage?.activeBackend,
  );

  return (
    <PageLayout title="Script packages" icon={Package}>
      <div className="space-y-6">
      {error && (
        <Alert variant="error">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Install state */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Install state</CardTitle>
          <Button
            type="button"
            size="sm"
            onClick={handleInstall}
            disabled={installMutation.isPending || installState?.status === "installing"}
          >
            <Download className="h-4 w-4" />
            {installState?.status === "installing" ? "Installing…" : "Install now"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Status:</span>
            <Badge variant={installState?.status === "error" ? "destructive" : "secondary"}>
              {installState?.status ?? "unknown"}
            </Badge>
            {installState?.totalSizeBytes !== undefined && (
              <Badge variant={overWarn ? "destructive" : "secondary"}>
                {mb(installState.totalSizeBytes)}
              </Badge>
            )}
          </div>
          {installState?.errorMessage && (
            <p className="text-destructive text-xs">{installState.errorMessage}</p>
          )}
          {overWarn && sizeCap && (
            <p className="text-xs text-amber-600">
              Resolved size exceeds the {mb(sizeCap.warnBytes)} warning threshold.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Allowlist */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Allowed packages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="pkg-name">Package</Label>
              <Input
                id="pkg-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="lodash or @scope/name"
              />
            </div>
            <div className="w-40">
              <Label htmlFor="pkg-version">Version</Label>
              <Input
                id="pkg-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="4.17.21"
              />
            </div>
            <Button
              type="button"
              onClick={handleAdd}
              disabled={!name.trim() || !version.trim() || addMutation.isPending}
            >
              Add
            </Button>
          </div>

          {packages.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No packages yet. Add pinned, lightweight pure-JS packages.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {packages.map((pkg) => (
                <li
                  key={pkg.name}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="flex items-center gap-2 font-mono text-sm">
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                    {pkg.name}@{pkg.version}
                  </span>
                  <div className="flex items-center gap-3">
                    <Toggle
                      checked={pkg.enabled}
                      onCheckedChange={(enabled) =>
                        setEnabledMutation.mutate({ name: pkg.name, enabled })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => removeMutation.mutate({ name: pkg.name })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Advanced configuration — collapsed by default so the common case
          (install state + allowlist above) stays the focus. Registry /
          storage are read-only summaries; the storage section also holds
          the rare, destructive migrate flow behind a confirmation modal. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Advanced</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="w-full">
            <AccordionItem value="registry" className="border-b">
              <AccordionTrigger className="text-sm hover:no-underline">
                Registry &amp; storage
              </AccordionTrigger>
              <AccordionContent className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Registry: </span>
                  <span className="font-mono">
                    {registryQuery.data?.registryUrl}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    Ignore install scripts:
                  </span>
                  <Toggle
                    checked={registryQuery.data?.ignoreScripts ?? true}
                    disabled
                    onCheckedChange={() => {}}
                  />
                </div>
                <div>
                  <span className="text-muted-foreground">Auth token: </span>
                  {registryQuery.data?.hasAuthToken ? "configured" : "none"}
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="storage" className="border-b">
              <AccordionTrigger className="text-sm hover:no-underline">
                <span className="flex items-center gap-2">
                  Storage backend
                  {migrating && (
                    <Badge variant="secondary" className="font-normal">
                      <RefreshCw
                        className={cn(
                          "mr-1 h-3 w-3",
                          !isLowPower && "animate-spin",
                        )}
                      />
                      migrating
                    </Badge>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Active backend:</span>
                  <Badge variant="secondary">{storage?.activeBackend}</Badge>
                  {migrating && (
                    <Badge variant="secondary">
                      <RefreshCw
                        className={cn(
                          "mr-1 h-3 w-3",
                          !isLowPower && "animate-spin",
                        )}
                      />
                      migrating to {storage?.migrationTarget} (
                      {storage?.migratedCount} copied)
                    </Badge>
                  )}
                </div>

                {storage?.migrationStatus === "error" &&
                  storage.migrationError && (
                    <p className="text-xs text-destructive">
                      Migration failed: {storage.migrationError}
                    </p>
                  )}
                {storage?.migrationStatus === "completed" && (
                  <p className="text-xs text-emerald-600">
                    Migration complete. Active backend is now{" "}
                    {storage.activeBackend}.
                  </p>
                )}

                {/* Migrate: copy all blobs to a target backend, then flip.
                    Guarded by a confirmation modal so the destructive flow
                    is never a single stray click. */}
                {migrationTargets.length > 0 && (
                  <div className="flex items-end gap-2">
                    <div className="w-48">
                      <Label htmlFor="migrate-target">Migrate blobs to</Label>
                      <Select
                        value={migrateTarget}
                        onValueChange={setMigrateTarget}
                        disabled={migrating}
                      >
                        <SelectTrigger id="migrate-target">
                          <SelectValue placeholder="Select target backend" />
                        </SelectTrigger>
                        <SelectContent>
                          {migrationTargets.map((b) => (
                            <SelectItem key={b} value={b}>
                              {b}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      onClick={() => setConfirmMigrate(true)}
                      disabled={
                        !migrateTarget || migrating || migrateMutation.isPending
                      }
                    >
                      <RefreshCw className="h-4 w-4" />
                      Migrate
                    </Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Migration copies every blob to the target, verifies each by
                  content hash, then atomically switches the active backend.
                  Reads fall back across both backends while it runs, so
                  scripts keep working. Installs are paused during a migration.
                </p>
              </AccordionContent>
            </AccordionItem>

            {satellites.length > 0 && (
              <AccordionItem value="satellites" className="border-b-0">
                <AccordionTrigger className="text-sm hover:no-underline">
                  Satellite sync
                </AccordionTrigger>
                <AccordionContent>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {satellites.map((s) => (
                      <li
                        key={s.satelliteId}
                        className="flex items-center justify-between px-3 py-2 text-sm"
                      >
                        <span className="font-mono">{s.satelliteId}</span>
                        <Badge
                          variant={
                            s.status === "error" ? "destructive" : "secondary"
                          }
                        >
                          {s.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </CardContent>
      </Card>
      </div>

      <ConfirmationModal
        isOpen={confirmMigrate}
        onClose={() => setConfirmMigrate(false)}
        onConfirm={handleMigrate}
        title="Migrate storage backend"
        message={`Copy every blob to "${migrateTarget}", verify by content hash, then atomically switch the active backend. Installs are paused until the migration completes. Continue?`}
        confirmText="Migrate"
        variant="warning"
        isLoading={migrateMutation.isPending}
      />
    </PageLayout>
  );
};

/**
 * Admin Settings -> Script Packages page. Curates the pinned allowlist,
 * shows install state + size, summarises registry / storage config, and
 * surfaces per-satellite sync status. Gated by `script-packages.manage`.
 */
export const ScriptPackagesSettingsPage = wrapInSuspense(SettingsContent);
