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
  useToast,
} from "@checkstack/ui";
import { Plus, RotateCw, Trash2, KeyRound } from "lucide-react";
import { extractErrorMessage } from "@checkstack/common";
import { SecretEditor } from "./SecretEditor";
import { SecretRotateDialog } from "./SecretRotateDialog";

const formatDate = (date: Date) => new Date(date).toLocaleString();

export const SecretList = () => {
  const client = usePluginClient(GitOpsApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  const { allowed: canManage } = accessApi.useAccess(
    gitopsAccess.secret.manage,
  );

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [rotatingSecret, setRotatingSecret] = useState<{
    id: string;
    name: string;
  }>();
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    secretId: string;
    secretName: string;
  }>({ isOpen: false, secretId: "", secretName: "" });

  const { data: secrets, isLoading, refetch } = client.listSecrets.useQuery({});

  const createMutation = client.createSecret.useMutation({
    onSuccess: () => {
      toast.success("Secret created successfully");
      setIsEditorOpen(false);
      void refetch();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to create secret"));
    },
  });

  const rotateMutation = client.rotateSecret.useMutation({
    onSuccess: () => {
      toast.success("Secret rotated successfully");
      setRotatingSecret(undefined);
      void refetch();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to rotate secret"));
    },
  });

  const deleteMutation = client.deleteSecret.useMutation({
    onSuccess: () => {
      toast.success("Secret deleted successfully");
      setConfirmModal({ isOpen: false, secretId: "", secretName: "" });
      void refetch();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to delete secret"));
    },
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardHeaderRow>
            <CardTitle>Secrets</CardTitle>
            {canManage && (
              <Button size="sm" onClick={() => setIsEditorOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Secret
              </Button>
            )}
          </CardHeaderRow>
          <p className="text-xs text-muted-foreground mt-1">
            Secrets can be referenced in YAML descriptors using{" "}
            <code className="text-xs">{"${{ secrets.NAME }}"}</code> syntax.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading...
            </div>
          ) : !secrets || secrets.length === 0 ? (
            <EmptyState
              title="No secrets created"
              description="Create secrets to securely reference sensitive values in your YAML descriptors."
            />
          ) : (
            <div className="space-y-3">
              {secrets.map((secret) => (
                <div
                  key={secret.id}
                  className="flex items-center justify-between p-4 rounded-lg border border-border bg-background/50 hover:bg-background/80 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium font-mono text-sm">
                        {secret.name}
                      </div>
                      {secret.description && (
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {secret.description}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right text-xs text-muted-foreground hidden md:block">
                      <div>Updated: {formatDate(secret.updatedAt)}</div>
                    </div>

                    {canManage && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setRotatingSecret({
                              id: secret.id,
                              name: secret.name,
                            })
                          }
                          title="Rotate secret"
                        >
                          <RotateCw className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setConfirmModal({
                              isOpen: true,
                              secretId: secret.id,
                              secretName: secret.name,
                            })
                          }
                          title="Delete secret"
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

      <SecretEditor
        open={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSave={(data) => createMutation.mutate(data)}
      />

      <SecretRotateDialog
        open={!!rotatingSecret}
        secretName={rotatingSecret?.name ?? ""}
        onClose={() => setRotatingSecret(undefined)}
        onSave={(value) => {
          if (rotatingSecret) {
            rotateMutation.mutate({ id: rotatingSecret.id, value });
          }
        }}
      />

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() =>
          setConfirmModal({ isOpen: false, secretId: "", secretName: "" })
        }
        onConfirm={() => deleteMutation.mutate({ id: confirmModal.secretId })}
        title="Delete Secret"
        message={`Are you sure you want to delete the secret "${confirmModal.secretName}"? Any descriptors referencing this secret will fail validation.`}
        confirmText="Delete"
        variant="danger"
      />
    </>
  );
};
