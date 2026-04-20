import { useState } from "react";
import {
  usePluginClient,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import { GitOpsApi, gitopsAccess } from "@checkstack/gitops-common";
import {
  Card,
  CardHeader,
  CardHeaderRow,
  CardTitle,
  CardContent,
  Button,
  EmptyState,
  ConfirmationModal,
  Badge,
  useToast,
} from "@checkstack/ui";
import {
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  Github,
  GitlabIcon,
} from "lucide-react";
import { extractErrorMessage } from "@checkstack/common";
import { ProviderEditor } from "./ProviderEditor";

const formatInterval = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
};

const formatLastSync = (date: Date | null) => {
  if (!date) return "Never";
  return new Date(date).toLocaleString();
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
      toast.error(extractErrorMessage(error, "Failed to create provider"));
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
      toast.error(extractErrorMessage(error, "Failed to update provider"));
    },
  });

  const deleteMutation = client.deleteProvider.useMutation({
    onSuccess: () => {
      toast.success("Provider deleted successfully");
      setConfirmModal({ isOpen: false, providerId: "", providerTarget: "" });
      void refetch();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to delete provider"));
    },
  });

  const syncMutation = client.triggerSync.useMutation({
    onSuccess: () => {
      toast.success("Sync triggered successfully");
      void refetch();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to trigger sync"));
    },
  });

  const handleSave = (data: {
    type: "github" | "gitlab";
    target: string;
    pathPattern: string;
    baseUrl?: string;
    authToken?: string;
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
      createMutation.mutate(data);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardHeaderRow>
            <CardTitle>Git Providers</CardTitle>
            {canManage && (
              <Button size="sm" onClick={() => setIsEditorOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Provider
              </Button>
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
              title="No providers configured"
              description="Add a GitHub or GitLab provider to start syncing infrastructure definitions."
            />
          ) : (
            <div className="space-y-3">
              {providers.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center justify-between p-4 rounded-lg border border-border bg-background/50 hover:bg-background/80 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {provider.type === "github" ? (
                      <Github className="w-5 h-5 text-muted-foreground shrink-0" />
                    ) : (
                      <GitlabIcon className="w-5 h-5 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {provider.target}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        <span className="truncate">{provider.pathPattern}</span>
                        <span>·</span>
                        <span>
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
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right text-xs text-muted-foreground hidden md:block">
                      <div>
                        Last sync: {formatLastSync(provider.lastSyncAt)}
                      </div>
                      {provider.lastSyncError && (
                        <div className="text-destructive truncate max-w-48">
                          {provider.lastSyncError}
                        </div>
                      )}
                    </div>

                    {canManage && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            syncMutation.mutate({ providerId: provider.id })
                          }
                          title="Trigger sync"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
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
                          title="Edit provider"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setConfirmModal({
                              isOpen: true,
                              providerId: provider.id,
                              providerTarget: provider.target,
                            })
                          }
                          title="Delete provider"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
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
