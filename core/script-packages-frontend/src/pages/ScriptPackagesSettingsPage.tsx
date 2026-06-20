import React from "react";
import {
  Package,
  Trash2,
  Download,
  RefreshCw,
  Recycle,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import {
  ScriptPackagesApi,
  scriptPackagesAccess,
  PackageVersionSchema,
  SCRIPT_PACKAGES_AUDIT_COMPLETED_SIGNAL,
} from "@checkstack/script-packages-common";
import { PackageNameCombobox } from "../components/PackageNameCombobox";
import { PackageVersionCombobox } from "../components/PackageVersionCombobox";
import {
  applyLatestDistTag,
  versionFromHit,
} from "../components/version-autofill";
import { StatusPill } from "../components/StatusPill";
import { SummaryPanel } from "../components/SummaryPanel";
import { SurfaceList, SurfaceListRow } from "../components/SurfaceList";
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
  useInitOnceForKey,
  cn,
  formatBytes,
} from "@checkstack/ui";
import { extractErrorMessage } from "@checkstack/common";
import {
  auditPostureTone,
  installStatusTone,
  satelliteStatusTone,
  severityTone,
  toneStyles,
} from "./status-display";

/** MB (UI unit) → bytes (the size-cap schema unit). */
function mbToBytes(value: number): number {
  return Math.round(value * 1024 * 1024);
}

