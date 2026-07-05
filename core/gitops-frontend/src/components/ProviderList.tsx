import { useState, type ReactNode } from "react";
import {
  usePluginClient,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import {
  GitOpsApi,
  gitopsAccess,
  pluginMetadata as gitopsPluginMetadata,
} from "@checkstack/gitops-common";
import { Tip } from "@checkstack/tips-frontend";
import {
  Card,
  CardHeader,
  CardHeaderRow,
  CardTitle,
  CardContent,
  Button,
  DataTable,
  type DataTableColumn,
  RowActions,
  RowAction,
  EmptyState,
  ConfirmationModal,
  Badge,
  useToast,
  toastError,
  formatDateTime,
  cn,
  // Brand marks were removed from lucide v1; use the vendored ones.
  GithubIcon as Github,
  GitlabIcon,
} from "@checkstack/ui";
import { Plus, RefreshCw, Trash2, Pencil } from "lucide-react";
import { ProviderEditor } from "./ProviderEditor";
import { toneStyles } from "./statusTone";
import { classifySyncHealth } from "./providerSyncHealth.logic";

const formatInterval = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
};

const formatLastSync = (date: Date | null) => {
  if (!date) return "Never";
  return formatDateTime(date);
};

export const ProviderList = () => {
  const client = usePluginClient(GitOpsApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  const { allowed: canManage } = accessApi.useAccess(
    gitopsAccess.provider.manage,
  );

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<{
    id: string;
    type: "github" | "gitlab";
    target: string;
    pathPattern: string;
    baseUrl?: string;
    syncInterval: number;
    deletionPolicy: "orphan" | "auto";
  }>();
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    providerId: string;
    providerTarget: string;
  }>({ isOpen: false, providerId: "", providerTarget: "" });

  const {
    data: providers,
    isLoading,
    refetch,
  } = client.listProviders.useQuery({});

  const createMutation = client.createProvider.useMutation({
    onSuccess: () => {
      toast.success("Provider created successfully");
      setIsEditorOpen(false);
      void refetch();
    },
    onError: (error) => {
      toastError(toast, "Failed to create provider", error);
    },
  });

  const updateMutation = client.updateProvider.useMutation({
    onSuccess: () => {
      toast.success("Provider updated successfully");
      setIsEditorOpen(false);
      setEditingProvider(undefined);
      void refetch();
    },
    onError: (error) => {
      toastError(toast, "Failed to update provider", error);
    },
  });

  const deleteMutation = client.deleteProvider.useMutation({
    onSuccess: () => {
      toast.success("Provider deleted successfully");
      setConfirmModal({ isOpen: false, providerId: "", providerTarget: "" });
      void refetch();
    },
    onError: (error) => {
      toastError(toast, "Failed to delete provider", error);
    },
  });

  const syncMutation = client.triggerSync.useMutation({
    onSuccess: () => {
      toast.success("Sync triggered successfully");
      void refetch();
    },
    onError: (error) => {
      toastError(toast, "Failed to trigger sync", error);
    },
  });

  const handleSave = (data: {
    type: "github" | "gitlab";
    target: string;
    pathPattern: string;
    baseUrl?: string;
    authToken?: string | null;
    syncInterval?: number;
    deletionPolicy?: "orphan" | "auto";
  }) => {
    if (editingProvider) {
      updateMutation.mutate({
        id: editingProvider.id,
        data: {
          target: data.target,
          pathPattern: data.pathPattern,
          baseUrl: data.baseUrl ?? undefined,
          authToken: data.authToken,
          syncInterval: data.syncInterval,
          deletionPolicy: data.deletionPolicy,
        },
      });
    } else {
      // On create, authToken is always string|undefined (Remove button not shown)
      createMutation.mutate({
        ...data,
        authToken: data.authToken ?? undefined,
      });
    }
  };

  const providerRows = (providers ?? []).map((provider) => ({
    provider,
    health: classifySyncHealth({
      lastSyncAt: provider.lastSyncAt,
      lastSyncError: provider.lastSyncError,
    }),
  }));

  type ProviderRow = (typeof providerRows)[number];

  // Sync/edit/delete cluster, gated on manage, shared by the desktop row and
  // the mobile card so the two stay in lock-step.
  const renderActions = ({ provider }: ProviderRow): ReactNode =>
    canManage ? (
      <RowActions>
        <RowAction
          icon={RefreshCw}
          label="Trigger sync"
          onClick={() => syncMutation.mutate({ providerId: provider.id })}
        />
        <RowAction
          icon={Pencil}
          label="Edit provider"
          onClick={() => {
            setEditingProvider({
              id: provider.id,
              type: provider.type,
              target: provider.target,
              pathPattern: provider.pathPattern,
              baseUrl: provider.baseUrl ?? undefined,
              syncInterval: provider.syncInterval,
              deletionPolicy: provider.deletionPolicy,
            });
            setIsEditorOpen(true);
          }}
        />
        <RowAction
          icon={Trash2}
          label="Delete provider"
          tone="destructive"
          onClick={() =>
            setConfirmModal({
              isOpen: true,
              providerId: provider.id,
              providerTarget: provider.target,
            })
          }
        />
      </RowActions>
    ) : null;

  // Sync-health pill, shared by the desktop cell and the mobile card.
  const renderSyncHealth = ({ health }: ProviderRow): ReactNode => (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        toneStyles[health.tone].pill,
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", toneStyles[health.tone].dot)}
        aria-hidden
      />
      {health.label}
    </span>
  );

  const columns: DataTableColumn<ProviderRow>[] = [
    {
      id: "provider",
      header: "Provider",
      sortValue: ({ provider }) => provider.target,
      searchValue: ({ provider }) => provider.target,
      cell: ({ provider }) => (
        <div className="flex min-w-0 items-center gap-2">
          {provider.type === "github" ? (
            <Github className="w-5 h-5 text-muted-foreground shrink-0" />
          ) : (
            <GitlabIcon className="w-5 h-5 text-muted-foreground shrink-0" />
          )}
          <span className="font-semibold text-foreground truncate">
            {provider.target}
          </span>
        </div>
      ),
    },
    {
      id: "path",
      header: "Path pattern",
      searchValue: ({ provider }) => provider.pathPattern,
      cell: ({ provider }) => (
        <span className="text-muted-foreground truncate">
          {provider.pathPattern}
        </span>
      ),
    },
    {
      id: "interval",
      header: "Interval",
      cell: ({ provider }) => (
        <span className="tabular-nums text-muted-foreground">
          every {formatInterval(provider.syncInterval)}
        </span>
      ),
    },
    {
      id: "deletionPolicy",
      header: "Deletion policy",
      cell: ({ provider }) => (
        <Badge
          variant={
            provider.deletionPolicy === "auto" ? "destructive" : "outline"
          }
        >
          {provider.deletionPolicy}
        </Badge>
      ),
    },
    {
      id: "syncHealth",
      header: "Sync health",
      sortValue: ({ health }) => health.label,
      cell: (row) => renderSyncHealth(row),
    },
    {
      id: "lastSync",
      header: "Last sync",
      sortValue: ({ provider }) =>
        provider.lastSyncAt ? new Date(provider.lastSyncAt).getTime() : null,
      cell: ({ provider }) => (
        <div className="text-xs text-muted-foreground">
          <div className="tabular-nums">
            {formatLastSync(provider.lastSyncAt)}
          </div>
          {provider.lastSyncError && (
            <div className="text-status-down truncate max-w-48">
              {provider.lastSyncError}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      headClassName: "w-px text-right",
      cellClassName: "text-right",
      cell: (row) => renderActions(row),
    },
  ];

  return (
    <>
      <Card>
        <CardHeader>
          <CardHeaderRow>
            <CardTitle>Git Providers</CardTitle>
            {canManage && (
              <Tip
                plugin={gitopsPluginMetadata}
                id="providers.create"
                title="Manage Checkstack from Git"
                description="Connect a GitHub or GitLab repository and Checkstack will sync your YAML descriptors - systems, groups, health checks - into the platform. Reviews happen as PRs, history lives in commits, and rollbacks are a `git revert` away."
                side="bottom"
                align="end"
              >
                <Button size="sm" onClick={() => setIsEditorOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Provider
                </Button>
              </Tip>
            )}
          </CardHeaderRow>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading...
            </div>
          ) : !providers || providers.length === 0 ? (
            <EmptyState
              icon={<Github className="size-10" />}
              title="No providers configured"
              description="GitOps lets you keep your Checkstack infrastructure (systems, groups, health checks, secrets) in a Git repository and sync it into the platform automatically - pull-request reviews, audit trail, rollbacks, all included."
              steps={[
                "Add a GitHub or GitLab provider with a token that can read the repository.",
                "Create a sync target that points at a path in that repo containing your YAML descriptors.",
                "Push a change and watch Checkstack apply it - provenance is tracked per resource.",
              ]}
              actions={
                canManage ? (
                  <Button onClick={() => setIsEditorOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Git provider
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <DataTable
              data={providerRows}
              columns={columns}
              getRowId={({ provider }) => provider.id}
              searchPlaceholder="Search providers..."
              defaultSort={{ columnId: "provider", direction: "asc" }}
              renderMobileCard={(row) => {
                const { provider } = row;
                return (
                  <Card className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {provider.type === "github" ? (
                          <Github className="w-5 h-5 text-muted-foreground shrink-0" />
                        ) : (
                          <GitlabIcon className="w-5 h-5 text-muted-foreground shrink-0" />
                        )}
                        <span className="font-semibold text-foreground truncate">
                          {provider.target}
                        </span>
                      </div>
                      {renderSyncHealth(row)}
                    </div>
                    <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                      <div className="truncate">{provider.pathPattern}</div>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums">
                          every {formatInterval(provider.syncInterval)}
                        </span>
                        <span>·</span>
                        <Badge
                          variant={
                            provider.deletionPolicy === "auto"
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {provider.deletionPolicy}
                        </Badge>
                      </div>
                      <div className="tabular-nums">
                        Last sync: {formatLastSync(provider.lastSyncAt)}
                      </div>
                      {provider.lastSyncError && (
                        <div className="text-status-down truncate">
                          {provider.lastSyncError}
                        </div>
                      )}
                    </div>
                    {canManage && (
                      <div className="mt-2 flex justify-end">
                        {renderActions(row)}
                      </div>
                    )}
                  </Card>
                );
              }}
            />
          )}
        </CardContent>
      </Card>

      <ProviderEditor
        open={isEditorOpen}
        onClose={() => {
          setIsEditorOpen(false);
          setEditingProvider(undefined);
        }}
        onSave={handleSave}
        initialData={editingProvider}
      />

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() =>
          setConfirmModal({ isOpen: false, providerId: "", providerTarget: "" })
        }
        onConfirm={() => deleteMutation.mutate({ id: confirmModal.providerId })}
        title="Delete Provider"
        message={`Are you sure you want to delete the provider for "${confirmModal.providerTarget}"? All provenance tracking will be removed.`}
        confirmText="Delete"
        variant="danger"
      />
    </>
  );
};