const SettingsContent: React.FC = () => {
  const client = usePluginClient(ScriptPackagesApi);
  const accessApi = useApi(accessApiRef);
  const { allowed, loading: accessLoading } = accessApi.useAccess(
    scriptPackagesAccess.manage,
  );

  const packagesQuery = client.listPackages.useQuery();
  const installStateQuery = client.getInstallState.useQuery();
  // gcTime: 0 on the loader queries that seed editable form state via
  // useInitOnceForKey — otherwise stale-while-revalidate can race the
  // one-shot init and reopened editors would show pre-mutation values.
  const registryQuery = client.getRegistryConfig.useQuery(undefined, {
    gcTime: 0,
  });
  const sizeCapQuery = client.getSizeCapConfig.useQuery(undefined, {
    gcTime: 0,
  });
  const storageQuery = client.getStorageConfig.useQuery(undefined, {
    gcTime: 0,
    // Poll while a migration is running so progress + completion show live.
    refetchInterval: (query) =>
      query.state.data?.migrationStatus === "migrating" ? 1500 : false,
  });
  const backendsQuery = client.listStorageBackends.useQuery();
  const satellitesQuery = client.listSatelliteSyncState.useQuery();
  const blobGcQuery = client.getBlobGcState.useQuery();
  const auditQuery = client.getAuditState.useQuery();

  // Live-refresh the audit findings when a scheduled or on-demand pass
  // completes (the runner broadcasts on completion).
  useSignal(SCRIPT_PACKAGES_AUDIT_COMPLETED_SIGNAL, () => {
    void auditQuery.refetch();
  });

  const addMutation = client.addPackage.useMutation();
  const removeMutation = client.removePackage.useMutation();
  const setEnabledMutation = client.setPackageEnabled.useMutation();
  const installMutation = client.installNow.useMutation();
  const migrateMutation = client.migrateStorage.useMutation();
  const gcMutation = client.gcBlobs.useMutation();
  const setRegistryMutation = client.setRegistryConfig.useMutation();
  const setSizeCapMutation = client.setSizeCapConfig.useMutation();
  const setStorageBackendMutation = client.setStorageBackend.useMutation();
  const auditMutation = client.auditNow.useMutation();

  const { isLowPower } = usePerformance();
  const [name, setName] = React.useState("");
  const [version, setVersion] = React.useState("");
  const [migrateTarget, setMigrateTarget] = React.useState<string>("");
  const [confirmMigrate, setConfirmMigrate] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Editable Advanced-config state, seeded once from the loader queries.
  const [registryUrl, setRegistryUrl] = React.useState("");
  const [ignoreScripts, setIgnoreScripts] = React.useState(true);
  // Write-only: blank = leave the stored token untouched. The schema returns
  // only `hasAuthToken`, never the value, so the input always starts empty.
  const [authTokenInput, setAuthTokenInput] = React.useState("");
  const [warnMb, setWarnMb] = React.useState("");
  const [blockMb, setBlockMb] = React.useState("");
  const [storageBackend, setStorageBackend] = React.useState("");

  // Seed editable state once per persisted version. Using `updatedAt` as the
  // key re-seeds the form after a successful save (the mutation invalidates
  // the query → a fresh `updatedAt`) without clobbering in-progress edits on
  // unrelated background refetches.
  useInitOnceForKey(
    registryQuery.data,
    registryQuery.data?.updatedAt?.toISOString() ?? "registry",
    (cfg) => {
      setRegistryUrl(cfg.registryUrl);
      setIgnoreScripts(cfg.ignoreScripts);
      setAuthTokenInput("");
    },
  );
  useInitOnceForKey(sizeCapQuery.data, "size-cap", (cfg) => {
    setWarnMb(String(cfg.warnBytes / (1024 * 1024)));
    setBlockMb(String(cfg.blockBytes / (1024 * 1024)));
  });
  useInitOnceForKey(
    storageQuery.data,
    storageQuery.data?.activeBackend ?? "storage",
    (cfg) => {
      setStorageBackend(cfg.activeBackend);
    },
  );

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

  // Inline pinned-version validation: mirror the backend `addPackage`
  // (PackageVersionSchema) so an invalid free-typed version is surfaced
  // before submit rather than only as a server error. Empty → no message
  // (the Add button is already disabled), non-empty-invalid → the rule text.
  const trimmedVersion = version.trim();
  const versionParse =
    trimmedVersion.length > 0
      ? PackageVersionSchema.safeParse(trimmedVersion)
      : undefined;
  const versionError =
    versionParse && !versionParse.success
      ? (versionParse.error.issues[0]?.message ?? "Invalid version")
      : null;

  const handleAdd = async () => {
    setError(null);
    try {
      await addMutation.mutateAsync({ name: name.trim(), version: trimmedVersion });
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

  const handleGc = async () => {
    setError(null);
    try {
      const res = await gcMutation.mutateAsync({});
      if (!res.ran && res.reason) setError(res.reason);
    } catch (error_) {
      setError(extractErrorMessage(error_));
    }
  };

  const handleAudit = async () => {
    setError(null);
    try {
      const res = await auditMutation.mutateAsync({});
      if (!res.ran && res.reason) setError(res.reason);
    } catch (error_) {
      setError(extractErrorMessage(error_));
    }
  };

  const handleSaveRegistry = async () => {
    setError(null);
    try {
      await setRegistryMutation.mutateAsync({
        registryUrl: registryUrl.trim(),
        // Scoped registries are not editable in this UI yet; preserve them.
        scopedRegistries: registryQuery.data?.scopedRegistries ?? [],
        ignoreScripts,
        // Write-only: only send when the admin typed something. A blank field
        // leaves the stored token untouched.
        ...(authTokenInput.length > 0 ? { authToken: authTokenInput } : {}),
      });
      setAuthTokenInput("");
    } catch (error_) {
      setError(extractErrorMessage(error_));
    }
  };

  const handleClearAuthToken = async () => {
    setError(null);
    try {
      // Empty string clears the stored token (per the backend handler).
      await setRegistryMutation.mutateAsync({
        registryUrl: registryUrl.trim(),
        scopedRegistries: registryQuery.data?.scopedRegistries ?? [],
        ignoreScripts,
        authToken: "",
      });
      setAuthTokenInput("");
    } catch (error_) {
      setError(extractErrorMessage(error_));
    }
  };

  const handleSaveSizeCap = async () => {
    setError(null);
    const warn = Number(warnMb);
    const block = Number(blockMb);
    if (!Number.isFinite(warn) || !Number.isFinite(block) || warn <= 0 || block <= 0) {
      setError("Size thresholds must be positive numbers (MB).");
      return;
    }
    try {
      await setSizeCapMutation.mutateAsync({
        warnBytes: mbToBytes(warn),
        blockBytes: mbToBytes(block),
      });
    } catch (error_) {
      setError(extractErrorMessage(error_));
    }
  };

  const handleSaveStorageBackend = async () => {
    setError(null);
    if (!storageBackend) return;
    try {
      await setStorageBackendMutation.mutateAsync({ backend: storageBackend });
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

  const blobGc = blobGcQuery.data;
  const audit = auditQuery.data;
  const auditAdvisories = audit?.advisories ?? [];
  const auditState = audit?.state;
  const auditTone = auditPostureTone({
    total: auditAdvisories.length,
    counts: auditState?.counts,
  });
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
      <SummaryPanel
        tone={installStatusTone(installState?.status)}
        title="Install state"
        hero={
          installState?.totalSizeBytes === undefined
            ? "—"
            : formatBytes(installState.totalSizeBytes)
        }
        heroToneClass={overWarn ? "text-status-warn" : undefined}
        caption="installed size"
        trailing={
          <>
            <StatusPill
              tone={installStatusTone(installState?.status)}
              label={installState?.status ?? "unknown"}
            />
            <Button
              type="button"
              size="sm"
              onClick={handleInstall}
              disabled={
                installMutation.isPending ||
                installState?.status === "installing"
              }
            >
              <Download className="h-4 w-4" />
              {installState?.status === "installing"
                ? "Installing…"
                : "Install now"}
            </Button>
          </>
        }
      >
        {(installState?.errorMessage || (overWarn && sizeCap)) && (
          <div className="space-y-1">
            {installState?.errorMessage && (
              <p className="text-xs text-status-down">
                {installState.errorMessage}
              </p>
            )}
            {overWarn && sizeCap && (
              <p className="text-xs text-muted-foreground">
                Resolved size exceeds the {formatBytes(sizeCap.warnBytes)}{" "}
                warning threshold.
              </p>
            )}
          </div>
        )}
      </SummaryPanel>

      {/* Vulnerability audit */}
      <SummaryPanel
        tone={auditTone}
        icon={
          auditAdvisories.length > 0 ? (
            <ShieldAlert className="h-4 w-4 text-status-down" />
          ) : (
            <ShieldCheck className="h-4 w-4 text-status-ok" />
          )
        }
        title="Vulnerability audit"
        hero={String(auditAdvisories.length)}
        heroToneClass={
          auditAdvisories.length === 0 ? toneStyles.ok.text : undefined
        }
        caption={auditAdvisories.length === 0 ? "clean" : "open advisories"}
        trailing={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleAudit}
            disabled={auditMutation.isPending || migrating}
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                auditMutation.isPending && !isLowPower && "animate-spin",
              )}
            />
            {auditMutation.isPending ? "Auditing…" : "Audit now"}
          </Button>
        }
        meta={
          <>
            <span className="text-xs text-muted-foreground">Last run:</span>
            <Badge variant="secondary">
              {auditState?.lastRunAt
                ? new Date(auditState.lastRunAt).toLocaleString()
                : "never"}
            </Badge>
            {auditState && auditState.total > 0 && (
              <>
                {auditState.counts.critical > 0 && (
                  <StatusPill
                    tone="down"
                    label={`${auditState.counts.critical} critical`}
                  />
                )}
                {auditState.counts.high > 0 && (
                  <StatusPill
                    tone="down"
                    label={`${auditState.counts.high} high`}
                  />
                )}
                {auditState.counts.moderate > 0 && (
                  <StatusPill
                    tone="warn"
                    label={`${auditState.counts.moderate} moderate`}
                  />
                )}
                {auditState.counts.low > 0 && (
                  <Badge variant="secondary">{auditState.counts.low} low</Badge>
                )}
              </>
            )}
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Runs <code>bun audit</code> against the installed package tree once a
            day and notifies managers when a new vulnerability appears. Findings
            below cover every severity.
          </p>
          {auditState?.errorMessage && (
            <p className="text-xs text-status-down">
              Last audit failed: {auditState.errorMessage}
            </p>
          )}
          {auditAdvisories.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No known vulnerabilities in the installed tree.
            </p>
          ) : (
            <SurfaceList>
              {auditAdvisories.map((a) => (
                <SurfaceListRow key={`${a.packageName} ${a.advisoryId}`}>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-mono text-sm">
                      {a.packageName}{" "}
                      <span className="text-muted-foreground">
                        {a.vulnerableVersions}
                      </span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {a.url ? (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                        >
                          {a.title || a.advisoryId}
                        </a>
                      ) : (
                        a.title || a.advisoryId
                      )}
                    </span>
                  </span>
                  <StatusPill
                    tone={severityTone(a.severity)}
                    label={a.severity}
                  />
                </SurfaceListRow>
              ))}
            </SurfaceList>
          )}
        </div>
      </SummaryPanel>

      {/* Allowlist */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Allowed packages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="pkg-name">Package</Label>
              <PackageNameCombobox
                id="pkg-name"
                value={name}
                onValueChange={(next) => {
                  // Manual typing only (selecting a suggestion routes through
                  // onSelect instead). A manual name edit invalidates the
                  // previously chosen version - it belonged to the old package.
                  setName(next);
                  setVersion("");
                }}
                onSelect={(hit) => {
                  // Picking a suggestion fills the name AND seeds the version
                  // from the hit (typically the latest published version);
                  // `onVersionsLoaded` below upgrades it to the `latest`
                  // dist-tag once the full version list resolves.
                  setName(hit.name);
                  setVersion(versionFromHit(hit));
                }}
                placeholder="lodash or @scope/name"
              />
            </div>
            <div className="w-40">
              <Label htmlFor="pkg-version">Version</Label>
              <PackageVersionCombobox
                id="pkg-version"
                packageName={name.trim()}
                value={version}
                onValueChange={setVersion}
                onVersionsLoaded={({ latest }) => {
                  // Default-select the registry's `latest` only when the field
                  // is still empty, so we never clobber a manual pin or a
                  // version already seeded from the search hit. Functional
                  // update so we read the freshest value, not a stale closure.
                  setVersion((cur) => applyLatestDistTag({ current: cur, latest }));
                }}
                placeholder="4.17.21"
              />
            </div>
            <Button
              type="button"
              onClick={handleAdd}
              disabled={
                !name.trim() ||
                !trimmedVersion ||
                versionError !== null ||
                addMutation.isPending
              }
            >
              Add
            </Button>
          </div>
          {versionError && (
            <p className="text-xs text-destructive">{versionError}</p>
          )}

          {packages.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No packages yet. Add pinned, lightweight pure-JS packages.
            </p>
          ) : (
            <SurfaceList>
              {packages.map((pkg) => (
                <SurfaceListRow key={pkg.name}>
                  <span className="flex min-w-0 items-center gap-2 truncate font-mono text-sm">
                    <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {pkg.name}@{pkg.version}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
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
                </SurfaceListRow>
              ))}
            </SurfaceList>
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
              <AccordionContent className="space-y-4 text-sm">
                <div>
                  <Label htmlFor="registry-url">Registry URL</Label>
                  <Input
                    id="registry-url"
                    value={registryUrl}
                    onChange={(e) => setRegistryUrl(e.target.value)}
                    placeholder="https://registry.npmjs.org/"
                    className="font-mono"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Toggle
                    checked={ignoreScripts}
                    onCheckedChange={setIgnoreScripts}
                    aria-label="Ignore install scripts"
                  />
                  <span className="text-muted-foreground">
                    Ignore install scripts
                  </span>
                </div>
                <div>
                  <Label htmlFor="registry-token">Auth token</Label>
                  <Input
                    id="registry-token"
                    type="password"
                    value={authTokenInput}
                    onChange={(e) => setAuthTokenInput(e.target.value)}
                    placeholder={
                      registryQuery.data?.hasAuthToken
                        ? "Configured. Type to replace, or leave blank to keep."
                        : "None. Enter a token to configure."
                    }
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveRegistry}
                    disabled={
                      !registryUrl.trim() || setRegistryMutation.isPending
                    }
                  >
                    Save registry
                  </Button>
                  {registryQuery.data?.hasAuthToken && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleClearAuthToken}
                      disabled={setRegistryMutation.isPending}
                    >
                      Clear token
                    </Button>
                  )}
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
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-48">
                    <Label htmlFor="active-backend">Active backend</Label>
                    <Select
                      value={storageBackend}
                      onValueChange={setStorageBackend}
                      disabled={migrating}
                    >
                      <SelectTrigger id="active-backend">
                        <SelectValue placeholder="Select backend" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableBackends.map((b) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    onClick={handleSaveStorageBackend}
                    disabled={
                      !storageBackend ||
                      storageBackend === storage?.activeBackend ||
                      migrating ||
                      setStorageBackendMutation.isPending
                    }
                  >
                    Set active
                  </Button>
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
                <p className="text-xs text-muted-foreground">
                  Setting the active backend does not move existing blobs - use
                  Migrate below to copy them. Use this only for an initial
                  selection or when both backends already hold every blob.
                </p>

                {storage?.migrationStatus === "error" &&
                  storage.migrationError && (
                    <p className="text-xs text-status-down">
                      Migration failed: {storage.migrationError}
                    </p>
                  )}
                {storage?.migrationStatus === "completed" && (
                  <p className="text-xs text-status-ok">
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

            <AccordionItem value="size-cap" className="border-b">
              <AccordionTrigger className="text-sm hover:no-underline">
                Size guardrail
              </AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  Installs warn above the warning threshold and are blocked
                  above the block threshold (resolved total size).
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-40">
                    <Label htmlFor="warn-mb">Warn at (MB)</Label>
                    <Input
                      id="warn-mb"
                      type="number"
                      min={1}
                      value={warnMb}
                      onChange={(e) => setWarnMb(e.target.value)}
                      placeholder="150"
                    />
                  </div>
                  <div className="w-40">
                    <Label htmlFor="block-mb">Block at (MB)</Label>
                    <Input
                      id="block-mb"
                      type="number"
                      min={1}
                      value={blockMb}
                      onChange={(e) => setBlockMb(e.target.value)}
                      placeholder="300"
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={handleSaveSizeCap}
                    disabled={
                      !warnMb.trim() ||
                      !blockMb.trim() ||
                      setSizeCapMutation.isPending
                    }
                  >
                    Save thresholds
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="gc" className="border-b">
              <AccordionTrigger className="text-sm hover:no-underline">
                <span className="flex items-center gap-2">
                  <Recycle className="h-3.5 w-3.5 text-muted-foreground" />
                  Storage cleanup
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  Garbage collection prunes content-addressed blobs no longer
                  referenced by the current or recently-superseded package set,
                  reclaiming Postgres / S3 storage. It runs automatically once a
                  day; unreferenced blobs are kept for a grace period before
                  deletion so in-flight syncs are never disrupted.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">Last run:</span>
                  <Badge variant="secondary">
                    {blobGc?.lastRunAt
                      ? new Date(blobGc.lastRunAt).toLocaleString()
                      : "never"}
                  </Badge>
                  {blobGc && blobGc.lastRunAt && (
                    <Badge variant="secondary">
                      {blobGc.lastDeleted} blob(s),{" "}
                      {formatBytes(blobGc.lastBytesReclaimed)} reclaimed
                    </Badge>
                  )}
                </div>
                {blobGc && blobGc.totalBytesReclaimed > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Total reclaimed to date:{" "}
                    {formatBytes(blobGc.totalBytesReclaimed)}
                  </div>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleGc}
                  disabled={gcMutation.isPending || migrating}
                >
                  <Recycle className="h-4 w-4" />
                  {gcMutation.isPending ? "Cleaning up…" : "Run cleanup now"}
                </Button>
              </AccordionContent>
            </AccordionItem>

            {satellites.length > 0 && (
              <AccordionItem value="satellites" className="border-b-0">
                <AccordionTrigger className="text-sm hover:no-underline">
                  Satellite sync
                </AccordionTrigger>
                <AccordionContent>
                  <SurfaceList>
                    {satellites.map((s) => (
                      <SurfaceListRow key={s.satelliteId}>
                        <span className="truncate font-mono text-sm">
                          {s.satelliteId}
                        </span>
                        <StatusPill
                          tone={satelliteStatusTone(s.status)}
                          label={s.status}
                        />
                      </SurfaceListRow>
                    ))}
                  </SurfaceList>
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
